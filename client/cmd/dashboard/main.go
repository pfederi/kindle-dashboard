// Command dashboard is the Kindle thin client: it shows server-rendered PNGs and forwards taps.
package main

import (
	"context"
	"crypto/x509"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"os/signal"
	"runtime/debug"
	"strings"
	"sync/atomic"
	"syscall"
	"time"
	_ "time/tzdata" // the Kindle has no usable zoneinfo for Europe/Zurich

	"kindle-dashboard/client/internal/api"
	"kindle-dashboard/client/internal/app"
	"kindle-dashboard/client/internal/certs"
	"kindle-dashboard/client/internal/config"
	"kindle-dashboard/client/internal/device"
	"kindle-dashboard/client/internal/input"
	"kindle-dashboard/client/internal/logx"
	"kindle-dashboard/client/internal/overlay"
	"kindle-dashboard/client/internal/pidfile"
	"kindle-dashboard/client/internal/touch"
	"kindle-dashboard/client/internal/wifi"
)

const (
	baseDir    = "/mnt/us/dashboard"
	configPath = baseDir + "/config.json"
	logPath    = baseDir + "/client.log"
	pidPath    = baseDir + "/dashboard.pid"
	tmpImage   = "/tmp/dashboard.png"
	fbDump     = "/tmp/dashboard-fb.dump"
	maxLogSize = 1 << 20

	exitAlreadyRunning = 3 // must match Dashboard.sh
)

func main() { os.Exit(run()) }

func run() int {
	// Do not keep /mnt/us busy as working directory (it is exported over USB).
	_ = os.Chdir("/")
	logFile, err := logx.OpenRotating(logPath, maxLogSize)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	defer logFile.Close()
	logger := log.New(logFile, "", log.LstdFlags)

	if err := pidfile.Acquire(pidPath, os.Getpid(), pidfile.ProcessAlive); err != nil {
		logger.Printf("start: %v", err)
		if errors.Is(err, pidfile.ErrRunning) {
			// Dashboard.sh skips its UI restore for this code: the running
			// instance owns the screen.
			return exitAlreadyRunning
		}
		return 1
	}
	defer pidfile.Release(pidPath, os.Getpid())

	logger.Printf("start: pid %d, kernel %s, clock %s", os.Getpid(), kernelRelease(), time.Now().UTC().Format(time.RFC3339))
	cfg, err := config.Load(configPath)
	if err != nil {
		logger.Print(err)
		return 1
	}
	loc, err := time.LoadLocation("Europe/Zurich")
	if err != nil {
		logger.Print(err)
		return 1
	}
	roots, err := certs.Pool()
	if err != nil {
		logger.Print(err)
		return 1
	}
	fbinkPath, err := device.FindFBInk(device.FileExists)
	if err != nil {
		logger.Print(err)
		return 1
	}

	// Open input devices before pausing the Kindle UI, so a failure leaves the Kindle usable.
	devices, _ := os.ReadFile("/proc/bus/input/devices")
	touchDev, scaler, err := openTouch(string(devices), cfg, logger)
	if err != nil {
		logger.Print(err)
		return 1
	}
	defer touchDev.Close()
	powerDev := openPower(string(devices), cfg, logger) // optional
	if powerDev != nil {
		defer powerDev.Close()
	}

	return runUI(logger, cfg, loc, roots, fbinkPath, touchDev, scaler, powerDev)
}

// runUI pauses the Kindle UI and runs the loop. Every path out of it, including a
// panic, restores the UI so the Kindle is never left with a dead screen.
func runUI(logger *log.Logger, cfg config.Config, loc *time.Location, roots *x509.CertPool,
	fbinkPath string, touchDev *input.Device, scaler touch.Scaler, powerDev *input.Device) (code int) {
	sys := device.System{Run: device.Exec}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	fb := device.Framebuffer{Device: "/dev/fb0", Dump: fbDump}

	// Closed when the restore has finished; disarms the watchdog.
	restored := make(chan struct{})
	safeGo(logger, cancel, func() {
		watchdog(ctx, watchdogTimeout, restored, func() { os.Exit(1) }, logger)
	})

	// Registered before the first change to the device state, so any failure or
	// panic after this point still restores it. Devices are released before the Kindle UI resumes.
	signal.Ignore(syscall.SIGTERM, syscall.SIGINT) // nothing may interrupt the takeover half-way
	defer func() {
		if r := recover(); r != nil {
			logger.Printf("panic: %v\n%s", r, debug.Stack())
			code = 1
		}
		shutdown(shutdownSteps{
			stopApp: cancel,
			closeDevices: func() {
				touchDev.Close()
				if powerDev != nil {
					powerDev.Close()
				}
			},
			resumeWM:      func() error { return sys.PauseWindowManager(false) },
			restoreScreen: fb.Restore,
			showStatusBar: func() error { return sys.SetStatusBar(true) },
			allowScreen:   func() error { return sys.PreventScreenSaver(false) },
			startHome:     sys.StartHome,
		}, logger)
		close(restored)
	}()
	if err := takeOverScreen(takeOverSteps{
		preventScreen: sys.PreventScreenSaver,
		saveScreen:    fb.Save,
		hideStatusBar: func() error { return sys.SetStatusBar(false) },
		pauseWM:       func() error { return sys.PauseWindowManager(true) },
	}, logger); err != nil {
		logger.Print(err)
		return 1 // deferred restore gives the screen back to the Kindle UI
	}
	sigs := make(chan os.Signal, 1)
	signal.Notify(sigs, syscall.SIGTERM, syscall.SIGINT) // re-enables handling of both
	safeGo(logger, cancel, func() {
		select {
		case s := <-sigs:
			logger.Printf("exit: signal %v", s)
			cancel()
		case <-ctx.Done():
		}
	})

	gate := &app.Gate{}
	taps := make(chan app.Point, 1)
	var touchGone atomic.Bool
	safeGo(logger, cancel, func() {
		touchLoop(ctx, touchDev.Reader(), scaler, gate, taps, cancel, &touchGone, logger)
	})
	if powerDev != nil {
		safeGo(logger, cancel, func() { powerLoop(ctx, powerDev.Reader(), cfg.PowerKeyCode, cancel, &touchGone, logger) })
	}

	display := device.FBInk{Path: fbinkPath, TmpFile: tmpImage, Run: device.Exec}
	client := api.New(cfg.ServerURL, cfg.Token, roots)
	client.Battery = batteryReader(sys, logger)
	a := app.New(client, display, wifi.New(sys), overlay.Draw, time.Now, loc, logger)
	a.Run(ctx, taps, gate)
	return 0
}

func openTouch(devices string, cfg config.Config, logger *log.Logger) (*input.Device, touch.Scaler, error) {
	handler, ok := input.FindHandler(devices, cfg.Touch.DeviceName)
	if !ok {
		handler = "event1"
		logger.Printf("touch: %q not found in /proc/bus/input/devices, trying %s", cfg.Touch.DeviceName, handler)
	}
	dev, err := input.Open("/dev/input/" + handler)
	if err != nil {
		return nil, touch.Scaler{}, err
	}
	if err := dev.Grab(); err != nil {
		logger.Print(err)
	}
	xr, errX := dev.AbsRange(touch.AbsMTPositionX)
	yr, errY := dev.AbsRange(touch.AbsMTPositionY)
	if err := errors.Join(errX, errY); err != nil {
		dev.Close()
		return nil, touch.Scaler{}, err
	}
	if xr.Max <= xr.Min || yr.Max <= yr.Min {
		dev.Close()
		return nil, touch.Scaler{}, fmt.Errorf("touch: /dev/input/%s has no usable position range (x=%v y=%v); wrong device?", handler, xr, yr)
	}
	s := touch.Scaler{X: xr, Y: yr, Width: cfg.ScreenWidth, Height: cfg.ScreenHeight,
		SwapXY: cfg.Touch.SwapXY, InvertX: cfg.Touch.InvertX, InvertY: cfg.Touch.InvertY}
	logger.Printf("touch: /dev/input/%s x=%v y=%v swapXY=%v invertX=%v invertY=%v",
		handler, xr, yr, s.SwapXY, s.InvertX, s.InvertY)
	return dev, s, nil
}

func openPower(devices string, cfg config.Config, logger *log.Logger) *input.Device {
	handler, ok := input.FindHandler(devices, cfg.PowerDeviceName)
	if !ok {
		logger.Printf("power: %q not found; exit only via corner long-press", cfg.PowerDeviceName)
		return nil
	}
	dev, err := input.Open("/dev/input/" + handler)
	if err != nil {
		logger.Printf("power: %v", err)
		return nil
	}
	if err := dev.Grab(); err != nil {
		logger.Printf("power: %v", err)
	}
	logger.Printf("power: /dev/input/%s keycode %d", handler, cfg.PowerKeyCode)
	return dev
}

type timedEvent struct {
	ev touch.Event
	at time.Time
}

// touchLoop owns the Detector: events and ticks are processed in this goroutine only.
func touchLoop(ctx context.Context, r *touch.Reader, s touch.Scaler, gate *app.Gate, taps chan<- app.Point, exit func(), gone *atomic.Bool, logger *log.Logger) {
	events := make(chan timedEvent, 64)
	safeGo(logger, exit, func() {
		for {
			ev, err := r.Next()
			if err != nil {
				if ctx.Err() == nil {
					if errors.Is(err, io.EOF) {
						logger.Print("exit: touch device lost (EOF)")
					} else {
						logger.Printf("exit: touch device lost: %v", err)
					}
					gone.Store(true)
					exit()
				}
				return
			}
			select {
			case events <- timedEvent{ev, time.Now()}:
			case <-ctx.Done():
				return
			}
		}
	})
	det := touch.NewDetector(touch.DefaultDetectorConfig(), s)
	tick := time.NewTicker(250 * time.Millisecond)
	defer tick.Stop()
	for {
		var g touch.Gesture
		var ok bool
		select {
		case <-ctx.Done():
			return
		case te := <-events:
			g, ok = det.Feed(te.ev, te.at)
		case now := <-tick.C:
			g, ok = det.Tick(now)
		}
		if !ok {
			continue
		}
		switch g.Kind {
		case touch.Exit:
			logger.Print("exit: corner long-press")
			exit()
			return
		case touch.Press:
			logger.Printf("touch: press x=%d y=%d for %.1fs (no tap)", g.X, g.Y, g.Dur.Seconds())
		case touch.Tap, touch.Hold:
			if gate.TryAcquire() {
				taps <- app.Point{X: g.X, Y: g.Y, Hold: g.Kind == touch.Hold}
			} else {
				logger.Printf("tap x=%d y=%d dropped: previous tap still in flight", g.X, g.Y)
			}
		}
	}
}

// powerExit reports whether ev completes a press of the power key. It fires on the
// release, not the press: while the key is grabbed powerd sees neither, whereas a
// release arriving after the ungrab would reach powerd during the restore.
func powerExit(ev touch.Event, code uint16, pressed *bool) bool {
	if ev.Type != touch.EvKey || ev.Code != code {
		return false
	}
	switch ev.Value {
	case 1:
		*pressed = true
	case 0:
		return *pressed
	}
	return false
}

func powerLoop(ctx context.Context, r *touch.Reader, code uint16, exit func(), touchGone *atomic.Bool, logger *log.Logger) {
	pressed := false
	for {
		ev, err := r.Next()
		if err != nil {
			if ctx.Err() == nil {
				logger.Printf("power: %v", err)
				if touchGone.Load() {
					logger.Print("exit: touch and power devices lost")
					exit()
				}
			}
			return
		}
		if powerExit(ev, code, &pressed) {
			logger.Print("exit: power key")
			exit()
			return
		}
	}
}

// safeGo runs f in a goroutine and turns a panic into a clean shutdown.
func safeGo(logger *log.Logger, cancel func(), f func()) {
	go func() {
		defer func() {
			if r := recover(); r != nil {
				logger.Printf("panic in goroutine: %v\n%s", r, debug.Stack())
				cancel()
			}
		}()
		f()
	}()
}

func kernelRelease() string {
	b, err := os.ReadFile("/proc/sys/kernel/osrelease")
	if err != nil {
		return "unknown"
	}
	return strings.TrimSpace(string(b))
}

// batteryReader reads the battery for each screen request; a failure is logged once, not every
// two minutes, and then the request goes out without it.
func batteryReader(sys device.System, logger *log.Logger) func() (api.Battery, bool) {
	warned := false
	return func() (api.Battery, bool) {
		level, charging, err := sys.Battery()
		if err != nil {
			if !warned {
				logger.Printf("battery: %v", err)
				warned = true
			}
			return api.Battery{}, false
		}
		return api.Battery{Level: level, Charging: charging}, true
	}
}

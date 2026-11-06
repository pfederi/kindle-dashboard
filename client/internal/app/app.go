// Package app is the client's main loop: fetch, display, forward taps, show status.
package app

import (
	"context"
	"errors"
	"log"
	"sync/atomic"
	"time"

	"kindle-dashboard/client/internal/api"
	"kindle-dashboard/client/internal/backoff"
)

// UnauthorizedRetry is how long the client waits after a 401 before asking again.
const UnauthorizedRetry = 10 * time.Minute

// WifiOffFrom is the shortest wait until the next fetch for which the WLAN is turned off in
// between: in the quiet hours the server asks for the next screen hours later.
const WifiOffFrom = 15 * time.Minute

// Point is a tap position in screen pixels; Hold marks a long press.
type Point struct {
	X, Y int
	Hold bool
}

// API is implemented by *api.Client.
type API interface {
	Screen(ctx context.Context) (*api.Screen, error)
	Tap(ctx context.Context, x, y int, hold bool) (*api.Screen, error)
}

// Display is implemented by device.FBInk.
type Display interface {
	ShowImage(png []byte, full bool) error
}

// Network is implemented by *wifi.Ensurer.
type Network interface {
	EnsureConnected(ctx context.Context) error
	Off() error
	On() error
}

// Overlay draws a status label onto an image (overlay.Draw).
type Overlay func(base []byte, text string) ([]byte, error)

// Gate lets only one tap request be in flight; taps arriving meanwhile are dropped.
type Gate struct{ busy atomic.Bool }

// TryAcquire reserves the gate; it returns false while a tap is being handled.
func (g *Gate) TryAcquire() bool { return g.busy.CompareAndSwap(false, true) }

// Release frees the gate after the tap has been handled.
func (g *Gate) Release() { g.busy.Store(false) }

// App holds the display state between fetches. Use New.
type App struct {
	api     API
	display Display
	network Network
	overlay Overlay
	now     func() time.Time
	loc     *time.Location
	log     *log.Logger
	backoff *backoff.Backoff
	after   func(time.Duration) <-chan time.Time // injectable for tests

	lastPNG      []byte
	lastETag     string
	statusText   string // label currently drawn over lastPNG ("" = none)
	failures     int
	offlineSince time.Time
	wifiOff      bool // turned off until the next fetch or tap
}

// New wires an App. now and loc control the "offline seit HH:MM" label.
func New(a API, d Display, n Network, o Overlay, now func() time.Time, loc *time.Location, l *log.Logger) *App {
	return &App{api: a, display: d, network: n, overlay: o, now: now, loc: loc, log: l, backoff: backoff.New(), after: time.After}
}

// Refresh fetches the active view and returns the delay until the next fetch.
func (a *App) Refresh(ctx context.Context) time.Duration {
	if !a.connect(ctx) {
		return 0
	}
	s, err := a.api.Screen(ctx)
	return a.handle(ctx, s, err)
}

// connect makes sure the WLAN is up; false means ctx ended meanwhile.
func (a *App) connect(ctx context.Context) bool {
	err := a.network.EnsureConnected(ctx)
	if err != nil && ctx.Err() != nil {
		return false
	}
	if err != nil {
		a.log.Printf("wifi: %v", err)
	}
	if a.wifiOff {
		a.log.Print("wifi on")
		a.wifiOff = false
	}
	return true
}

// sleepWifi turns the WLAN off when the next fetch is far away.
func (a *App) sleepWifi(wait time.Duration) {
	if wait < WifiOffFrom || a.wifiOff {
		return
	}
	if err := a.network.Off(); err != nil {
		a.log.Printf("wifi off: %v", err)
		return
	}
	a.wifiOff = true
	a.log.Printf("wifi off until %s", a.now().Add(wait).In(a.loc).Format("15:04"))
}

// RestoreWifi turns the WLAN back on if the dashboard turned it off, for the Kindle UI on exit.
func (a *App) RestoreWifi() {
	if !a.wifiOff {
		return
	}
	if err := a.network.On(); err != nil {
		a.log.Printf("wifi on: %v", err)
		return
	}
	a.wifiOff = false
}

// HandleTap forwards a tap or long press. It returns 0 when nothing changed (HTTP 204), so the
// caller keeps its current refresh timer; otherwise the delay until the next fetch.
func (a *App) HandleTap(ctx context.Context, p Point) time.Duration {
	kind := "tap"
	if p.Hold {
		kind = "hold"
	}
	a.log.Printf("%s x=%d y=%d", kind, p.X, p.Y)
	// Only after the WLAN was turned off for the night: a check on every tap would slow taps down.
	if a.wifiOff && !a.connect(ctx) {
		return 0
	}
	s, err := a.api.Tap(ctx, p.X, p.Y, p.Hold)
	if err == nil && s == nil {
		return 0
	}
	return a.handle(ctx, s, err)
}

func (a *App) handle(ctx context.Context, s *api.Screen, err error) time.Duration {
	if err != nil && ctx.Err() != nil {
		return 0 // shutting down: not an offline failure
	}
	if errors.Is(err, api.ErrUnauthorized) {
		a.log.Print("server rejected the device token")
		a.failures = 0 // the server is reachable
		a.offlineSince = time.Time{}
		a.backoff.Reset()
		a.showStatus("Token ungültig")
		return UnauthorizedRetry
	}
	if err != nil {
		a.failures++
		if a.failures == 1 {
			a.offlineSince = a.now()
		}
		a.log.Printf("fetch failed (%d in a row): %v", a.failures, err)
		if a.failures >= 2 {
			a.showStatus("offline seit " + a.offlineSince.In(a.loc).Format("15:04"))
		}
		return a.backoff.Next()
	}
	a.failures = 0
	a.backoff.Reset()
	if s.ETag == "" || s.ETag != a.lastETag || a.statusText != "" || s.FullRefresh {
		// A full refresh after a label clears the label box's e-ink ghosting; the
		// first image of a session needs one too, or the Kindle library ghosts through.
		full := s.FullRefresh || a.statusText != "" || a.lastPNG == nil
		if err := a.display.ShowImage(s.PNG, full); err != nil {
			a.log.Printf("display: %v", err)
		} else {
			a.lastPNG, a.lastETag, a.statusText = s.PNG, s.ETag, ""
		}
	}
	wait := time.Duration(s.RefreshSeconds) * time.Second
	a.sleepWifi(wait)
	return wait
}

func (a *App) showStatus(text string) {
	if a.statusText == text {
		return
	}
	img, err := a.overlay(a.lastPNG, text)
	if err != nil {
		a.log.Printf("overlay: %v", err)
		return
	}
	if err := a.display.ShowImage(img, false); err != nil {
		a.log.Printf("display: %v", err)
		return
	}
	a.statusText = text
}

// Run fetches immediately, then alternates between timed refreshes and taps until ctx ends.
// The touch goroutine must call gate.TryAcquire before sending on taps; Run releases it.
func (a *App) Run(ctx context.Context, taps <-chan Point, gate *Gate) {
	defer a.RestoreWifi()
	next := a.after(a.Refresh(ctx))
	for {
		select {
		case <-ctx.Done():
			return
		case p := <-taps:
			d := a.HandleTap(ctx, p)
			gate.Release()
			if d > 0 {
				next = a.after(d)
			}
		case <-next:
			next = a.after(a.Refresh(ctx))
		}
	}
}

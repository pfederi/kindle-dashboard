package main

import (
	"context"
	"fmt"
	"log"
	"time"
)

// watchdogTimeout is how long the restore may take once an exit was triggered.
const watchdogTimeout = 20 * time.Second

// shutdownSteps are the restore actions, run in this order. Injected for tests.
type shutdownSteps struct {
	stopApp       func()       // stop the app loop (cancel its context)
	closeDevices  func()       // ungrab and close the input devices
	resumeWM      func() error // SIGCONT the window manager
	restoreScreen func() error // put the saved framebuffer back
	showStatusBar func() error // enable pillow
	allowScreen   func() error // preventScreenSaver 0
	startHome     func() error // show the library
}

// shutdown runs the steps in order; a failing or panicking step never skips the next one.
func shutdown(s shutdownSteps, logger *log.Logger) {
	step := func(name string, f func() error) {
		defer func() {
			if r := recover(); r != nil {
				logger.Printf("restore %s: panic: %v", name, r)
			}
		}()
		if err := f(); err != nil {
			logger.Print(err)
		}
	}
	step("stop app", func() error { s.stopApp(); return nil })
	step("close devices", func() error { s.closeDevices(); return nil })
	step("resume window manager", s.resumeWM)
	step("restore framebuffer", s.restoreScreen)
	step("status bar", s.showStatusBar)
	step("preventScreenSaver", s.allowScreen)
	step("start home", s.startHome)
	logger.Print("exit: Kindle UI restored")
}

// watchdog waits for ctx to end (an exit was triggered). If done is not closed
// within timeout afterwards, it logs and calls fire; the shell wrapper then
// restores the Kindle UI. It returns when done is closed or fire was called.
func watchdog(ctx context.Context, timeout time.Duration, done <-chan struct{}, fire func(), logger *log.Logger) {
	select {
	case <-done:
		return
	case <-ctx.Done():
	}
	select {
	case <-done:
	case <-time.After(timeout):
		logger.Printf("watchdog: restore not finished %v after exit; terminating", timeout)
		fire()
	}
}

// takeOverSteps are the actions that hand the screen from the Kindle UI to the
// dashboard. Injected for tests.
type takeOverSteps struct {
	preventScreen func(on bool) error
	saveScreen    func() error
	hideStatusBar func() error
	pauseWM       func() error
}

// takeOverScreen pauses the Kindle UI, which keeps running in the background. If
// the window manager cannot be paused it returns an error and the caller must
// abort, so the dashboard never draws over a live UI.
func takeOverScreen(s takeOverSteps, logger *log.Logger) error {
	if err := s.preventScreen(true); err != nil {
		logger.Print(err)
	}
	// Without the saved screen the library still redraws itself on exit.
	if err := s.saveScreen(); err != nil {
		logger.Print(err)
	}
	if err := s.hideStatusBar(); err != nil {
		logger.Print(err)
	}
	if err := s.pauseWM(); err != nil {
		return fmt.Errorf("pause window manager: %w", err)
	}
	return nil
}

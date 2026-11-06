package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"reflect"
	"sync/atomic"
	"testing"
	"time"
)

var quiet = log.New(io.Discard, "", 0)

func TestShutdownOrder(t *testing.T) {
	var got []string
	rec := func(n string) { got = append(got, n) }
	shutdown(shutdownSteps{
		stopApp:       func() { rec("app") },
		closeDevices:  func() { rec("devices") },
		resumeWM:      func() error { rec("wm"); return nil },
		restoreScreen: func() error { rec("fb"); return nil },
		showStatusBar: func() error { rec("pillow"); return nil },
		allowScreen:   func() error { rec("screensaver"); return nil },
		startHome:     func() error { rec("home"); return nil },
	}, quiet)
	want := []string{"app", "devices", "wm", "fb", "pillow", "screensaver", "home"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("order = %v, want %v", got, want)
	}
}

func TestShutdownContinuesAfterPanic(t *testing.T) {
	home := false
	shutdown(shutdownSteps{
		stopApp:       func() {},
		closeDevices:  func() { panic("boom") },
		resumeWM:      func() error { return errors.New("killall failed") },
		restoreScreen: func() error { panic("boom2") },
		showStatusBar: func() error { return nil },
		allowScreen:   func() error { return nil },
		startHome:     func() error { home = true; return nil },
	}, quiet)
	if !home {
		t.Fatal("library not started after earlier steps failed or panicked")
	}
}

func TestWatchdogFiresWhenRestoreHangs(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	var fired atomic.Bool
	fin := make(chan struct{})
	go func() {
		watchdog(ctx, 30*time.Millisecond, done, func() { fired.Store(true) }, quiet)
		close(fin)
	}()
	cancel() // exit triggered; done is never closed (a step hangs)
	select {
	case <-fin:
	case <-time.After(2 * time.Second):
		t.Fatal("watchdog did not return")
	}
	if !fired.Load() {
		t.Fatal("watchdog did not fire")
	}
}

func TestWatchdogQuietWhenRestoreFinishes(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	var fired atomic.Bool
	fin := make(chan struct{})
	go func() {
		watchdog(ctx, 200*time.Millisecond, done, func() { fired.Store(true) }, quiet)
		close(fin)
	}()
	cancel()
	close(done)
	<-fin
	time.Sleep(250 * time.Millisecond)
	if fired.Load() {
		t.Fatal("watchdog fired although restore finished")
	}
}

func takeOverRecorder(got *[]string, wmErr error) takeOverSteps {
	rec := func(n string, err error) func() error {
		return func() error { *got = append(*got, n); return err }
	}
	return takeOverSteps{
		preventScreen: func(on bool) error { *got = append(*got, fmt.Sprint("prevent ", on)); return errors.New("ignored") },
		saveScreen:    rec("save", errors.New("ignored")),
		hideStatusBar: rec("pillow", errors.New("ignored")),
		pauseWM:       rec("wm", wmErr),
	}
}

func TestTakeOverScreenPausesTheUIAndIgnoresMinorFailures(t *testing.T) {
	var got []string
	if err := takeOverScreen(takeOverRecorder(&got, nil), quiet); err != nil {
		t.Fatal(err)
	}
	want := []string{"prevent true", "save", "pillow", "wm"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("calls = %v, want %v", got, want)
	}
}

func TestTakeOverScreenAbortsWhenTheWindowManagerKeepsRunning(t *testing.T) {
	var got []string
	if err := takeOverScreen(takeOverRecorder(&got, errors.New("no process")), quiet); err == nil {
		t.Fatal("want error when the window manager cannot be paused")
	}
}

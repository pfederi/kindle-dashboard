// Package wifi keeps the Kindle connected to the WLAN.
package wifi

import (
	"context"
	"errors"
	"fmt"
	"time"
)

// ErrNotConnected is returned when the WLAN stays down after both attempts.
var ErrNotConnected = errors.New("wifi: not connected")

// Radio is implemented by device.System.
type Radio interface {
	WifiState() (string, error)
	SetWireless(on bool) error
}

// Ensurer enables Wi-Fi, waits up to Timeout, and toggles it off/on once if needed.
type Ensurer struct {
	Radio   Radio
	Sleep   func(ctx context.Context, d time.Duration) error
	Poll    time.Duration
	Timeout time.Duration
}

// New returns an Ensurer with the spec's 45 s wait.
func New(r Radio) *Ensurer {
	return &Ensurer{Radio: r, Sleep: sleepCtx, Poll: time.Second, Timeout: 45 * time.Second}
}

// EnsureConnected returns nil once cmState is CONNECTED.
func (e *Ensurer) EnsureConnected(ctx context.Context) error {
	if e.connected() {
		return nil
	}
	if err := e.Radio.SetWireless(true); err != nil {
		return fmt.Errorf("wifi: enable: %w", err)
	}
	if ok, err := e.wait(ctx); err != nil {
		return err
	} else if ok {
		return nil
	}
	_ = e.Radio.SetWireless(false)
	if err := e.Sleep(ctx, 2*time.Second); err != nil {
		return err
	}
	if err := e.Radio.SetWireless(true); err != nil {
		return fmt.Errorf("wifi: re-enable: %w", err)
	}
	if ok, err := e.wait(ctx); err != nil {
		return err
	} else if ok {
		return nil
	}
	return ErrNotConnected
}

func (e *Ensurer) connected() bool {
	s, err := e.Radio.WifiState()
	return err == nil && s == "CONNECTED"
}

func (e *Ensurer) wait(ctx context.Context) (bool, error) {
	for waited := time.Duration(0); waited < e.Timeout; waited += e.Poll {
		if err := e.Sleep(ctx, e.Poll); err != nil {
			return false, err
		}
		if e.connected() {
			return true, nil
		}
	}
	return false, nil
}

func sleepCtx(ctx context.Context, d time.Duration) error {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.C:
		return nil
	}
}

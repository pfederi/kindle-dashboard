//go:build !linux

package input

import (
	"errors"

	"kindle-dashboard/client/internal/touch"
)

var errUnsupported = errors.New("input: evdev is only available on linux")

// Device is a stub so the module compiles on non-Linux hosts.
type Device struct{}

// Open always fails outside Linux.
func Open(path string) (*Device, error) { return nil, errUnsupported }

// Grab always fails outside Linux.
func (d *Device) Grab() error { return errUnsupported }

// AbsRange always fails outside Linux.
func (d *Device) AbsRange(axis uint16) (touch.AbsRange, error) {
	return touch.AbsRange{}, errUnsupported
}

// Reader is unavailable outside Linux.
func (d *Device) Reader() *touch.Reader { return nil }

// Close is a no-op outside Linux.
func (d *Device) Close() error { return nil }

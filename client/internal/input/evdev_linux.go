//go:build linux

package input

import (
	"fmt"
	"os"
	"syscall"
	"unsafe"

	"kindle-dashboard/client/internal/touch"
)

// ioctl request encoding from <asm-generic/ioctl.h> (used by ARM).
func ioc(dir, typ, nr, size uintptr) uintptr { return dir<<30 | size<<16 | typ<<8 | nr }

const (
	iocWrite = 1
	iocRead  = 2
)

// evioCGrab = _IOW('E', 0x90, int)
var evioCGrab = ioc(iocWrite, 'E', 0x90, 4)

// evioCGAbs = _IOR('E', 0x40 + axis, struct input_absinfo)
func evioCGAbs(axis uint16) uintptr { return ioc(iocRead, 'E', 0x40+uintptr(axis), 24) }

// absInfo mirrors struct input_absinfo (six s32 fields).
type absInfo struct {
	Value, Minimum, Maximum, Fuzz, Flat, Resolution int32
}

// Device is an opened evdev node.
type Device struct {
	f       *os.File
	grabbed bool
}

// fileIoctl runs an ioctl on f without calling f.Fd(), which would switch the
// descriptor to blocking mode and stop Close() from unblocking readers.
func fileIoctl(f *os.File, req uintptr, arg unsafe.Pointer) error {
	rc, err := f.SyscallConn()
	if err != nil {
		return err
	}
	var ierr error
	if err := rc.Control(func(fd uintptr) { ierr = ioctl(fd, req, arg) }); err != nil {
		return err
	}
	return ierr
}

// Open opens an evdev node such as /dev/input/event1 for reading.
func Open(path string) (*Device, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("input: %w", err)
	}
	return &Device{f: f}, nil
}

// Grab takes exclusive access so no other process (e.g. a leftover GUI) sees the events.
func (d *Device) Grab() error {
	one := int32(1) // any non-zero arg grabs
	if err := fileIoctl(d.f, evioCGrab, unsafe.Pointer(&one)); err != nil {
		return fmt.Errorf("input: EVIOCGRAB: %w", err)
	}
	d.grabbed = true
	return nil
}

// AbsRange reads the value range of an absolute axis.
func (d *Device) AbsRange(axis uint16) (touch.AbsRange, error) {
	var info absInfo
	if err := fileIoctl(d.f, evioCGAbs(axis), unsafe.Pointer(&info)); err != nil {
		return touch.AbsRange{}, fmt.Errorf("input: EVIOCGABS(%#x): %w", axis, err)
	}
	return touch.AbsRange{Min: info.Minimum, Max: info.Maximum}, nil
}

// Reader returns an event reader on the device.
func (d *Device) Reader() *touch.Reader { return touch.NewReader(d.f) }

// Close releases the grab and closes the node.
func (d *Device) Close() error {
	if d.grabbed {
		_ = fileIoctl(d.f, evioCGrab, nil) // arg 0 releases the grab
	}
	return d.f.Close()
}

func ioctl(fd, req uintptr, arg unsafe.Pointer) error {
	if _, _, errno := syscall.Syscall(syscall.SYS_IOCTL, fd, req, uintptr(arg)); errno != 0 {
		return errno
	}
	return nil
}

//go:build linux

package input

import (
	"os"
	"testing"
	"time"
)

func TestIoctlNumbers(t *testing.T) {
	if evioCGrab != 0x40044590 {
		t.Errorf("EVIOCGRAB = %#x, want 0x40044590", evioCGrab)
	}
	if got := evioCGAbs(0x35); got != 0x80184575 {
		t.Errorf("EVIOCGABS(ABS_MT_POSITION_X) = %#x, want 0x80184575", got)
	}
}

func TestCloseUnblocksReader(t *testing.T) {
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	defer w.Close()
	d := &Device{f: r}
	done := make(chan error, 1)
	go func() {
		_, err := d.Reader().Next()
		done <- err
	}()
	time.Sleep(50 * time.Millisecond)
	// The ioctl path must not switch the fd to blocking mode (no Fd()).
	_ = fileIoctl(r, evioCGrab, nil) // fails with ENOTTY on a pipe; only exercising the path
	if err := d.Close(); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-done:
		if err == nil {
			t.Error("reader returned nil error after Close")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("Close did not unblock the blocked reader")
	}
}

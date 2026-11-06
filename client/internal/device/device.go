// Package device wraps the Kindle's command-line tools (fbink, lipc, upstart).
package device

import (
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
	"time"
)

// Runner executes a command and returns its combined output.
type Runner func(name string, args ...string) ([]byte, error)

var fallbackDirs = []string{"/usr/bin", "/bin", "/usr/sbin", "/sbin", "/usr/local/bin"}

// resolve returns the LookPath result when that succeeds.
// Otherwise it returns the first existing <dir>/name for dir in fallbackDirs.
// If nothing is found, it returns name unchanged.
func resolve(name string, look func(string) (string, error), exists func(string) bool) string {
	if path, err := look(name); err == nil {
		return path
	}
	for _, dir := range fallbackDirs {
		path := dir + "/" + name
		if exists(path) {
			return path
		}
	}
	return name
}

// Exec runs commands for real with a 60s timeout and PATH fallback.
func Exec(name string, args ...string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	resolved := resolve(name, exec.LookPath, FileExists)
	return exec.CommandContext(ctx, resolved, args...).CombinedOutput()
}

// FBInkPaths lists the fbink locations of the WinterBreak2 environment in order of preference.
var FBInkPaths = []string{"/var/local/kmc/bin/fbink", "/mnt/us/libkh/bin/fbink"}

// FindFBInk returns the first existing fbink binary.
func FindFBInk(exists func(string) bool) (string, error) {
	for _, p := range FBInkPaths {
		if exists(p) {
			return p, nil
		}
	}
	return "", fmt.Errorf("device: fbink not found in %s", strings.Join(FBInkPaths, ", "))
}

// FileExists reports whether path is an existing regular file.
func FileExists(path string) bool {
	st, err := os.Stat(path)
	return err == nil && st.Mode().IsRegular()
}

// FBInk draws images on the e-ink screen.
type FBInk struct {
	Path    string
	TmpFile string
	Run     Runner
}

// ShowImage writes png to TmpFile and displays it; full requests a flashing full refresh.
func (f FBInk) ShowImage(png []byte, full bool) error {
	tmp := f.TmpFile + ".tmp"
	if err := os.WriteFile(tmp, png, 0o600); err != nil {
		return fmt.Errorf("fbink: %w", err)
	}
	if err := os.Rename(tmp, f.TmpFile); err != nil {
		return fmt.Errorf("fbink: %w", err)
	}
	args := []string{"-q"}
	if full {
		args = append(args, "-f")
	}
	args = append(args, "-g", "file="+f.TmpFile)
	if out, err := f.Run(f.Path, args...); err != nil {
		return fmt.Errorf("fbink: %w: %s", err, strings.TrimSpace(string(out)))
	}
	return nil
}

// System controls the Kindle framework, screensaver and Wi-Fi.
type System struct{ Run Runner }

func onOff(on bool) string {
	if on {
		return "1"
	}
	return "0"
}

func (s System) run(name string, args ...string) error {
	if out, err := s.Run(name, args...); err != nil {
		return fmt.Errorf("%s %s: %w: %s", name, strings.Join(args, " "), err, strings.TrimSpace(string(out)))
	}
	return nil
}

// PreventScreenSaver toggles com.lab126.powerd preventScreenSaver.
func (s System) PreventScreenSaver(on bool) error {
	return s.run("lipc-set-prop", "com.lab126.powerd", "preventScreenSaver", onOff(on))
}

// The Kindle UI is paused while the dashboard runs, not stopped (as KOReader does on
// FW 5.x): restarting lab126_gui shows a 30 s boot splash, and appmgrd, which keeps
// running, then times out launching the library and shows «appmgrAppFailedFatal».

// SetStatusBar enables or disables the Kindle status bar (pillow).
func (s System) SetStatusBar(on bool) error {
	v := "disable"
	if on {
		v = "enable"
	}
	return s.run("lipc-set-prop", "com.lab126.pillow", "disableEnablePillow", v)
}

// PauseWindowManager stops (SIGSTOP) or continues (SIGCONT) the awesome window
// manager, so the Kindle UI cannot draw over the dashboard.
func (s System) PauseWindowManager(pause bool) error {
	sig := "-CONT"
	if pause {
		sig = "-STOP"
	}
	return s.run("killall", sig, "awesome")
}

// StartHome asks appmgrd to show the library, which redraws the screen.
func (s System) StartHome() error {
	return s.run("lipc-set-prop", "com.lab126.appmgrd", "start", "app://com.lab126.booklet.home")
}

// Framebuffer saves the screen contents before the dashboard draws, and puts
// them back on exit so the Kindle UI reappears as it was.
type Framebuffer struct {
	Device string // e.g. /dev/fb0
	Dump   string // e.g. /tmp/dashboard-fb.dump
}

// Save copies the framebuffer into Dump.
func (f Framebuffer) Save() error {
	src, err := os.Open(f.Device)
	if err != nil {
		return fmt.Errorf("framebuffer save: %w", err)
	}
	defer src.Close()
	dst, err := os.OpenFile(f.Dump, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o600)
	if err != nil {
		return fmt.Errorf("framebuffer save: %w", err)
	}
	if _, err := io.Copy(dst, src); err != nil {
		dst.Close()
		return fmt.Errorf("framebuffer save: %w", err)
	}
	return dst.Close()
}

// Restore writes Dump back into the framebuffer; the device is never created or truncated.
func (f Framebuffer) Restore() error {
	src, err := os.Open(f.Dump)
	if err != nil {
		return fmt.Errorf("framebuffer restore: %w", err)
	}
	defer src.Close()
	dst, err := os.OpenFile(f.Device, os.O_WRONLY, 0)
	if err != nil {
		return fmt.Errorf("framebuffer restore: %w", err)
	}
	if _, err := io.Copy(dst, src); err != nil {
		dst.Close()
		return fmt.Errorf("framebuffer restore: %w", err)
	}
	return dst.Close()
}

// WifiState returns com.lab126.wifid cmState, e.g. "CONNECTED".
func (s System) WifiState() (string, error) {
	out, err := s.Run("lipc-get-prop", "com.lab126.wifid", "cmState")
	if err != nil {
		return "", fmt.Errorf("lipc-get-prop cmState: %w: %s", err, strings.TrimSpace(string(out)))
	}
	return strings.TrimSpace(string(out)), nil
}

// SetWireless toggles com.lab126.cmd wirelessEnable.
func (s System) SetWireless(on bool) error {
	return s.run("lipc-set-prop", "com.lab126.cmd", "wirelessEnable", onOff(on))
}

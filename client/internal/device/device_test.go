package device

import (
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

type recorder struct {
	calls [][]string
	out   string
	err   error
}

func (r *recorder) run(name string, args ...string) ([]byte, error) {
	r.calls = append(r.calls, append([]string{name}, args...))
	return []byte(r.out), r.err
}

func TestFindFBInkPrefersKMC(t *testing.T) {
	p, err := FindFBInk(func(string) bool { return true })
	if err != nil || p != "/var/local/kmc/bin/fbink" {
		t.Fatalf("got %q, %v", p, err)
	}
	p, err = FindFBInk(func(s string) bool { return s == "/mnt/us/libkh/bin/fbink" })
	if err != nil || p != "/mnt/us/libkh/bin/fbink" {
		t.Fatalf("fallback: got %q, %v", p, err)
	}
	if _, err := FindFBInk(func(string) bool { return false }); err == nil {
		t.Fatal("expected error when fbink is missing")
	}
}

func TestShowImageWritesFileAndCallsFBInk(t *testing.T) {
	r := &recorder{}
	tmp := filepath.Join(t.TempDir(), "dashboard.png")
	f := FBInk{Path: "/fbink", TmpFile: tmp, Run: r.run}
	if err := f.ShowImage([]byte("png"), false); err != nil {
		t.Fatal(err)
	}
	if err := f.ShowImage([]byte("png2"), true); err != nil {
		t.Fatal(err)
	}
	want := [][]string{
		{"/fbink", "-q", "-g", "file=" + tmp},
		{"/fbink", "-q", "-f", "-g", "file=" + tmp},
	}
	if !reflect.DeepEqual(r.calls, want) {
		t.Fatalf("calls = %v", r.calls)
	}
	if data, _ := os.ReadFile(tmp); string(data) != "png2" {
		t.Fatalf("tmp file = %q", data)
	}
}

func TestShowImageReportsFBInkOutput(t *testing.T) {
	r := &recorder{out: "Failed to open framebuffer", err: errors.New("exit status 1")}
	f := FBInk{Path: "/fbink", TmpFile: filepath.Join(t.TempDir(), "x.png"), Run: r.run}
	err := f.ShowImage([]byte("png"), false)
	if err == nil || !strings.Contains(err.Error(), "Failed to open framebuffer") {
		t.Fatalf("err = %v", err)
	}
}

func TestResolve(t *testing.T) {
	// Test successful LookPath
	resolved := resolve("go", func(name string) (string, error) {
		return "/usr/bin/" + name, nil
	}, func(string) bool { return true })
	if resolved != "/usr/bin/go" {
		t.Fatalf("got %q", resolved)
	}

	// Test fallback when LookPath fails
	resolved = resolve("custom", func(string) (string, error) {
		return "", errors.New("not found")
	}, func(s string) bool { return s == "/sbin/custom" })
	if resolved != "/sbin/custom" {
		t.Fatalf("got %q", resolved)
	}

	// Test fallback returns original name when nothing found
	resolved = resolve("missing", func(string) (string, error) {
		return "", errors.New("not found")
	}, func(string) bool { return false })
	if resolved != "missing" {
		t.Fatalf("got %q", resolved)
	}
}

func TestFileExists(t *testing.T) {
	tmpdir := t.TempDir()
	tmp := filepath.Join(tmpdir, "file.txt")
	if err := os.WriteFile(tmp, []byte("test"), 0644); err != nil {
		t.Fatal(err)
	}
	if !FileExists(tmp) {
		t.Fatal("FileExists should return true for existing file")
	}
	if FileExists(filepath.Join(tmpdir, "missing.txt")) {
		t.Fatal("FileExists should return false for missing file")
	}
	if FileExists(tmpdir) {
		t.Fatal("FileExists should return false for directory")
	}
}

func TestSystemCommands(t *testing.T) {
	r := &recorder{out: "CONNECTED\n"}
	s := System{Run: r.run}
	s.PreventScreenSaver(true)
	s.SetStatusBar(false)
	s.PauseWindowManager(true)
	s.SetWireless(true)
	s.SetWireless(false)
	s.PauseWindowManager(false)
	s.SetStatusBar(true)
	s.PreventScreenSaver(false)
	s.StartHome()
	state, err := s.WifiState()
	if err != nil || state != "CONNECTED" {
		t.Fatalf("WifiState = %q, %v", state, err)
	}
	want := [][]string{
		{"lipc-set-prop", "com.lab126.powerd", "preventScreenSaver", "1"},
		{"lipc-set-prop", "com.lab126.pillow", "disableEnablePillow", "disable"},
		{"killall", "-STOP", "awesome"},
		{"lipc-set-prop", "com.lab126.cmd", "wirelessEnable", "1"},
		{"lipc-set-prop", "com.lab126.cmd", "wirelessEnable", "0"},
		{"killall", "-CONT", "awesome"},
		{"lipc-set-prop", "com.lab126.pillow", "disableEnablePillow", "enable"},
		{"lipc-set-prop", "com.lab126.powerd", "preventScreenSaver", "0"},
		{"lipc-set-prop", "com.lab126.appmgrd", "start", "app://com.lab126.booklet.home"},
		{"lipc-get-prop", "com.lab126.wifid", "cmState"},
	}
	if !reflect.DeepEqual(r.calls, want) {
		t.Fatalf("calls = %v", r.calls)
	}
}

func TestSystemErrorWithOutput(t *testing.T) {
	r := &recorder{out: "error message\n", err: errors.New("exit status 1")}
	s := System{Run: r.run}
	err := s.PreventScreenSaver(true)
	if err == nil || !strings.Contains(err.Error(), "error message") {
		t.Fatalf("err = %v", err)
	}
}

func TestBattery(t *testing.T) {
	outs := map[string]string{"battLevel": "18\n", "isCharging": "1\n"}
	var calls [][]string
	s := System{Run: func(name string, args ...string) ([]byte, error) {
		calls = append(calls, append([]string{name}, args...))
		return []byte(outs[args[len(args)-1]]), nil
	}}
	level, charging, err := s.Battery()
	if err != nil || level != 18 || !charging {
		t.Fatalf("Battery = %d, %v, %v", level, charging, err)
	}
	want := [][]string{
		{"lipc-get-prop", "com.lab126.powerd", "battLevel"},
		{"lipc-get-prop", "com.lab126.powerd", "isCharging"},
	}
	if !reflect.DeepEqual(calls, want) {
		t.Fatalf("calls = %v", calls)
	}
	outs["isCharging"] = "0"
	if _, charging, _ := s.Battery(); charging {
		t.Fatal("charging with isCharging 0")
	}
}

func TestBatteryErrors(t *testing.T) {
	for _, out := range []string{"", "abc", "101", "-1"} {
		s := System{Run: func(string, ...string) ([]byte, error) { return []byte(out), nil }}
		if _, _, err := s.Battery(); err == nil {
			t.Errorf("Battery with %q: no error", out)
		}
	}
	r := &recorder{out: "no such property\n", err: errors.New("exit status 1")}
	if _, _, err := (System{Run: r.run}).Battery(); err == nil || !strings.Contains(err.Error(), "no such property") {
		t.Fatalf("err = %v", err)
	}
}

func TestWifiStateError(t *testing.T) {
	r := &recorder{out: "cmState command failed\n", err: errors.New("exit status 1")}
	s := System{Run: r.run}
	_, err := s.WifiState()
	if err == nil || !strings.Contains(err.Error(), "cmState command failed") {
		t.Fatalf("err = %v", err)
	}
}

func TestFramebufferSaveAndRestore(t *testing.T) {
	dir := t.TempDir()
	fb := filepath.Join(dir, "fb0")
	if err := os.WriteFile(fb, []byte("library screen"), 0o600); err != nil {
		t.Fatal(err)
	}
	f := Framebuffer{Device: fb, Dump: filepath.Join(dir, "dump")}
	if err := f.Save(); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(fb, []byte("dashboard pic"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := f.Restore(); err != nil {
		t.Fatal(err)
	}
	if got, _ := os.ReadFile(fb); string(got) != "library screen" {
		t.Fatalf("framebuffer = %q after restore", got)
	}
}

func TestFramebufferRestoreNeverCreatesTheDevice(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "dump"), []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	f := Framebuffer{Device: filepath.Join(dir, "missing-fb0"), Dump: filepath.Join(dir, "dump")}
	if err := f.Restore(); err == nil {
		t.Fatal("want error for a missing framebuffer device")
	}
	if FileExists(f.Device) {
		t.Fatal("Restore created the device file")
	}
}

func TestShowImageTmpFileAtomic(t *testing.T) {
	r := &recorder{}
	tmpdir := t.TempDir()
	tmp := filepath.Join(tmpdir, "dashboard.png")
	f := FBInk{Path: "/fbink", TmpFile: tmp, Run: r.run}

	// Check that tmp.tmp is created and renamed
	if err := f.ShowImage([]byte("png"), false); err != nil {
		t.Fatal(err)
	}

	// The final file should exist and contain the PNG
	if data, _ := os.ReadFile(tmp); string(data) != "png" {
		t.Fatalf("tmp file = %q", data)
	}

	// tmp.tmp should not exist after completion
	if _, err := os.Stat(tmp + ".tmp"); err == nil {
		t.Fatal("tmp.tmp should not exist after successful write")
	}
}

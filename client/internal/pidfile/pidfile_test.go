package pidfile

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestAcquireAndRelease(t *testing.T) {
	p := filepath.Join(t.TempDir(), "dashboard.pid")
	alive := func(int) bool { return true }
	if err := Acquire(p, 100, alive); err != nil {
		t.Fatal(err)
	}
	if err := Acquire(p, 200, alive); !errors.Is(err, ErrRunning) {
		t.Fatalf("second instance: got %v, want ErrRunning", err)
	}
	if err := Release(p, 200); err != nil { // not ours: file stays
		t.Fatal(err)
	}
	if _, err := os.Stat(p); err != nil {
		t.Fatal("pid file removed by foreign pid")
	}
	if err := Release(p, 100); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(p); !os.IsNotExist(err) {
		t.Fatal("pid file not removed")
	}
}

func TestAcquireTakesOverStaleFile(t *testing.T) {
	p := filepath.Join(t.TempDir(), "dashboard.pid")
	os.WriteFile(p, []byte("4242\n"), 0o644)
	if err := Acquire(p, 100, func(int) bool { return false }); err != nil {
		t.Fatalf("stale pid file should be taken over: %v", err)
	}
	if err := Acquire(filepath.Join(t.TempDir(), "x.pid"), 1, nil); err != nil {
		t.Fatalf("missing file: %v", err)
	}
}

func TestProcessAliveForSelf(t *testing.T) {
	if !ProcessAlive(os.Getpid()) {
		t.Fatal("own process reported dead")
	}
}

func TestGarbagePidfileIsReplaced(t *testing.T) {
	p := filepath.Join(t.TempDir(), "dashboard.pid")
	// Write garbage that won't parse
	if err := os.WriteFile(p, []byte("not_a_number\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	// Acquire should replace it
	if err := Acquire(p, 100, func(int) bool { return true }); err != nil {
		t.Fatalf("should replace garbage pidfile: %v", err)
	}
	// Verify the file now contains our pid
	content, err := os.ReadFile(p)
	if err != nil {
		t.Fatal(err)
	}
	if string(content) != "100\n" {
		t.Fatalf("pidfile should contain 100, got %q", content)
	}
}

func TestDeadPidfileIsReplaced(t *testing.T) {
	p := filepath.Join(t.TempDir(), "dashboard.pid")
	// Write a pid that is definitely dead
	if err := os.WriteFile(p, []byte("999999\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	// Acquire should replace it (process almost certainly doesn't exist)
	if err := Acquire(p, 100, ProcessAlive); err != nil {
		t.Fatalf("should replace dead pidfile: %v", err)
	}
	// Verify the file now contains our pid
	content, err := os.ReadFile(p)
	if err != nil {
		t.Fatal(err)
	}
	if string(content) != "100\n" {
		t.Fatalf("pidfile should contain 100, got %q", content)
	}
}

func TestReleaseIgnoresMissingFile(t *testing.T) {
	p := filepath.Join(t.TempDir(), "dashboard.pid")
	// Release on a non-existent file should not error
	if err := Release(p, 100); err != nil {
		t.Fatalf("Release on missing file should not error: %v", err)
	}
}

func TestProcessAliveWithProcFile(t *testing.T) {
	// Test aliveWithProc with a fake /proc directory
	tmpdir := t.TempDir()

	// Test 1: matching process name -> alive
	procDir := filepath.Join(tmpdir, "100")
	if err := os.MkdirAll(procDir, 0o755); err != nil {
		t.Fatal(err)
	}
	cmdline := filepath.Join(procDir, "cmdline")
	// Write a cmdline with the process name we're looking for
	if err := os.WriteFile(cmdline, []byte("dashboard\x00--flag\x00"), 0o644); err != nil {
		t.Fatal(err)
	}
	if !aliveWithProc(100, tmpdir, "dashboard") {
		t.Fatal("process with matching name should be alive")
	}

	// Test 2: different process name -> dead
	if aliveWithProc(100, tmpdir, "other-process") {
		t.Fatal("process with different name should be dead")
	}

	// Test 3: missing /proc/<pid> -> dead
	if aliveWithProc(999, tmpdir, "dashboard") {
		t.Fatal("process with missing /proc dir should be dead")
	}
}

func TestAliveWithProcCmdlineWithoutNUL(t *testing.T) {
	tmpdir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(tmpdir, "7"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(tmpdir, "7", "cmdline"), []byte("/mnt/us/dashboard/dashboard"), 0o644); err != nil {
		t.Fatal(err)
	}
	if !aliveWithProc(7, tmpdir, "dashboard") {
		t.Fatal("cmdline without trailing NUL not recognised")
	}
}

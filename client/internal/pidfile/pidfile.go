// Package pidfile prevents two dashboard instances from running at once.
package pidfile

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"syscall"
)

// ErrRunning means another live process owns the pid file.
var ErrRunning = errors.New("pidfile: another instance is running")

// Acquire writes pid to path atomically using O_EXCL, unless the file names a different live process.
func Acquire(path string, pid int, alive func(int) bool) error {
	pidStr := strconv.Itoa(pid) + "\n"
	pidBytes := []byte(pidStr)

	// Try to create the file atomically with O_EXCL
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
	if err == nil {
		// Successfully created; write our pid and close
		return writeAndClose(f, pidBytes)
	}

	// File already exists; check if we can take it over
	if !errors.Is(err, os.ErrExist) {
		return fmt.Errorf("pidfile: %w", err)
	}

	// Read the existing file
	other, ok := read(path)
	if !ok {
		// Garbage or empty file; try to remove and retry once
		os.Remove(path)
		f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
		if err != nil {
			return fmt.Errorf("pidfile: %w", err)
		}
		return writeAndClose(f, pidBytes)
	}

	// File contains a valid pid
	if other == pid {
		// It's already ours; just write it again
		return os.WriteFile(path, pidBytes, 0o644)
	}

	// It's a different pid; check if it's alive
	if alive != nil && alive(other) {
		return fmt.Errorf("%w (pid %d)", ErrRunning, other)
	}

	// The other process is dead; take over
	os.Remove(path)
	f, err = os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
	if err != nil {
		return fmt.Errorf("pidfile: %w", err)
	}
	return writeAndClose(f, pidBytes)
}

func writeAndClose(f *os.File, data []byte) error {
	_, werr := f.Write(data)
	if cerr := f.Close(); werr == nil {
		werr = cerr
	}
	if werr != nil {
		return fmt.Errorf("pidfile: %w", werr)
	}
	return nil
}

// Release removes path if it still contains pid.
// Returns nil if the file is already gone.
func Release(path string, pid int) error {
	if other, ok := read(path); ok && other == pid {
		if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
			return err
		}
	}
	return nil
}

// ProcessAlive reports whether a process with this pid exists.
// On Linux, it also checks that the process name matches the current executable.
// This mitigates pid reuse after reboot by rejecting unrelated processes.
func ProcessAlive(pid int) bool {
	if runtime.GOOS == "linux" {
		if len(os.Args) > 0 {
			selfName := filepath.Base(os.Args[0])
			return aliveWithProc(pid, "/proc", selfName)
		}
	}
	// Fallback: use kill(pid,0) to check if process exists
	err := syscall.Kill(pid, 0)
	return err == nil || errors.Is(err, syscall.EPERM)
}

// aliveWithProc checks if a process is alive by reading procRoot/<pid>/cmdline
// and comparing the program name to selfName.
// procRoot is typically "/proc" but can be overridden for testing.
func aliveWithProc(pid int, procRoot, selfName string) bool {
	cmdlineFile := filepath.Join(procRoot, strconv.Itoa(pid), "cmdline")
	data, err := os.ReadFile(cmdlineFile)
	if err != nil {
		// Process directory doesn't exist; process is dead
		return false
	}
	if len(data) == 0 {
		// Empty cmdline (shouldn't happen, but treat as dead)
		return false
	}
	// cmdline is NUL-separated; argv[0] is everything up to the first NUL
	argv0 := string(data)
	if i := strings.IndexByte(argv0, 0); i >= 0 {
		argv0 = argv0[:i]
	}
	progName := filepath.Base(argv0)
	return progName == selfName
}

func read(path string) (int, bool) {
	data, err := os.ReadFile(path)
	if err != nil {
		return 0, false
	}
	pid, err := strconv.Atoi(strings.TrimSpace(string(data)))
	return pid, err == nil && pid > 0
}

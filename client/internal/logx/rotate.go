// Package logx provides a size-limited log file for the device.
package logx

import (
	"fmt"
	"os"
	"sync"
)

// RotatingFile appends to path and renames it to path+".1" once it would exceed max bytes.
// A single write larger than max into an empty file is allowed; the file can transiently exceed max.
type RotatingFile struct {
	mu   sync.Mutex
	path string
	max  int64
	f    *os.File
	size int64
}

// OpenRotating opens (or creates) the log file.
func OpenRotating(path string, max int64) (*RotatingFile, error) {
	r := &RotatingFile{path: path, max: max}
	if err := r.open(); err != nil {
		return nil, err
	}
	return r, nil
}

func (r *RotatingFile) open() error {
	f, err := os.OpenFile(r.path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return fmt.Errorf("logx: %w", err)
	}
	st, err := f.Stat()
	if err != nil {
		f.Close()
		return fmt.Errorf("logx: %w", err)
	}
	r.f, r.size = f, st.Size()
	return nil
}

// Write implements io.Writer.
func (r *RotatingFile) Write(p []byte) (int, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.size > 0 && r.size+int64(len(p)) > r.max {
		// Try to rotate
		r.f.Close()
		os.Remove(r.path + ".1") // Clear any blocking file (ignore errors)
		if err := os.Rename(r.path, r.path+".1"); err != nil {
			// Rotation failed; reopen the original file and keep writing
			if reopenErr := r.open(); reopenErr != nil {
				// Cannot reopen; try truncating as a last resort
				r.f = nil
				r.size = 0
				return 0, fmt.Errorf("logx: rotate: %w", err)
			}
		} else {
			// Rotation succeeded; open a fresh file
			if err := r.open(); err != nil {
				r.f = nil
				r.size = 0
				return 0, err
			}
		}
	}
	// If r.f is nil, try to open it now
	if r.f == nil {
		if err := r.open(); err != nil {
			return 0, err
		}
	}
	// If size exceeded 2x max, truncate as fallback
	if r.size > 2*r.max {
		r.f.Close()
		if err := os.Truncate(r.path, 0); err != nil {
			r.f = nil
			r.size = 0
			return 0, fmt.Errorf("logx: truncate: %w", err)
		}
		if err := r.open(); err != nil {
			r.f = nil
			r.size = 0
			return 0, err
		}
	}
	n, err := r.f.Write(p)
	r.size += int64(n)
	return n, err
}

// Close closes the current file.
func (r *RotatingFile) Close() error {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.f.Close()
}

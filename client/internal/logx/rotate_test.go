package logx

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRotatesWhenLimitExceeded(t *testing.T) {
	p := filepath.Join(t.TempDir(), "client.log")
	r, err := OpenRotating(p, 100)
	if err != nil {
		t.Fatal(err)
	}
	first, second := strings.Repeat("a", 60), strings.Repeat("b", 60)
	for _, s := range []string{first, second} {
		if _, err := r.Write([]byte(s)); err != nil {
			t.Fatal(err)
		}
	}
	r.Close()
	cur, _ := os.ReadFile(p)
	old, _ := os.ReadFile(p + ".1")
	if string(cur) != second || string(old) != first {
		t.Fatalf("current=%q old=%q", cur, old)
	}
}

func TestContinuesExistingFileSize(t *testing.T) {
	p := filepath.Join(t.TempDir(), "client.log")
	if err := os.WriteFile(p, []byte(strings.Repeat("x", 90)), 0o644); err != nil {
		t.Fatal(err)
	}
	r, err := OpenRotating(p, 100)
	if err != nil {
		t.Fatal(err)
	}
	r.Write([]byte(strings.Repeat("y", 20)))
	r.Close()
	if _, err := os.Stat(p + ".1"); err != nil {
		t.Fatal("expected rotation because existing size counts towards the limit")
	}
}

func TestRotationFailureKeepsWriting(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "client.log")
	r, err := OpenRotating(p, 100)
	if err != nil {
		t.Fatal(err)
	}
	// Fill the file to trigger rotation on next write
	if _, err := r.Write([]byte(strings.Repeat("a", 60))); err != nil {
		t.Fatal(err)
	}
	// Create a directory at path+".1" to block the rename
	if err := os.Mkdir(p+".1", 0o755); err != nil {
		t.Fatal(err)
	}
	// Write again; should handle the rotation failure gracefully
	n, err := r.Write([]byte(strings.Repeat("b", 40)))
	if err != nil {
		t.Fatalf("write after rotation failure should succeed: %v", err)
	}
	if n != 40 {
		t.Fatalf("write returned %d bytes, want 40", n)
	}
	r.Close()
	// Verify the second write landed in the original file
	content, err := os.ReadFile(p)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(content), strings.Repeat("b", 40)) {
		t.Fatal("second write not found in file after rotation failure")
	}
}

package backoff

import (
	"testing"
	"time"
)

func TestSequenceAndReset(t *testing.T) {
	b := New()
	want := []time.Duration{30, 60, 120, 240, 480, 600, 600}
	for i, w := range want {
		if got := b.Next(); got != w*time.Second {
			t.Fatalf("step %d: got %v, want %v", i, got, w*time.Second)
		}
	}
	b.Reset()
	if got := b.Next(); got != 30*time.Second {
		t.Fatalf("after Reset: got %v", got)
	}
}

// Package backoff yields retry delays: 30 s, 60 s, 120 s, ... capped at 600 s.
package backoff

import "time"

// Backoff doubles the delay after every failure up to Max.
// Backoff is not thread-safe and must be used from a single goroutine.
type Backoff struct {
	Initial, Max time.Duration
	next         time.Duration
}

// New returns the spec's backoff (30 s doubling to at most 600 s).
func New() *Backoff { return &Backoff{Initial: 30 * time.Second, Max: 600 * time.Second} }

// Next returns the delay before the next retry.
func (b *Backoff) Next() time.Duration {
	if b.next == 0 {
		b.next = b.Initial
	}
	d := b.next
	b.next *= 2
	if b.next > b.Max {
		b.next = b.Max
	}
	return d
}

// Reset starts over after a success.
func (b *Backoff) Reset() { b.next = 0 }

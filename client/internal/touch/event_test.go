package touch

import (
	"bytes"
	"errors"
	"io"
	"testing"
)

func TestDecodeKnownBytes(t *testing.T) {
	// tv_sec=1, tv_usec=2, EV_ABS, ABS_MT_TRACKING_ID, value=-1
	raw := []byte{1, 0, 0, 0, 2, 0, 0, 0, 3, 0, 0x39, 0, 0xff, 0xff, 0xff, 0xff}
	got := Decode(raw)
	want := Event{Sec: 1, Usec: 2, Type: EvAbs, Code: AbsMTTrackingID, Value: -1}
	if got != want {
		t.Fatalf("Decode = %+v, want %+v", got, want)
	}
	if !bytes.Equal(want.Encode(), raw) {
		t.Fatalf("Encode = %v, want %v", want.Encode(), raw)
	}
}

func TestReaderReadsSequenceAndStopsAtEOF(t *testing.T) {
	a := Event{Type: EvAbs, Code: AbsMTPositionX, Value: 500}
	b := Event{Type: EvSyn, Code: SynReport}
	r := NewReader(bytes.NewReader(append(a.Encode(), b.Encode()...)))
	for _, want := range []Event{a, b} {
		got, err := r.Next()
		if err != nil || got != want {
			t.Fatalf("Next = %+v, %v; want %+v", got, err, want)
		}
	}
	if _, err := r.Next(); !errors.Is(err, io.EOF) {
		t.Fatalf("expected io.EOF, got %v", err)
	}
}

func TestReaderRejectsTruncatedEvent(t *testing.T) {
	r := NewReader(bytes.NewReader(make([]byte, 10)))
	if _, err := r.Next(); !errors.Is(err, io.ErrUnexpectedEOF) {
		t.Fatalf("expected io.ErrUnexpectedEOF, got %v", err)
	}
}

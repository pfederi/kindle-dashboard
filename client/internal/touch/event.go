// Package touch decodes Linux input events and turns touchscreen frames into gestures.
package touch

import (
	"encoding/binary"
	"io"
)

// Linux input event types and codes used by the Kindle touchscreen and power key.
const (
	EvSyn = 0x00
	EvKey = 0x01
	EvAbs = 0x03

	SynReport = 0x00

	AbsMTSlot       = 0x2f
	AbsMTPositionX  = 0x35
	AbsMTPositionY  = 0x36
	AbsMTTrackingID = 0x39
)

// EventSize is the size of struct input_event on 32-bit ARM (32-bit tv_sec and tv_usec).
const EventSize = 16

// Event is one struct input_event.
type Event struct {
	Sec, Usec uint32
	Type      uint16
	Code      uint16
	Value     int32
}

// Decode parses one 16-byte little-endian input_event.
// It requires len(b) >= 16.
func Decode(b []byte) Event {
	return Event{
		Sec:   binary.LittleEndian.Uint32(b[0:4]),
		Usec:  binary.LittleEndian.Uint32(b[4:8]),
		Type:  binary.LittleEndian.Uint16(b[8:10]),
		Code:  binary.LittleEndian.Uint16(b[10:12]),
		Value: int32(binary.LittleEndian.Uint32(b[12:16])),
	}
}

// Encode is the inverse of Decode (used by tests and tools).
func (e Event) Encode() []byte {
	b := make([]byte, EventSize)
	binary.LittleEndian.PutUint32(b[0:4], e.Sec)
	binary.LittleEndian.PutUint32(b[4:8], e.Usec)
	binary.LittleEndian.PutUint16(b[8:10], e.Type)
	binary.LittleEndian.PutUint16(b[10:12], e.Code)
	binary.LittleEndian.PutUint32(b[12:16], uint32(e.Value))
	return b
}

// Reader reads consecutive events from an input device or capture file.
type Reader struct {
	r   io.Reader
	buf [EventSize]byte
}

// NewReader wraps r.
func NewReader(r io.Reader) *Reader { return &Reader{r: r} }

// Next blocks until a full event is read. It returns io.EOF at the end of a capture file.
func (r *Reader) Next() (Event, error) {
	if _, err := io.ReadFull(r.r, r.buf[:]); err != nil {
		return Event{}, err
	}
	return Decode(r.buf[:]), nil
}

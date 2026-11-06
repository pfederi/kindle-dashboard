package main

import (
	"testing"

	"kindle-dashboard/client/internal/touch"
)

func TestPowerExitFiresOnReleaseOnly(t *testing.T) {
	key := func(v int32) touch.Event { return touch.Event{Type: touch.EvKey, Code: 116, Value: v} }
	pressed := false
	if powerExit(key(0), 116, &pressed) {
		t.Fatal("a release without a press (held since before the start) must not exit")
	}
	if powerExit(key(1), 116, &pressed) {
		t.Fatal("exit fired on the press; powerd would then see the release")
	}
	if powerExit(key(2), 116, &pressed) {
		t.Fatal("exit fired on auto-repeat")
	}
	if powerExit(touch.Event{Type: touch.EvKey, Code: 115, Value: 0}, 116, &pressed) {
		t.Fatal("exit fired for another key")
	}
	if !powerExit(key(0), 116, &pressed) {
		t.Fatal("no exit on the release after a press")
	}
}

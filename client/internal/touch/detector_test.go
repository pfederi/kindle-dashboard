package touch

import (
	"io"
	"os"
	"testing"
	"time"
)

var t0 = time.Date(2026, 11, 3, 7, 40, 0, 0, time.UTC)

func pixelScaler() Scaler {
	return Scaler{X: AbsRange{0, 1071}, Y: AbsRange{0, 1447}, Width: 1072, Height: 1448}
}

func abs(code uint16, v int32) Event { return Event{Type: EvAbs, Code: code, Value: v} }
func syn() Event                     { return Event{Type: EvSyn, Code: SynReport} }

func down(slot int32, x, y int32) []Event {
	return []Event{abs(AbsMTSlot, slot), abs(AbsMTTrackingID, 7), abs(AbsMTPositionX, x), abs(AbsMTPositionY, y), syn()}
}
func move(slot int32, x, y int32) []Event {
	return []Event{abs(AbsMTSlot, slot), abs(AbsMTPositionX, x), abs(AbsMTPositionY, y), syn()}
}
func up(slot int32) []Event {
	return []Event{abs(AbsMTSlot, slot), abs(AbsMTTrackingID, -1), syn()}
}

// feed sends a frame's events at time at and collects gestures.
func feed(d *Detector, at time.Time, evs []Event) []Gesture {
	var out []Gesture
	for _, e := range evs {
		if g, ok := d.Feed(e, at); ok {
			out = append(out, g)
		}
	}
	return out
}

func TestQuickTapReportsTouchDownPosition(t *testing.T) {
	d := NewDetector(DefaultDetectorConfig(), pixelScaler())
	feed(d, t0, down(0, 500, 1400))
	feed(d, t0.Add(80*time.Millisecond), move(0, 510, 1395))
	got := feed(d, t0.Add(150*time.Millisecond), up(0))
	if len(got) != 1 || got[0] != (Gesture{Kind: Tap, X: 500, Y: 1400}) {
		t.Fatalf("got %+v", got)
	}
}

func TestTapInSingleFrame(t *testing.T) {
	d := NewDetector(DefaultDetectorConfig(), pixelScaler())
	frame := []Event{abs(AbsMTTrackingID, 3), abs(AbsMTPositionX, 10), abs(AbsMTPositionY, 900), abs(AbsMTTrackingID, -1), syn()}
	got := feed(d, t0, frame)
	if len(got) != 1 || got[0].Kind != Tap || got[0].X != 10 || got[0].Y != 900 {
		t.Fatalf("got %+v", got)
	}
}

func TestSlowPressIsAHold(t *testing.T) {
	d := NewDetector(DefaultDetectorConfig(), pixelScaler())
	feed(d, t0, down(0, 500, 700))
	feed(d, t0.Add(600*time.Millisecond), move(0, 520, 710)) // a resting finger wobbles a little
	got := feed(d, t0.Add(1300*time.Millisecond), up(0))
	if len(got) != 1 || got[0] != (Gesture{Kind: Hold, X: 500, Y: 700, Dur: 1300 * time.Millisecond}) {
		t.Fatalf("got %+v, want one Hold", got)
	}
}

func TestSlowPressInExitCornerIsNotAHold(t *testing.T) {
	// A corner hold given up before 5 s is an aborted exit, not a long press on the page.
	d := NewDetector(DefaultDetectorConfig(), pixelScaler())
	feed(d, t0, down(0, 50, 50))
	got := feed(d, t0.Add(2*time.Second), up(0))
	if len(got) != 1 || got[0].Kind != Press {
		t.Fatalf("got %+v, want one Press", got)
	}
}

func TestSlowSwipeIsNotAHold(t *testing.T) {
	d := NewDetector(DefaultDetectorConfig(), pixelScaler())
	feed(d, t0, down(0, 500, 700))
	feed(d, t0.Add(500*time.Millisecond), move(0, 600, 700))
	if got := feed(d, t0.Add(1500*time.Millisecond), up(0)); len(got) != 1 || got[0].Kind != Press {
		t.Fatalf("got %+v, want one Press", got)
	}
}

func TestSwipeIsNotATap(t *testing.T) {
	d := NewDetector(DefaultDetectorConfig(), pixelScaler())
	feed(d, t0, down(0, 500, 700))
	feed(d, t0.Add(50*time.Millisecond), move(0, 545, 700))
	feed(d, t0.Add(60*time.Millisecond), move(0, 500, 700)) // moving back does not undo it
	if got := feed(d, t0.Add(100*time.Millisecond), up(0)); len(got) != 1 || got[0].Kind != Press {
		t.Fatalf("got %+v, want one Press", got)
	}
}

func TestSecondSlotIsIgnored(t *testing.T) {
	d := NewDetector(DefaultDetectorConfig(), pixelScaler())
	feed(d, t0, down(1, 900, 900)) // only slot 1: nothing
	if got := feed(d, t0.Add(50*time.Millisecond), up(1)); len(got) != 0 {
		t.Fatalf("slot 1 produced %+v", got)
	}
	feed(d, t0.Add(time.Second), down(0, 100, 1300))
	feed(d, t0.Add(time.Second+10*time.Millisecond), down(1, 900, 900)) // ghost second finger
	got := feed(d, t0.Add(time.Second+100*time.Millisecond), up(0))
	if len(got) != 1 || got[0] != (Gesture{Kind: Tap, X: 100, Y: 1300}) {
		t.Fatalf("got %+v", got)
	}
}

func TestCornerHoldExitsViaTick(t *testing.T) {
	d := NewDetector(DefaultDetectorConfig(), pixelScaler())
	feed(d, t0, down(0, 50, 60))
	if _, ok := d.Tick(t0.Add(4900 * time.Millisecond)); ok {
		t.Fatal("exit fired too early")
	}
	g, ok := d.Tick(t0.Add(5 * time.Second))
	if !ok || g.Kind != Exit {
		t.Fatalf("Tick = %+v, %v; want Exit", g, ok)
	}
	if _, ok := d.Tick(t0.Add(6 * time.Second)); ok {
		t.Fatal("exit fired twice")
	}
	if got := feed(d, t0.Add(7*time.Second), up(0)); len(got) != 0 {
		t.Fatalf("lift after exit produced %+v", got)
	}
}

func TestCornerHoldExitsOnMotionFrame(t *testing.T) {
	d := NewDetector(DefaultDetectorConfig(), pixelScaler())
	feed(d, t0, down(0, 50, 60))
	got := feed(d, t0.Add(5100*time.Millisecond), move(0, 55, 62))
	if len(got) != 1 || got[0].Kind != Exit {
		t.Fatalf("got %+v", got)
	}
}

func TestCornerHoldSurvivesShortLifts(t *testing.T) {
	// The infrared frame drops a finger near the bezel for a few frames.
	d := NewDetector(DefaultDetectorConfig(), pixelScaler())
	feed(d, t0, down(0, 30, 30))
	feed(d, t0.Add(2*time.Second), up(0))
	feed(d, t0.Add(2300*time.Millisecond), down(0, 35, 30))
	feed(d, t0.Add(4*time.Second), up(0))
	feed(d, t0.Add(4400*time.Millisecond), down(0, 30, 35))
	g, ok := d.Tick(t0.Add(5 * time.Second))
	if !ok || g.Kind != Exit {
		t.Fatalf("Tick = %+v, %v; want Exit 5 s after the first touch", g, ok)
	}
	if got := feed(d, t0.Add(6*time.Second), up(0)); len(got) != 0 {
		t.Fatalf("lift after exit produced %+v", got)
	}
}

func TestCornerHoldRestartsAfterLongLift(t *testing.T) {
	d := NewDetector(DefaultDetectorConfig(), pixelScaler())
	feed(d, t0, down(0, 30, 30))
	feed(d, t0.Add(2*time.Second), up(0))
	feed(d, t0.Add(2500*time.Millisecond), down(0, 30, 30))
	if _, ok := d.Tick(t0.Add(7 * time.Second)); ok {
		t.Fatal("exit fired although the finger was lifted for 500 ms")
	}
	if g, ok := d.Tick(t0.Add(7500 * time.Millisecond)); !ok || g.Kind != Exit {
		t.Fatalf("Tick = %+v, %v; want Exit 5 s after the second touch", g, ok)
	}
}

func TestQuickTapsAfterCornerTouchStayTaps(t *testing.T) {
	d := NewDetector(DefaultDetectorConfig(), pixelScaler())
	feed(d, t0, down(0, 30, 30))
	feed(d, t0.Add(100*time.Millisecond), up(0))
	feed(d, t0.Add(300*time.Millisecond), down(0, 500, 700)) // outside the corner: a new touch
	got := feed(d, t0.Add(400*time.Millisecond), up(0))
	if len(got) != 1 || got[0] != (Gesture{Kind: Tap, X: 500, Y: 700}) {
		t.Fatalf("got %+v", got)
	}
}

func TestHoldLeavingCornerDoesNotExit(t *testing.T) {
	d := NewDetector(DefaultDetectorConfig(), pixelScaler())
	feed(d, t0, down(0, 50, 60))
	feed(d, t0.Add(time.Second), move(0, 250, 60))
	feed(d, t0.Add(2*time.Second), move(0, 50, 60))
	if _, ok := d.Tick(t0.Add(6 * time.Second)); ok {
		t.Fatal("exit fired after leaving the corner")
	}
}

func TestHoldOutsideCornerDoesNotExit(t *testing.T) {
	d := NewDetector(DefaultDetectorConfig(), pixelScaler())
	feed(d, t0, down(0, 600, 600))
	if _, ok := d.Tick(t0.Add(10 * time.Second)); ok {
		t.Fatal("exit fired outside the corner")
	}
}

func TestScalerIsApplied(t *testing.T) {
	s := Scaler{X: AbsRange{0, 4095}, Y: AbsRange{0, 4095}, Width: 1072, Height: 1448}
	d := NewDetector(DefaultDetectorConfig(), s)
	feed(d, t0, down(0, 4095, 0))
	got := feed(d, t0.Add(50*time.Millisecond), up(0))
	if len(got) != 1 || got[0].X != 1071 || got[0].Y != 0 {
		t.Fatalf("got %+v", got)
	}
}

func btn(code uint16, v int32) Event { return Event{Type: EvKey, Code: code, Value: v} }

// Shaped like the real zforce2 capture: no ABS_MT_SLOT events at all (implicit slot 0).
func TestImplicitSlotZeroWithoutSlotEvents(t *testing.T) {
	d := NewDetector(DefaultDetectorConfig(), pixelScaler())
	var got []Gesture
	got = append(got, feed(d, t0, []Event{
		abs(AbsMTTrackingID, 0), abs(AbsMTPositionX, 500), abs(AbsMTPositionY, 700),
		btn(0x14a, 1), btn(0x145, 1), syn(),
	})...)
	got = append(got, feed(d, t0.Add(40*time.Millisecond), []Event{abs(AbsMTPositionX, 503), abs(AbsMTPositionY, 702), syn()})...)
	got = append(got, feed(d, t0.Add(80*time.Millisecond), []Event{abs(AbsMTPositionX, 505), syn()})...)
	got = append(got, feed(d, t0.Add(120*time.Millisecond), []Event{abs(AbsMTTrackingID, -1), btn(0x14a, 0), btn(0x145, 0), syn()})...)
	if len(got) != 1 || got[0] != (Gesture{Kind: Tap, X: 500, Y: 700}) {
		t.Fatalf("got %+v", got)
	}
}

func TestReplayRealTouchCapture(t *testing.T) {
	f, err := os.Open("../../testdata/device/touch.bin")
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	s := Scaler{X: AbsRange{0, 600}, Y: AbsRange{0, 800}, Width: 1072, Height: 1448}
	d := NewDetector(DefaultDetectorConfig(), s)
	r := NewReader(f)
	var got []Gesture
	for {
		ev, err := r.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		now := time.Unix(int64(ev.Sec), int64(ev.Usec)*1000)
		if g, ok := d.Feed(ev, now); ok {
			got = append(got, g)
		}
	}
	// The capture holds four deliberate corner taps (top-left, top-right,
	// bottom-right, bottom-left) lasting about 1.0, 0.63, 0.45 and 0.51 s.
	want := []Gesture{{Kind: Tap, X: 50, Y: 51}, {Kind: Tap, X: 1028, Y: 76}, {Kind: Tap, X: 1016, Y: 1400}, {Kind: Tap, X: 43, Y: 1411}}
	if len(got) != len(want) {
		t.Fatalf("got %+v, want %+v", got, want)
	}
	const tol = 20
	for i := range want {
		dx, dy := got[i].X-want[i].X, got[i].Y-want[i].Y
		if got[i].Kind != Tap || dx < -tol || dx > tol || dy < -tol || dy > tol {
			t.Errorf("gesture %d = %+v, want about %+v", i, got[i], want[i])
		}
	}
}

package touch

import "time"

// Kind identifies a recognised gesture.
type Kind int

const (
	// Tap is a short touch without movement; X and Y are the touch-down position.
	Tap Kind = iota + 1
	// Exit is a long press in the top-left corner: the user wants the Kindle UI back.
	Exit
	// Press is a touch that ended without being a tap, hold or exit; reported for the log.
	Press
	// Hold is a long touch without movement outside the exit corner; X and Y are the touch-down position.
	Hold
)

// Gesture is the result of feeding touch events into a Detector.
type Gesture struct {
	Kind Kind
	X, Y int
	// Dur is how long a Press or Hold lasted (from the first touch of a corner hold).
	Dur time.Duration
}

// DetectorConfig holds the gesture thresholds from the spec.
type DetectorConfig struct {
	TapMaxDuration time.Duration
	TapMaxMove     int
	ExitHold       time.Duration
	ExitCorner     int
	// ExitGap is how long the finger may seem lifted during a corner hold without
	// restarting it: the infrared touch frame loses fingers close to the bezel.
	ExitGap time.Duration
}

// DefaultDetectorConfig: tap = down+up within 1200 ms and < 40 px movement; hold = longer
// without movement, outside the exit corner;
// exit = finger held >= 5 s inside the 200x200 px top-left corner, lifts of up to 400 ms ignored.
func DefaultDetectorConfig() DetectorConfig {
	return DetectorConfig{
		TapMaxDuration: 1200 * time.Millisecond,
		TapMaxMove:     40,
		ExitHold:       5 * time.Second,
		ExitCorner:     200,
		ExitGap:        400 * time.Millisecond,
	}
}

// Detector is a state machine over multitouch protocol B events. Only slot 0 is
// evaluated; the PW3 sometimes reports an empty second slot. It is not safe for
// concurrent use: call Feed and Tick from one goroutine.
type Detector struct {
	cfg   DetectorConfig
	scale Scaler

	slot        int32
	rawX, rawY  int32
	downPending bool
	upPending   bool

	active         bool
	start          time.Time
	startX, startY int
	moved          bool
	leftCorner     bool
	exitFired      bool

	// A corner hold whose finger was lifted at upAt; a new touch in the corner
	// within ExitGap continues it.
	holdAlive bool
	upAt      time.Time
}

// NewDetector creates a detector that maps raw coordinates with scale.
func NewDetector(cfg DetectorConfig, scale Scaler) *Detector {
	return &Detector{cfg: cfg, scale: scale}
}

// Feed processes one event received at time now. It returns a gesture when one completes.
func (d *Detector) Feed(ev Event, now time.Time) (Gesture, bool) {
	switch ev.Type {
	case EvAbs:
		switch ev.Code {
		case AbsMTSlot:
			d.slot = ev.Value
		case AbsMTTrackingID:
			if d.slot == 0 {
				if ev.Value >= 0 {
					d.downPending = true
				} else {
					d.upPending = true
				}
			}
		case AbsMTPositionX:
			if d.slot == 0 {
				d.rawX = ev.Value
			}
		case AbsMTPositionY:
			if d.slot == 0 {
				d.rawY = ev.Value
			}
		}
	case EvSyn:
		if ev.Code == SynReport {
			return d.commit(now)
		}
	}
	return Gesture{}, false
}

// Tick must be called periodically (every 250 ms) so that a motionless long press
// is detected even when the controller sends no further events.
func (d *Detector) Tick(now time.Time) (Gesture, bool) {
	return d.checkExit(now)
}

func (d *Detector) commit(now time.Time) (Gesture, bool) {
	x, y := d.scale.Map(d.rawX, d.rawY)
	if d.downPending && !d.active {
		resume := d.holdAlive && now.Sub(d.upAt) <= d.cfg.ExitGap && d.inCorner(x, y)
		d.active = true
		if !resume {
			d.start = now
			d.exitFired = false
		}
		d.startX, d.startY = x, y
		d.moved = false
		d.leftCorner = !d.inCorner(x, y)
		d.holdAlive = false
	}
	d.downPending = false
	if d.active {
		dx, dy := x-d.startX, y-d.startY
		if dx*dx+dy*dy >= d.cfg.TapMaxMove*d.cfg.TapMaxMove {
			d.moved = true
		}
		if !d.inCorner(x, y) {
			d.leftCorner = true
		}
	}
	if d.upPending {
		d.upPending = false
		if !d.active {
			return Gesture{}, false
		}
		d.active = false
		d.holdAlive = !d.leftCorner && !d.exitFired
		d.upAt = now
		if d.exitFired {
			return Gesture{}, false
		}
		if !d.moved && now.Sub(d.start) <= d.cfg.TapMaxDuration {
			return Gesture{Kind: Tap, X: d.startX, Y: d.startY}, true
		}
		// In the corner it is an exit given up early, not a long press on the page.
		if !d.moved && d.leftCorner {
			return Gesture{Kind: Hold, X: d.startX, Y: d.startY, Dur: now.Sub(d.start)}, true
		}
		return Gesture{Kind: Press, X: d.startX, Y: d.startY, Dur: now.Sub(d.start)}, true
	}
	return d.checkExit(now)
}

func (d *Detector) checkExit(now time.Time) (Gesture, bool) {
	if d.active && !d.exitFired && !d.leftCorner && now.Sub(d.start) >= d.cfg.ExitHold {
		d.exitFired = true
		return Gesture{Kind: Exit}, true
	}
	return Gesture{}, false
}

func (d *Detector) inCorner(x, y int) bool {
	return x < d.cfg.ExitCorner && y < d.cfg.ExitCorner
}

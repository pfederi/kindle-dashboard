package wifi

import (
	"context"
	"errors"
	"reflect"
	"testing"
	"time"
)

// fakeRadio returns states in order; the last state repeats.
type fakeRadio struct {
	states []string
	calls  []string
}

func (f *fakeRadio) WifiState() (string, error) {
	s := f.states[0]
	if len(f.states) > 1 {
		f.states = f.states[1:]
	}
	return s, nil
}

func (f *fakeRadio) SetWireless(on bool) error {
	if on {
		f.calls = append(f.calls, "on")
	} else {
		f.calls = append(f.calls, "off")
	}
	return nil
}

func ensurer(r *fakeRadio) (*Ensurer, *time.Duration) {
	var slept time.Duration
	return &Ensurer{Radio: r, Sleep: func(_ context.Context, d time.Duration) error { slept += d; return nil }, Poll: time.Second, Timeout: 45 * time.Second}, &slept
}

func TestAlreadyConnectedDoesNothing(t *testing.T) {
	r := &fakeRadio{states: []string{"CONNECTED"}}
	e, _ := ensurer(r)
	if err := e.EnsureConnected(context.Background()); err != nil || len(r.calls) != 0 {
		t.Fatalf("err=%v calls=%v", err, r.calls)
	}
}

func TestEnableAndWait(t *testing.T) {
	r := &fakeRadio{states: []string{"NA", "PENDING", "PENDING", "CONNECTED"}}
	e, slept := ensurer(r)
	if err := e.EnsureConnected(context.Background()); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(r.calls, []string{"on"}) || *slept != 3*time.Second {
		t.Fatalf("calls=%v slept=%v", r.calls, *slept)
	}
}

func TestToggleOnceAfterTimeout(t *testing.T) {
	states := []string{"NA"}
	for i := 0; i < 46; i++ { // initial check + 45 polls stay down
		states = append(states, "NA")
	}
	r := &fakeRadio{states: append(states, "CONNECTED")}
	e, _ := ensurer(r)
	if err := e.EnsureConnected(context.Background()); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(r.calls, []string{"on", "off", "on"}) {
		t.Fatalf("calls = %v", r.calls)
	}
}

func TestGivesUpAfterSecondAttempt(t *testing.T) {
	r := &fakeRadio{states: []string{"NA"}}
	e, slept := ensurer(r)
	if err := e.EnsureConnected(context.Background()); !errors.Is(err, ErrNotConnected) {
		t.Fatalf("err = %v", err)
	}
	if *slept != 92*time.Second { // 45 s + 2 s pause + 45 s
		t.Fatalf("slept %v", *slept)
	}
}

func TestCancelStopsWaiting(t *testing.T) {
	r := &fakeRadio{states: []string{"NA"}}
	ctx, cancel := context.WithCancel(context.Background())
	e := &Ensurer{Radio: r, Poll: time.Second, Timeout: 45 * time.Second,
		Sleep: func(ctx context.Context, d time.Duration) error { cancel(); return ctx.Err() }}
	if err := e.EnsureConnected(ctx); !errors.Is(err, context.Canceled) {
		t.Fatalf("err = %v", err)
	}
	if !reflect.DeepEqual(r.calls, []string{"on"}) {
		t.Fatalf("calls = %v", r.calls)
	}
}

func TestSleepCtxReturnsEarly(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	start := time.Now()
	if err := sleepCtx(ctx, time.Minute); !errors.Is(err, context.Canceled) || time.Since(start) > time.Second {
		t.Fatalf("err=%v", err)
	}
}

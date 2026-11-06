package app

import (
	"bytes"
	"context"
	"errors"
	"io"
	"log"
	"strings"
	"sync"
	"testing"
	"time"

	"kindle-dashboard/client/internal/api"
	"kindle-dashboard/client/internal/device"
	"kindle-dashboard/client/internal/wifi"
)

type result struct {
	s   *api.Screen
	err error
}

type fakeAPI struct {
	screens []result // consumed in order by Screen
	taps    []result // consumed in order by Tap
	tapped  []Point
	tapCh   chan Point
}

func (f *fakeAPI) Screen(context.Context) (*api.Screen, error) {
	r := f.screens[0]
	f.screens = f.screens[1:]
	return r.s, r.err
}

func (f *fakeAPI) Tap(_ context.Context, x, y int, hold bool) (*api.Screen, error) {
	f.tapped = append(f.tapped, Point{X: x, Y: y, Hold: hold})
	if f.tapCh != nil {
		f.tapCh <- Point{X: x, Y: y, Hold: hold}
	}
	r := f.taps[0]
	f.taps = f.taps[1:]
	return r.s, r.err
}

type shown struct {
	png  string
	full bool
}

type fakeDisplay struct {
	shown []shown
	errs  []error // consumed per call; nil entries/exhausted = success
}

func (f *fakeDisplay) ShowImage(png []byte, full bool) error {
	f.shown = append(f.shown, shown{string(png), full})
	if len(f.errs) > 0 {
		e := f.errs[0]
		f.errs = f.errs[1:]
		return e
	}
	return nil
}

type fakeNet struct{ err error }

func (f fakeNet) EnsureConnected(context.Context) error { return f.err }

type blockingNet struct{}

func (blockingNet) EnsureConnected(ctx context.Context) error {
	<-ctx.Done()
	return ctx.Err()
}

func fakeOverlay(base []byte, text string) ([]byte, error) {
	return []byte(string(base) + "+" + text), nil
}

var zurich = time.FixedZone("CET", 3600)

func screen(png, etag string, refresh int, full bool) result {
	return result{s: &api.Screen{PNG: []byte(png), ETag: etag, RefreshSeconds: refresh, FullRefresh: full}}
}

func newApp(a *fakeAPI, d *fakeDisplay, now *time.Time) *App {
	return New(a, d, fakeNet{}, fakeOverlay, func() time.Time { return *now }, zurich, log.New(io.Discard, "", 0))
}

func TestRefreshShowsImageOnlyWhenETagChanges(t *testing.T) {
	now := time.Date(2026, 11, 3, 6, 40, 0, 0, time.UTC)
	f := &fakeAPI{screens: []result{screen("A", `"1"`, 120, true), screen("A", `"1"`, 120, false), screen("B", `"2"`, 60, false)}}
	d := &fakeDisplay{}
	a := newApp(f, d, &now)
	if got := a.Refresh(context.Background()); got != 120*time.Second {
		t.Fatalf("wait = %v", got)
	}
	a.Refresh(context.Background())
	if got := a.Refresh(context.Background()); got != 60*time.Second {
		t.Fatalf("wait = %v", got)
	}
	want := []shown{{"A", true}, {"B", false}}
	if len(d.shown) != 2 || d.shown[0] != want[0] || d.shown[1] != want[1] {
		t.Fatalf("shown = %+v", d.shown)
	}
}

func TestOfflineLabelAfterSecondFailureAndRecovery(t *testing.T) {
	now := time.Date(2026, 11, 3, 6, 42, 0, 0, time.UTC) // 07:42 in Zurich (CET)
	boom := result{err: errors.New("dial tcp: timeout")}
	f := &fakeAPI{screens: []result{screen("A", `"1"`, 120, false), boom, boom, boom, screen("A", `"1"`, 120, false), boom}}
	d := &fakeDisplay{}
	a := newApp(f, d, &now)
	a.Refresh(context.Background())
	if got := a.Refresh(context.Background()); got != 30*time.Second || len(d.shown) != 1 {
		t.Fatalf("1st failure: wait=%v shown=%+v", got, d.shown)
	}
	now = now.Add(3 * time.Minute) // 07:45 in Zurich; the label must still say 07:42
	if got := a.Refresh(context.Background()); got != 60*time.Second {
		t.Fatalf("2nd failure: wait=%v", got)
	}
	if last := d.shown[len(d.shown)-1]; last.png != "A+offline seit 07:42" {
		t.Fatalf("label = %q", last.png)
	}
	now = now.Add(time.Hour)
	if got := a.Refresh(context.Background()); got != 120*time.Second || len(d.shown) != 2 {
		t.Fatalf("3rd failure: wait=%v, label must not be redrawn: %+v", got, d.shown)
	}
	a.Refresh(context.Background()) // success with the same ETag must still clear the label
	if last := d.shown[len(d.shown)-1]; last.png != "A" {
		t.Fatalf("after recovery shown %q", last.png)
	}
	if got := a.Refresh(context.Background()); got != 30*time.Second {
		t.Fatalf("backoff not reset: %v", got)
	}
}

func TestUnauthorizedShowsLabelAndWaitsTenMinutes(t *testing.T) {
	now := time.Now()
	f := &fakeAPI{screens: []result{{err: api.ErrUnauthorized}}}
	d := &fakeDisplay{}
	a := newApp(f, d, &now)
	if got := a.Refresh(context.Background()); got != UnauthorizedRetry {
		t.Fatalf("wait = %v", got)
	}
	if len(d.shown) != 1 || d.shown[0].png != "+Token ungültig" {
		t.Fatalf("shown = %+v", d.shown)
	}
}

func TestTapNoContentKeepsTimer(t *testing.T) {
	now := time.Now()
	f := &fakeAPI{taps: []result{{}, screen("W", `"w"`, 120, true)}}
	d := &fakeDisplay{}
	a := newApp(f, d, &now)
	if got := a.HandleTap(context.Background(), Point{X: 10, Y: 20}); got != 0 || len(d.shown) != 0 {
		t.Fatalf("204: wait=%v shown=%+v", got, d.shown)
	}
	if got := a.HandleTap(context.Background(), Point{X: 540, Y: 1400, Hold: true}); got != 120*time.Second {
		t.Fatalf("wait = %v", got)
	}
	if len(d.shown) != 1 || d.shown[0] != (shown{"W", true}) {
		t.Fatalf("shown = %+v", d.shown)
	}
	if len(f.tapped) != 2 || f.tapped[0].Hold || !f.tapped[1].Hold {
		t.Fatalf("tapped = %+v, want the long press forwarded as hold", f.tapped)
	}
}

func TestWifiErrorDoesNotPreventFetch(t *testing.T) {
	now := time.Now()
	f := &fakeAPI{screens: []result{screen("A", `"1"`, 120, false)}}
	d := &fakeDisplay{}
	var logs bytes.Buffer
	a := New(f, d, fakeNet{err: errors.New("wifi down")}, fakeOverlay, func() time.Time { return now }, zurich, log.New(&logs, "", 0))
	a.Refresh(context.Background())
	if len(d.shown) != 1 || !bytes.Contains(logs.Bytes(), []byte("wifi down")) {
		t.Fatalf("shown=%+v logs=%q", d.shown, logs.String())
	}
}

func TestGateDropsConcurrentTaps(t *testing.T) {
	var g Gate
	if !g.TryAcquire() {
		t.Fatal("first acquire failed")
	}
	if g.TryAcquire() {
		t.Fatal("second acquire must fail while busy")
	}
	g.Release()
	if !g.TryAcquire() {
		t.Fatal("acquire after release failed")
	}
}

func TestRunHandlesTapAndReleasesGate(t *testing.T) {
	now := time.Now()
	f := &fakeAPI{
		screens: []result{screen("A", `"1"`, 3600, false)},
		taps:    []result{screen("B", `"2"`, 3600, false)},
		tapCh:   make(chan Point, 1),
	}
	d := &fakeDisplay{}
	a := newApp(f, d, &now)
	ctx, cancel := context.WithCancel(context.Background())
	taps := make(chan Point, 1)
	gate := &Gate{}
	done := make(chan struct{})
	go func() { a.Run(ctx, taps, gate); close(done) }()
	if !gate.TryAcquire() {
		t.Fatal("gate busy before tap")
	}
	taps <- Point{X: 1, Y: 2}
	select {
	case p := <-f.tapCh:
		if p != (Point{X: 1, Y: 2}) {
			t.Fatalf("tap %+v", p)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("tap not forwarded")
	}
	deadline := time.Now().Add(2 * time.Second)
	for !gate.TryAcquire() {
		if time.Now().After(deadline) {
			t.Fatal("gate not released")
		}
		time.Sleep(5 * time.Millisecond)
	}
	cancel()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("Run did not stop after cancel")
	}
}

type fakeAfter struct {
	mu     sync.Mutex
	delays []time.Duration
	chans  []chan time.Time
	called chan int
}

func newFakeAfter() *fakeAfter { return &fakeAfter{called: make(chan int, 32)} }

func (f *fakeAfter) after(d time.Duration) <-chan time.Time {
	f.mu.Lock()
	defer f.mu.Unlock()
	c := make(chan time.Time, 1)
	f.delays = append(f.delays, d)
	f.chans = append(f.chans, c)
	f.called <- len(f.delays)
	return c
}

// waitCall blocks until the n-th (1-based) call happened and returns its delay.
func (f *fakeAfter) waitCall(t *testing.T, n int) time.Duration {
	t.Helper()
	for {
		select {
		case got := <-f.called:
			if got == n {
				f.mu.Lock()
				defer f.mu.Unlock()
				return f.delays[n-1]
			}
		case <-time.After(2 * time.Second):
			t.Fatalf("after call %d never happened", n)
		}
	}
}

func (f *fakeAfter) fire(i int) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.chans[i] <- time.Time{}
}

func startRun(a *App, fa *fakeAfter, taps chan Point, gate *Gate) (cancel func(), done chan struct{}) {
	a.after = fa.after
	ctx, c := context.WithCancel(context.Background())
	done = make(chan struct{})
	go func() { a.Run(ctx, taps, gate); close(done) }()
	return c, done
}

func waitDone(t *testing.T, done chan struct{}) {
	t.Helper()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("Run did not stop")
	}
}

func TestRunSchedulesRefreshWithReturnedDelay(t *testing.T) {
	now := time.Now()
	f := &fakeAPI{screens: []result{screen("A", `"1"`, 120, false), screen("B", `"2"`, 45, false)}}
	a := newApp(f, &fakeDisplay{}, &now)
	fa := newFakeAfter()
	cancel, done := startRun(a, fa, make(chan Point, 1), &Gate{})
	if d := fa.waitCall(t, 1); d != 120*time.Second {
		t.Fatalf("first delay = %v", d)
	}
	fa.fire(0)
	if d := fa.waitCall(t, 2); d != 45*time.Second {
		t.Fatalf("second delay = %v", d)
	}
	cancel()
	waitDone(t, done)
}

func TestRunTapDelayReplacesPendingRefresh(t *testing.T) {
	now := time.Now()
	f := &fakeAPI{
		screens: []result{screen("A", `"1"`, 3600, false), screen("B", `"2"`, 30, false)},
		taps:    []result{{}, screen("T", `"t"`, 60, false)},
	}
	a := newApp(f, &fakeDisplay{}, &now)
	fa := newFakeAfter()
	taps := make(chan Point, 1)
	gate := &Gate{}
	cancel, done := startRun(a, fa, taps, gate)
	fa.waitCall(t, 1)
	gate.TryAcquire()
	taps <- Point{X: 1, Y: 1} // 204: timer untouched
	for !gate.TryAcquire() {
		time.Sleep(time.Millisecond) // wait for Run to release the gate
	}
	taps <- Point{X: 2, Y: 2} // fresh screen: re-arms with 60 s
	if d := fa.waitCall(t, 2); d != 60*time.Second {
		t.Fatalf("tap delay = %v", d)
	}
	fa.fire(0) // the superseded refresh timer must be ignored
	fa.fire(1)
	if d := fa.waitCall(t, 3); d != 30*time.Second {
		t.Fatalf("refresh delay = %v", d)
	}
	if len(f.screens) != 0 || len(f.tapped) != 2 {
		t.Fatalf("screens left=%d taps=%v", len(f.screens), f.tapped)
	}
	cancel()
	waitDone(t, done)
}

func TestRunStopsPromptlyWhenCancelledWhileWifiBlocks(t *testing.T) {
	now := time.Now()
	a := New(&fakeAPI{}, &fakeDisplay{}, blockingNet{}, fakeOverlay, func() time.Time { return now }, zurich, log.New(io.Discard, "", 0))
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { a.Run(ctx, make(chan Point), &Gate{}); close(done) }()
	time.Sleep(20 * time.Millisecond)
	start := time.Now()
	cancel()
	select {
	case <-done:
		if time.Since(start) > 100*time.Millisecond {
			t.Fatalf("took %v", time.Since(start))
		}
	case <-time.After(time.Second):
		t.Fatal("Run did not stop while Wi-Fi was blocking")
	}
}

func TestCancelledRequestIsNotAnOfflineFailure(t *testing.T) {
	now := time.Now()
	boom := result{err: errors.New("boom")}
	ctx, cancel := context.WithCancel(context.Background())
	f := &fakeAPI{screens: []result{screen("A", `"1"`, 120, false), boom, {err: context.Canceled}}}
	d := &fakeDisplay{}
	a := newApp(f, d, &now)
	a.Refresh(ctx)
	a.Refresh(ctx) // failure 1
	cancel()
	if got := a.Refresh(ctx); got != 0 || len(d.shown) != 1 || a.failures != 1 {
		t.Fatalf("wait=%v shown=%+v failures=%d", got, d.shown, a.failures)
	}
}

func TestUnauthorizedResetsOfflineState(t *testing.T) {
	now := time.Date(2026, 11, 3, 6, 0, 0, 0, time.UTC) // 07:00 Zurich
	boom := result{err: errors.New("boom")}
	f := &fakeAPI{screens: []result{boom, {err: api.ErrUnauthorized}, boom, boom}}
	d := &fakeDisplay{}
	a := newApp(f, d, &now)
	a.Refresh(context.Background())
	a.Refresh(context.Background()) // 401
	now = now.Add(5 * time.Hour)    // 12:00 Zurich
	if got := a.Refresh(context.Background()); got != 30*time.Second {
		t.Fatalf("backoff not reset: %v", got)
	}
	a.Refresh(context.Background())
	if last := d.shown[len(d.shown)-1]; !strings.HasSuffix(last.png, "offline seit 12:00") {
		t.Fatalf("label = %q", last.png)
	}
}

func TestFullRefreshDisplaysEvenWithSameETag(t *testing.T) {
	now := time.Now()
	f := &fakeAPI{screens: []result{screen("A", `"1"`, 120, false), screen("A", `"1"`, 120, true)}}
	d := &fakeDisplay{}
	a := newApp(f, d, &now)
	a.Refresh(context.Background())
	a.Refresh(context.Background())
	if len(d.shown) != 2 || d.shown[1] != (shown{"A", true}) {
		t.Fatalf("shown = %+v", d.shown)
	}
}

func TestRecoveryAfterLabelUsesFullRefresh(t *testing.T) {
	now := time.Now()
	f := &fakeAPI{screens: []result{{err: api.ErrUnauthorized}, screen("A", `"1"`, 120, false), screen("A", `"1"`, 120, false)}}
	d := &fakeDisplay{}
	a := newApp(f, d, &now)
	a.Refresh(context.Background())
	a.Refresh(context.Background())
	a.Refresh(context.Background())
	if len(d.shown) != 2 || d.shown[1] != (shown{"A", true}) {
		t.Fatalf("shown = %+v", d.shown)
	}
}

func TestDisplayErrorIsLoggedAndRetried(t *testing.T) {
	now := time.Now()
	f := &fakeAPI{screens: []result{screen("A", `"1"`, 120, false), screen("A", `"1"`, 120, false)}}
	d := &fakeDisplay{errs: []error{errors.New("fbink broke")}}
	var logs bytes.Buffer
	a := New(f, d, fakeNet{}, fakeOverlay, func() time.Time { return now }, zurich, log.New(&logs, "", 0))
	if got := a.Refresh(context.Background()); got != 120*time.Second {
		t.Fatalf("wait = %v", got)
	}
	if !strings.Contains(logs.String(), "fbink broke") {
		t.Fatalf("logs = %q", logs.String())
	}
	a.Refresh(context.Background()) // same ETag, but the first display failed, so it is shown again
	if len(d.shown) != 2 {
		t.Fatalf("shown = %+v", d.shown)
	}
}

func TestOverlayErrorIsLoggedAndNothingShown(t *testing.T) {
	now := time.Now()
	f := &fakeAPI{screens: []result{{err: api.ErrUnauthorized}}}
	d := &fakeDisplay{}
	var logs bytes.Buffer
	bad := func([]byte, string) ([]byte, error) { return nil, errors.New("draw broke") }
	a := New(f, d, fakeNet{}, bad, func() time.Time { return now }, zurich, log.New(&logs, "", 0))
	if got := a.Refresh(context.Background()); got != UnauthorizedRetry {
		t.Fatalf("wait = %v", got)
	}
	if len(d.shown) != 0 || !strings.Contains(logs.String(), "draw broke") {
		t.Fatalf("shown=%+v logs=%q", d.shown, logs.String())
	}
}

func TestOfflineLabelWithoutPreviousScreenUsesNilBase(t *testing.T) {
	now := time.Date(2026, 11, 3, 6, 42, 0, 0, time.UTC)
	boom := result{err: errors.New("boom")}
	f := &fakeAPI{screens: []result{boom, boom}}
	d := &fakeDisplay{}
	var bases [][]byte
	rec := func(base []byte, text string) ([]byte, error) {
		bases = append(bases, base)
		return []byte("+" + text), nil
	}
	a := New(f, d, fakeNet{}, rec, func() time.Time { return now }, zurich, log.New(io.Discard, "", 0))
	a.Refresh(context.Background())
	a.Refresh(context.Background())
	if len(bases) != 1 || bases[0] != nil || len(d.shown) != 1 || d.shown[0].png != "+offline seit 07:42" {
		t.Fatalf("bases=%v shown=%+v", bases, d.shown)
	}
}

var (
	_ API     = (*api.Client)(nil)
	_ Display = device.FBInk{}
	_ Network = (*wifi.Ensurer)(nil)
)

func TestFirstImageOfSessionIsFullRefresh(t *testing.T) {
	now := time.Now()
	f := &fakeAPI{screens: []result{screen("A", `"1"`, 120, false), screen("B", `"2"`, 120, false)}}
	d := &fakeDisplay{}
	a := newApp(f, d, &now)
	a.Refresh(context.Background())
	a.Refresh(context.Background())
	want := []shown{{"A", true}, {"B", false}}
	if len(d.shown) != 2 || d.shown[0] != want[0] || d.shown[1] != want[1] {
		t.Fatalf("shown = %+v, want %+v", d.shown, want)
	}
}

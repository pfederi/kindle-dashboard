package api

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
)

var fakePNG = append([]byte("\x89PNG\r\n\x1a\n"), 1, 2, 3)

func server(t *testing.T, h http.HandlerFunc) *Client {
	t.Helper()
	s := httptest.NewServer(h)
	t.Cleanup(s.Close)
	return New(s.URL, "secret", nil)
}

func TestScreenSendsTokenAndParsesHeaders(t *testing.T) {
	c := server(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/screen.png" || r.Method != http.MethodGet {
			t.Errorf("request %s %s", r.Method, r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer secret" {
			t.Errorf("Authorization = %q", got)
		}
		w.Header().Set("ETag", `"v1"`)
		w.Header().Set("X-Refresh-Seconds", "300")
		w.Header().Set("X-Full-Refresh", "1")
		w.Write(fakePNG)
	})
	s, err := c.Screen(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if s.ETag != `"v1"` || s.RefreshSeconds != 300 || !s.FullRefresh || string(s.PNG) != string(fakePNG) {
		t.Fatalf("got %+v", s)
	}
}

func TestScreenSendsBattery(t *testing.T) {
	var got []string
	c := server(t, func(w http.ResponseWriter, r *http.Request) {
		got = append(got, r.Header.Get("X-Battery")+"/"+r.Header.Get("X-Charging"))
		w.Write(fakePNG)
	})
	ctx := context.Background()
	c.Screen(ctx) // no reader: no headers
	c.Battery = func() (Battery, bool) { return Battery{Level: 18}, true }
	c.Screen(ctx)
	c.Battery = func() (Battery, bool) { return Battery{Level: 100, Charging: true}, true }
	c.Screen(ctx)
	c.Battery = func() (Battery, bool) { return Battery{}, false }
	c.Screen(ctx)
	if want := []string{"/", "18/", "100/1", "/"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("headers = %v, want %v", got, want)
	}
}

func TestScreenDefaultsRefreshAndPartialUpdate(t *testing.T) {
	c := server(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Refresh-Seconds", "soon")
		w.Write(fakePNG)
	})
	s, err := c.Screen(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if s.RefreshSeconds != DefaultRefreshSeconds || s.FullRefresh {
		t.Fatalf("got %+v", s)
	}
}

func TestTapPostsCoordinates(t *testing.T) {
	var bodies []string
	c := server(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/tap" {
			t.Errorf("request %s %s", r.Method, r.URL.Path)
		}
		b, _ := io.ReadAll(r.Body)
		bodies = append(bodies, string(b))
		if r.Header.Get("Content-Type") != "application/json" {
			t.Errorf("content type %q", r.Header.Get("Content-Type"))
		}
		w.Write(fakePNG)
	})
	if s, err := c.Tap(context.Background(), 540, 1400, false); err != nil || s == nil {
		t.Fatalf("Tap = %v, %v", s, err)
	}
	if _, err := c.Tap(context.Background(), 540, 1400, true); err != nil {
		t.Fatalf("Tap hold: %v", err)
	}
	// A plain tap leaves hold out, so it looks exactly like before to an older server.
	want := []string{`{"x":540,"y":1400}`, `{"x":540,"y":1400,"hold":true}`}
	if len(bodies) != 2 || bodies[0] != want[0] || bodies[1] != want[1] {
		t.Fatalf("bodies = %q, want %q", bodies, want)
	}
}

func TestStatusHandling(t *testing.T) {
	cases := []struct {
		name    string
		handler http.HandlerFunc
		check   func(*Screen, error) bool
	}{
		{"204 no zone", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusNoContent) },
			func(s *Screen, err error) bool { return s == nil && err == nil }},
		{"401", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusUnauthorized) },
			func(s *Screen, err error) bool { return errors.Is(err, ErrUnauthorized) }},
		{"500", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusInternalServerError) },
			func(s *Screen, err error) bool { return err != nil && !errors.Is(err, ErrUnauthorized) }},
		{"html instead of png", func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("<html>")) },
			func(s *Screen, err error) bool { return err != nil }},
	}
	for _, tc := range cases {
		c := server(t, tc.handler)
		s, err := c.Tap(context.Background(), 1, 1, false)
		if !tc.check(s, err) {
			t.Errorf("%s: got %+v, %v", tc.name, s, err)
		}
	}
}

func TestScreen204IsError(t *testing.T) {
	c := server(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})
	s, err := c.Screen(context.Background())
	if s != nil || err == nil || err.Error() != "api: empty screen" {
		t.Errorf("Screen 204: got %+v, %v", s, err)
	}
}

func TestScreen401IsUnauthorized(t *testing.T) {
	c := server(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	})
	s, err := c.Screen(context.Background())
	if s != nil || !errors.Is(err, ErrUnauthorized) {
		t.Errorf("Screen 401: got %+v, %v", s, err)
	}
}

func TestOversizeScreenIsError(t *testing.T) {
	// Temporarily lower the limit for testing
	origLimit := maxImageBytes
	maxImageBytes = 100
	defer func() { maxImageBytes = origLimit }()

	c := server(t, func(w http.ResponseWriter, r *http.Request) {
		// Write a PNG magic + 101 bytes of data (over limit)
		w.Write(append(fakePNG, make([]byte, 101)...))
	})
	s, err := c.Screen(context.Background())
	if s != nil || err == nil || err.Error() != "api: screen too large" {
		t.Errorf("Oversize: got %+v, %v", s, err)
	}
}

func TestErrorDoesNotContainToken(t *testing.T) {
	c := New("http://127.0.0.1:1", "secret-token", nil)
	_, err := c.Screen(context.Background())
	if err == nil {
		t.Fatal("expected error")
	}
	if err.Error() == "" {
		t.Fatal("error message is empty")
	}
	// Token should never appear in error text
	if strings.Contains(err.Error(), "secret-token") {
		t.Errorf("error contains token: %s", err)
	}
}

func TestRedirectsNotFollowed(t *testing.T) {
	c := server(t, func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "http://evil.example.com", http.StatusMovedPermanently)
	})
	s, err := c.Screen(context.Background())
	if s != nil || err == nil {
		t.Errorf("Redirect: got %+v, %v", s, err)
	}
	// Should get the 301 status code error, not follow the redirect
	if err.Error() != "api: unexpected status 301" {
		t.Errorf("wrong error: %v", err)
	}
}

func TestUnreachableServerIsAnError(t *testing.T) {
	c := New("http://127.0.0.1:1", "t", nil)
	if _, err := c.Screen(context.Background()); err == nil {
		t.Fatal("expected error")
	}
}

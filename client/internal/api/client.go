// Package api talks to the dashboard server: GET /screen.png and POST /tap.
package api

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"time"
)

// ErrUnauthorized is returned when the server rejects the device token (HTTP 401).
var ErrUnauthorized = errors.New("api: unauthorized")

// DefaultRefreshSeconds is used when the server sends no valid X-Refresh-Seconds.
const DefaultRefreshSeconds = 120

var maxImageBytes = 8 << 20

var pngMagic = []byte("\x89PNG\r\n\x1a\n")

// Screen is one rendered dashboard image plus the server's display hints.
type Screen struct {
	PNG            []byte
	ETag           string
	RefreshSeconds int
	FullRefresh    bool
}

// Battery is the charge level in percent and whether the Kindle is charging.
type Battery struct {
	Level    int
	Charging bool
}

// Client is an authenticated HTTP client for one server.
type Client struct {
	base  string
	token string
	http  *http.Client

	// Battery, when set, is read before every screen request and sent along
	// (X-Battery, X-Charging); ok == false sends nothing. Taps skip it to stay fast.
	Battery func() (b Battery, ok bool)
}

// New creates a client. roots == nil uses the system roots (tests only).
func New(baseURL, token string, roots *x509.CertPool) *Client {
	tr := &http.Transport{
		TLSClientConfig:     &tls.Config{RootCAs: roots, MinVersion: tls.VersionTLS12},
		TLSHandshakeTimeout: 15 * time.Second,
		IdleConnTimeout:     90 * time.Second,
	}
	return &Client{
		base:  baseURL,
		token: token,
		http: &http.Client{
			Timeout:       30 * time.Second,
			Transport:     tr,
			CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
		},
	}
}

// Screen fetches the active view.
func (c *Client) Screen(ctx context.Context) (*Screen, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.base+"/screen.png", nil)
	if err != nil {
		return nil, fmt.Errorf("api: %w", err)
	}
	if c.Battery != nil {
		if b, ok := c.Battery(); ok {
			req.Header.Set("X-Battery", strconv.Itoa(b.Level))
			if b.Charging {
				req.Header.Set("X-Charging", "1")
			}
		}
	}
	return c.do(req)
}

// Tap reports a tap, or with hold a long press. It returns (nil, nil) when the server
// answers 204 (no zone hit).
func (c *Client) Tap(ctx context.Context, x, y int, hold bool) (*Screen, error) {
	body, _ := json.Marshal(struct {
		X    int  `json:"x"`
		Y    int  `json:"y"`
		Hold bool `json:"hold,omitempty"`
	}{x, y, hold})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.base+"/tap", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("api: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	return c.do(req)
}

func (c *Client) do(req *http.Request) (*Screen, error) {
	req.Header.Set("Authorization", "Bearer "+c.token)
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("api: %w", err)
	}
	defer resp.Body.Close()
	switch resp.StatusCode {
	case http.StatusOK:
	case http.StatusNoContent:
		if req.Method == http.MethodGet {
			// 204 on GET /screen.png is an error (no content)
			return nil, errors.New("api: empty screen")
		}
		// 204 on POST /tap means no zone hit
		return nil, nil
	case http.StatusUnauthorized:
		return nil, ErrUnauthorized
	default:
		io.Copy(io.Discard, io.LimitReader(resp.Body, 64<<10))
		return nil, fmt.Errorf("api: unexpected status %d", resp.StatusCode)
	}
	img, err := io.ReadAll(io.LimitReader(resp.Body, int64(maxImageBytes)+1))
	if err != nil {
		return nil, fmt.Errorf("api: reading body: %w", err)
	}
	if len(img) > maxImageBytes {
		return nil, errors.New("api: screen too large")
	}
	if !bytes.HasPrefix(img, pngMagic) {
		return nil, errors.New("api: response is not a PNG")
	}
	refresh, err := strconv.Atoi(resp.Header.Get("X-Refresh-Seconds"))
	if err != nil || refresh <= 0 {
		refresh = DefaultRefreshSeconds
	}
	return &Screen{
		PNG:            img,
		ETag:           resp.Header.Get("ETag"),
		RefreshSeconds: refresh,
		FullRefresh:    resp.Header.Get("X-Full-Refresh") == "1",
	}, nil
}

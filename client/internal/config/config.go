// Package config loads the client's config.json and fills in device defaults.
package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"strings"
)

// Touch holds the touchscreen device name and calibration flags.
type Touch struct {
	DeviceName string `json:"deviceName"`
	SwapXY     bool   `json:"swapXY"`
	InvertX    bool   `json:"invertX"`
	InvertY    bool   `json:"invertY"`
}

// Config is the content of /mnt/us/dashboard/config.json.
type Config struct {
	ServerURL       string `json:"serverUrl"`
	Token           string `json:"token"`
	Touch           Touch  `json:"touch"`
	PowerDeviceName string `json:"powerDeviceName"`
	PowerKeyCode    uint16 `json:"powerKeyCode"`
	ScreenWidth     int    `json:"screenWidth"`
	ScreenHeight    int    `json:"screenHeight"`
}

// Defaults returns the values expected for a Kindle 7th generation (WP63GW, 600x800); config.json overrides them.
func Defaults() Config {
	return Config{
		Touch:           Touch{DeviceName: "zforce2"},
		PowerDeviceName: "max77696-onkey",
		PowerKeyCode:    116,
		ScreenWidth:     600,
		ScreenHeight:    800,
	}
}

// PlaceholderToken is the token value shipped in config.example.json.
const PlaceholderToken = "HIER-DEN-DEVICE_TOKEN-AUS-COOLIFY-EINTRAGEN"

// isPlaceholderHost reports whether the URL points to an example domain such as kindle.example.ch.
func isPlaceholderHost(serverURL string) bool {
	u, err := url.Parse(serverURL)
	if err != nil {
		return false
	}
	host := strings.ToLower(u.Hostname())
	for _, d := range []string{"example.ch", "example.com", "example.org", "example.net"} {
		if host == d || strings.HasSuffix(host, "."+d) {
			return true
		}
	}
	return false
}

// Parse decodes config JSON on top of Defaults and validates required fields.
func Parse(data []byte) (Config, error) {
	c := Defaults()
	if err := json.Unmarshal(data, &c); err != nil {
		return Config{}, fmt.Errorf("config: %w", err)
	}
	c.ServerURL = strings.TrimRight(strings.TrimSpace(c.ServerURL), "/")
	if c.ServerURL == "" {
		return Config{}, errors.New("config: serverUrl is missing")
	}
	if !strings.HasPrefix(c.ServerURL, "https://") && !strings.HasPrefix(c.ServerURL, "http://") {
		return Config{}, fmt.Errorf("config: serverUrl must start with https:// (got %q)", c.ServerURL)
	}
	if strings.TrimSpace(c.Token) == "" {
		return Config{}, errors.New("config: token is missing")
	}
	if strings.TrimSpace(c.Token) == PlaceholderToken {
		return Config{}, errors.New("config: token is still the placeholder from config.example.json; enter the real device token")
	}
	if isPlaceholderHost(c.ServerURL) {
		return Config{}, fmt.Errorf("config: serverUrl %q is still the placeholder from config.example.json; enter the real server URL", c.ServerURL)
	}
	if c.ScreenWidth <= 0 || c.ScreenHeight <= 0 {
		return Config{}, errors.New("config: screenWidth and screenHeight must be positive")
	}
	return c, nil
}

// Load reads and parses the config file at path.
func Load(path string) (Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return Config{}, fmt.Errorf("config: %w", err)
	}
	return Parse(data)
}

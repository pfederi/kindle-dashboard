package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestParseAppliesDefaults(t *testing.T) {
	c, err := Parse([]byte(`{"serverUrl":"https://kindle.mydomain.ch/","token":"abc"}`))
	if err != nil {
		t.Fatal(err)
	}
	if c.ServerURL != "https://kindle.mydomain.ch" {
		t.Errorf("ServerURL = %q, want trailing slash trimmed", c.ServerURL)
	}
	if c.Touch.DeviceName != "zforce2" || c.PowerDeviceName != "max77696-onkey" || c.PowerKeyCode != 116 {
		t.Errorf("defaults not applied: %+v", c)
	}
	if c.ScreenWidth != 600 || c.ScreenHeight != 800 {
		t.Errorf("screen = %dx%d", c.ScreenWidth, c.ScreenHeight)
	}
}

func TestParseKeepsNestedDefaultsWhenPartiallyOverridden(t *testing.T) {
	c, err := Parse([]byte(`{"serverUrl":"https://x.ch","token":"t","touch":{"invertY":true}}`))
	if err != nil {
		t.Fatal(err)
	}
	if !c.Touch.InvertY || c.Touch.DeviceName != "zforce2" {
		t.Errorf("touch = %+v", c.Touch)
	}
}

func TestParseRejectsInvalidConfig(t *testing.T) {
	cases := map[string]string{
		"missing url":   `{"token":"t"}`,
		"missing token": `{"serverUrl":"https://x.ch"}`,
		"bad scheme":    `{"serverUrl":"kindle.mydomain.ch","token":"t"}`,
		"bad json":      `{"serverUrl":`,
		"bad screen":    `{"serverUrl":"https://x.ch","token":"t","screenWidth":0}`,
	}
	for name, in := range cases {
		if _, err := Parse([]byte(in)); err == nil {
			t.Errorf("%s: expected error", name)
		}
	}
}

func TestLoadReadsFile(t *testing.T) {
	p := filepath.Join(t.TempDir(), "config.json")
	if err := os.WriteFile(p, []byte(`{"serverUrl":"https://x.ch","token":"t"}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := Load(p); err != nil {
		t.Fatal(err)
	}
	if _, err := Load(filepath.Join(t.TempDir(), "missing.json")); err == nil {
		t.Error("expected error for missing file")
	}
}

func TestParseRejectsExamplePlaceholders(t *testing.T) {
	cases := map[string]string{
		"placeholder token": `{"serverUrl":"https://kindle.mydomain.ch","token":"HIER-DEN-DEVICE_TOKEN-AUS-COOLIFY-EINTRAGEN"}`,
		"placeholder host":  `{"serverUrl":"https://kindle.example.ch","token":"abc"}`,
	}
	for name, in := range cases {
		_, err := Parse([]byte(in))
		if err == nil || !strings.Contains(err.Error(), "placeholder") {
			t.Errorf("%s: want placeholder error, got %v", name, err)
		}
	}
}

// Package input finds and opens Linux evdev devices.
package input

import "strings"

// DeviceInfo is one block of /proc/bus/input/devices.
type DeviceInfo struct {
	Name    string // e.g. "zforce2"
	Handler string // e.g. "event1"
}

// ParseDevices parses the content of /proc/bus/input/devices.
func ParseDevices(content string) []DeviceInfo {
	var out []DeviceInfo
	var cur DeviceInfo
	flush := func() {
		if cur.Name != "" || cur.Handler != "" {
			out = append(out, cur)
		}
		cur = DeviceInfo{}
	}
	for _, line := range strings.Split(content, "\n") {
		line = strings.TrimSpace(line)
		switch {
		case line == "":
			flush()
		case strings.HasPrefix(line, "N: Name="):
			cur.Name = strings.Trim(strings.TrimPrefix(line, "N: Name="), `"`)
		case strings.HasPrefix(line, "H: Handlers="):
			for _, h := range strings.Fields(strings.TrimPrefix(line, "H: Handlers=")) {
				if strings.HasPrefix(h, "event") {
					cur.Handler = h
				}
			}
		}
	}
	flush()
	return out
}

// FindHandler returns the eventN handler of the first device called name.
// If no such device (with an event handler) exists it returns ok=false; the
// caller is responsible for building the error.
func FindHandler(content, name string) (string, bool) {
	for _, d := range ParseDevices(content) {
		if d.Name == name && d.Handler != "" {
			return d.Handler, true
		}
	}
	return "", false
}

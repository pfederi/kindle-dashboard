package input

import "testing"

const sample = `I: Bus=0019 Vendor=0001 Product=0001 Version=0100
N: Name="max77696-onkey"
P: Phys=max77696-onkey/input0
S: Sysfs=/devices/virtual/input/input0
U: Uniq=
H: Handlers=kbd event0
B: PROP=0
B: EV=3

I: Bus=0000 Vendor=0000 Product=0000 Version=0000
N: Name="cyttsp4_mt"
P: Phys=
S: Sysfs=/devices/virtual/input/input1
U: Uniq=
H: Handlers=event1
B: PROP=2
B: EV=b
`

// realKindle is the real /proc/bus/input/devices of the Kindle (client/testdata/device/diag.txt),
// including the trailing spaces after the handler lists.
const realKindle = "I: Bus=0000 Vendor=0000 Product=0000 Version=0000\n" +
	"N: Name=\"max77696-onkey\"\n" +
	"P: Phys=max77696-onkey/input0\n" +
	"S: Sysfs=/devices/platform/imx-i2c.0/i2c-0/0-003c/max77696-onkey.0/input/input0\n" +
	"U: Uniq=\n" +
	"H: Handlers=kbd event0 \n" +
	"B: PROP=0\n" +
	"B: EV=3\n" +
	"B: KEY=100000 0 0 0\n" +
	"\n" +
	"I: Bus=0000 Vendor=0000 Product=0000 Version=0000\n" +
	"N: Name=\"zforce2\"\n" +
	"P: Phys=zforce2/input0\n" +
	"S: Sysfs=/devices/platform/zforce2.0/input/input1\n" +
	"U: Uniq=\n" +
	"H: Handlers=event1 \n" +
	"B: PROP=0\n" +
	"B: EV=b\n" +
	"B: KEY=6420 0 0 0 0 0 0 0 0 0 0\n" +
	"B: ABS=2608000 0\n"

func TestParseDevices(t *testing.T) {
	got := ParseDevices(sample)
	want := []DeviceInfo{{"max77696-onkey", "event0"}, {"cyttsp4_mt", "event1"}}
	if len(got) != len(want) {
		t.Fatalf("got %+v", got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("device %d = %+v, want %+v", i, got[i], want[i])
		}
	}
}

func TestParseDevicesRealKindle(t *testing.T) {
	got := ParseDevices(realKindle)
	want := []DeviceInfo{{"max77696-onkey", "event0"}, {"zforce2", "event1"}}
	if len(got) != len(want) {
		t.Fatalf("got %+v", got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("device %d = %+v, want %+v", i, got[i], want[i])
		}
	}
}

func TestFindHandler(t *testing.T) {
	if h, ok := FindHandler(sample, "cyttsp4_mt"); !ok || h != "event1" {
		t.Errorf("touch = %q, %v", h, ok)
	}
	if h, ok := FindHandler(sample, "max77696-onkey"); !ok || h != "event0" {
		t.Errorf("power = %q, %v", h, ok)
	}
	if _, ok := FindHandler(sample, "zforce"); ok {
		t.Error("unexpected match")
	}
}

func TestFindHandlerRealKindle(t *testing.T) {
	if h, ok := FindHandler(realKindle, "zforce2"); !ok || h != "event1" {
		t.Errorf("touch = %q, %v", h, ok)
	}
	if h, ok := FindHandler(realKindle, "max77696-onkey"); !ok || h != "event0" {
		t.Errorf("power = %q, %v", h, ok)
	}
	if _, ok := FindHandler(realKindle, "cyttsp4_mt"); ok {
		t.Error("unexpected match")
	}
}

func TestParseDevicesEdgeCases(t *testing.T) {
	tests := []struct {
		name    string
		content string
		want    []DeviceInfo
		find    string
		wantH   string
		wantOK  bool
	}{
		{"empty", "", nil, "zforce2", "", false},
		{
			"duplicate names: first wins",
			"N: Name=\"dup\"\nH: Handlers=event3\n\nN: Name=\"dup\"\nH: Handlers=event4\n",
			[]DeviceInfo{{"dup", "event3"}, {"dup", "event4"}},
			"dup", "event3", true,
		},
		{
			"no event token",
			"N: Name=\"kbdonly\"\nH: Handlers=kbd sysrq\n",
			[]DeviceInfo{{"kbdonly", ""}},
			"kbdonly", "", false,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ParseDevices(tt.content)
			if len(got) != len(tt.want) {
				t.Fatalf("got %+v, want %+v", got, tt.want)
			}
			for i := range got {
				if got[i] != tt.want[i] {
					t.Errorf("device %d = %+v, want %+v", i, got[i], tt.want[i])
				}
			}
			h, ok := FindHandler(tt.content, tt.find)
			if h != tt.wantH || ok != tt.wantOK {
				t.Errorf("FindHandler = %q, %v; want %q, %v", h, ok, tt.wantH, tt.wantOK)
			}
		})
	}
}

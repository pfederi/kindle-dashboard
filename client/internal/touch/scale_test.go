package touch

import "testing"

func TestScalerMaps(t *testing.T) {
	pixel := Scaler{X: AbsRange{0, 1071}, Y: AbsRange{0, 1447}, Width: 1072, Height: 1448}
	wide := Scaler{X: AbsRange{0, 4095}, Y: AbsRange{0, 4095}, Width: 1072, Height: 1448}
	cases := []struct {
		name         string
		s            Scaler
		rx, ry       int32
		wantX, wantY int
	}{
		{"identity", pixel, 300, 1200, 300, 1200},
		{"wide range max", wide, 4095, 4095, 1071, 1447},
		{"wide range mid", wide, 2048, 0, 536, 0},
		{"clamp below", pixel, -20, -5, 0, 0},
		{"clamp above", pixel, 5000, 5000, 1071, 1447},
		{"invert x", Scaler{X: pixel.X, Y: pixel.Y, Width: 1072, Height: 1448, InvertX: true}, 0, 10, 1071, 10},
		{"invert y", Scaler{X: pixel.X, Y: pixel.Y, Width: 1072, Height: 1448, InvertY: true}, 10, 0, 10, 1447},
		{"swap xy", Scaler{X: AbsRange{0, 1447}, Y: AbsRange{0, 1071}, Width: 1072, Height: 1448, SwapXY: true}, 1447, 0, 0, 1447},
		{"swap xy + invert x", Scaler{X: AbsRange{0, 1447}, Y: AbsRange{0, 1071}, Width: 1072, Height: 1448, SwapXY: true, InvertX: true}, 0, 0, 1071, 0},
		{"swap xy + invert x max", Scaler{X: AbsRange{0, 1447}, Y: AbsRange{0, 1071}, Width: 1072, Height: 1448, SwapXY: true, InvertX: true}, 1447, 1071, 0, 1447},
		{"swap xy + invert y", Scaler{X: AbsRange{0, 1447}, Y: AbsRange{0, 1071}, Width: 1072, Height: 1448, SwapXY: true, InvertY: true}, 0, 0, 0, 1447},
		{"swap xy + invert y max", Scaler{X: AbsRange{0, 1447}, Y: AbsRange{0, 1071}, Width: 1072, Height: 1448, SwapXY: true, InvertY: true}, 1447, 1071, 1071, 0},
		{"empty range", Scaler{Width: 1072, Height: 1448}, 100, 100, 0, 0},
		{"non-zero min min", Scaler{X: AbsRange{10, 610}, Y: AbsRange{20, 820}, Width: 1072, Height: 1448}, 10, 20, 0, 0},
		{"non-zero min max", Scaler{X: AbsRange{10, 610}, Y: AbsRange{20, 820}, Width: 1072, Height: 1448}, 610, 820, 1071, 1447},
		{"zforce2-like mid", Scaler{X: AbsRange{0, 600}, Y: AbsRange{0, 800}, Width: 1072, Height: 1448}, 300, 400, 536, 724},
		{"zforce2-like max", Scaler{X: AbsRange{0, 600}, Y: AbsRange{0, 800}, Width: 1072, Height: 1448}, 600, 800, 1071, 1447},
	}
	for _, c := range cases {
		x, y := c.s.Map(c.rx, c.ry)
		if x != c.wantX || y != c.wantY {
			t.Errorf("%s: Map(%d,%d) = (%d,%d), want (%d,%d)", c.name, c.rx, c.ry, x, y, c.wantX, c.wantY)
		}
	}
}

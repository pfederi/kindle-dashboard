package touch

import "math"

// AbsRange is the minimum and maximum raw value of one touch axis (from EVIOCGABS).
type AbsRange struct{ Min, Max int32 }

// Scaler maps raw touch coordinates to screen pixels.
type Scaler struct {
	X, Y                     AbsRange
	Width, Height            int
	SwapXY, InvertX, InvertY bool
}

// Map converts raw axis values to a pixel position, clamped to the screen.
func (s Scaler) Map(rawX, rawY int32) (int, int) {
	fx, fy := norm(rawX, s.X), norm(rawY, s.Y)
	if s.SwapXY {
		fx, fy = fy, fx
	}
	if s.InvertX {
		fx = 1 - fx
	}
	if s.InvertY {
		fy = 1 - fy
	}
	return int(math.Round(fx * float64(s.Width-1))), int(math.Round(fy * float64(s.Height-1)))
}

func norm(v int32, r AbsRange) float64 {
	if r.Max <= r.Min {
		return 0
	}
	f := (float64(v) - float64(r.Min)) / (float64(r.Max) - float64(r.Min))
	return math.Min(1, math.Max(0, f))
}

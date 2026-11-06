// Package overlay draws a status label ("offline seit 07:42") onto the last screen image.
package overlay

import (
	"bytes"
	"fmt"
	"image"
	"image/draw"
	"image/png"
	"sync"

	"golang.org/x/image/font"
	"golang.org/x/image/font/gofont/gobold"
	"golang.org/x/image/font/opentype"
	"golang.org/x/image/math/fixed"
)

const (
	// FontSize in pixels; 20 px at 167 ppi matches the spec's 36 px minimum at 300 ppi.
	FontSize = 20
	Margin   = 7
	Padding  = 8
	// Width and Height of the blank canvas used when no image has been shown yet (the device screen).
	Width  = 600
	Height = 800
)

var (
	faceOnce sync.Once
	face     font.Face
	faceErr  error
)

// loadFace parses the embedded Go Bold font (covers Latin-1, incl. ü/ö/ä).
func loadFace() (font.Face, error) {
	faceOnce.Do(func() {
		f, err := opentype.Parse(gobold.TTF)
		if err != nil {
			faceErr = err
			return
		}
		face, faceErr = opentype.NewFace(f, &opentype.FaceOptions{Size: FontSize, DPI: 72, Hinting: font.HintingFull})
	})
	return face, faceErr
}

// Draw returns base with text rendered white on black in the bottom-right corner.
// A nil base draws onto a white Width x Height canvas.
func Draw(base []byte, text string) ([]byte, error) {
	f, err := loadFace()
	if err != nil {
		return nil, fmt.Errorf("overlay: %w", err)
	}
	dst, err := canvas(base)
	if err != nil {
		return nil, err
	}
	m := f.Metrics()
	textW := font.MeasureString(f, text).Ceil()
	textH := (m.Ascent + m.Descent).Ceil()
	boxW, boxH := textW+2*Padding, textH+2*Padding
	b := dst.Bounds()
	x0, y0 := max(b.Min.X, b.Max.X-Margin-boxW), max(b.Min.Y, b.Max.Y-Margin-boxH)
	draw.Draw(dst, image.Rect(x0, y0, x0+boxW, y0+boxH), image.Black, image.Point{}, draw.Src)
	d := font.Drawer{Dst: dst, Src: image.White, Face: f, Dot: fixed.P(x0+Padding, y0+Padding+m.Ascent.Ceil())}
	d.DrawString(text)
	var out bytes.Buffer
	if err := png.Encode(&out, dst); err != nil {
		return nil, fmt.Errorf("overlay: %w", err)
	}
	return out.Bytes(), nil
}

func canvas(base []byte) (*image.Gray, error) {
	if base == nil {
		g := image.NewGray(image.Rect(0, 0, Width, Height))
		draw.Draw(g, g.Bounds(), image.White, image.Point{}, draw.Src)
		return g, nil
	}
	src, err := png.Decode(bytes.NewReader(base))
	if err != nil {
		return nil, fmt.Errorf("overlay: %w", err)
	}
	g := image.NewGray(src.Bounds())
	draw.Draw(g, g.Bounds(), src, src.Bounds().Min, draw.Src)
	return g, nil
}

package overlay

import (
	"bytes"
	"image"
	"image/draw"
	"image/png"
	"testing"

	"golang.org/x/image/font/gofont/gobold"
	"golang.org/x/image/font/opentype"
	"golang.org/x/image/font/sfnt"
)

func whitePNG(t *testing.T, w, h int) []byte {
	t.Helper()
	g := image.NewGray(image.Rect(0, 0, w, h))
	draw.Draw(g, g.Bounds(), image.White, image.Point{}, draw.Src)
	var buf bytes.Buffer
	if err := png.Encode(&buf, g); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func decode(t *testing.T, b []byte) *image.Gray {
	t.Helper()
	img, err := png.Decode(bytes.NewReader(b))
	if err != nil {
		t.Fatal(err)
	}
	g, ok := img.(*image.Gray)
	if !ok {
		t.Fatalf("got %T, want *image.Gray", img)
	}
	return g
}

// whiteInBox counts white pixels inside the label box region.
func whiteInBox(g *image.Gray, x0, y0 int) int {
	n := 0
	for y := y0; y < g.Bounds().Max.Y-Margin; y++ {
		for x := x0; x < g.Bounds().Max.X-Margin; x++ {
			if g.GrayAt(x, y).Y > 128 {
				n++
			}
		}
	}
	return n
}

func TestDrawPutsLabelBottomRight(t *testing.T) {
	out, err := Draw(whitePNG(t, Width, Height), "offline seit 07:42")
	if err != nil {
		t.Fatal(err)
	}
	g := decode(t, out)
	if g.Bounds() != image.Rect(0, 0, Width, Height) {
		t.Fatalf("bounds %v", g.Bounds())
	}
	if g.GrayAt(0, 0).Y != 255 || g.GrayAt(Width-Margin+2, Height-Margin+2).Y != 255 {
		t.Fatal("pixels outside the label must stay white")
	}
	if g.GrayAt(Width-Margin-2, Height-Margin-2).Y != 0 {
		t.Fatal("label box must be black at its bottom-right corner")
	}
	if whiteInBox(g, Width/2, Height-Margin-2*FontSize) == 0 {
		t.Fatal("no text pixels inside the label")
	}
}

func TestUmlautIsRenderedNotReplaced(t *testing.T) {
	f, err := opentype.Parse(gobold.TTF)
	if err != nil {
		t.Fatal(err)
	}
	var buf sfnt.Buffer
	idx, err := f.GlyphIndex(&buf, 'ü')
	if err != nil || idx == 0 {
		t.Fatalf("font lacks ü: idx=%d err=%v", idx, err)
	}
	out, err := Draw(nil, "Token ungültig")
	if err != nil {
		t.Fatal(err)
	}
	if g := decode(t, out); g.Bounds().Dx() != Width || g.Bounds().Dy() != Height {
		t.Fatalf("bounds %v", g.Bounds())
	}
	// "ü" and "u" share the advance width, so the boxes coincide; the
	// diaeresis must add light text pixels on top of the plain "u".
	light := func(text string) int {
		out, err := Draw(nil, text)
		if err != nil {
			t.Fatal(err)
		}
		g, n := decode(t, out), 0
		for _, px := range g.Pix {
			if px > 0x80 {
				n++
			}
		}
		return n
	}
	plain, umlaut := light("Token ungultig"), light("Token ungültig")
	if umlaut <= plain {
		t.Fatalf("diaeresis not drawn: %d light pixels with ü, %d without", umlaut, plain)
	}
}

func TestDrawRejectsInvalidPNG(t *testing.T) {
	if _, err := Draw([]byte("not a png"), "x"); err == nil {
		t.Fatal("expected error")
	}
}

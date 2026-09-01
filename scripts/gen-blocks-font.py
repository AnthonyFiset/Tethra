#!/usr/bin/env python3
"""Generate TethraBlocks.ttf — full-cell block-element glyphs (U+2580–259F).

Why this font exists: xterm 6's core canvas renderer has no custom-glyph
drawing (that lives only in the WebGL addon, which never paints reliably in
WKWebView). Block elements therefore come from the terminal font, and
JetBrains Mono inks them across the em only (~12.7px of a 17px cell at
12.5px/lh 1.0), so TUI art — agent logos, btop bars — renders with
background stripes between rows. JetBrains' box-drawing glyphs already
span the line box, so only U+2580–259F need replacing.

This font's glyphs cover the FULL ascent..descent box (matching JetBrains
Mono's hhea metrics, 1020/-300 per 1000 UPM, advance 600) with a small
overshoot that the renderer clips at cell edges. It sits FIRST in the
terminal font stack and maps ONLY the block range, so every other glyph
falls through to the user's font.

Regenerate with:  python3 scripts/gen-blocks-font.py
Output:           apps/ui/src/assets/fonts/TethraBlocks.ttf
"""

from pathlib import Path

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

UPM = 1000
# JetBrains Mono metrics (hhea): browser cell at lh 1.0 = ascent+descent.
ASCENT = 1020
DESCENT = 300  # positive magnitude
ADVANCE = 600
# Overshoot: cover browser rounding (cell height is ceil'd in px); the
# renderer clips at the cell box so a modest bleed is safe.
OVER_Y = 60
OVER_X = 8

TOP = ASCENT + OVER_Y
BOT = -(DESCENT + OVER_Y)
LEFT = -OVER_X
RIGHT = ADVANCE + OVER_X
MID_Y = (TOP + BOT) // 2
MID_X = (LEFT + RIGHT) // 2
H = TOP - BOT
W = RIGHT - LEFT


def rect(pen, x0, y0, x1, y1):
    pen.moveTo((x0, y0))
    pen.lineTo((x1, y0))
    pen.lineTo((x1, y1))
    pen.lineTo((x0, y1))
    pen.closePath()


def eighth_y(n):
    """y of the n-th eighth boundary counted from the bottom."""
    return BOT + round(H * n / 8)


def eighth_x(n):
    return LEFT + round(W * n / 8)


def shade(pen, fill_predicate):
    """Checkerboard shade across the full box; ~50x68-unit tiles."""
    cols, rows = 12, 20
    for r in range(rows):
        y0 = BOT + round(H * r / rows)
        y1 = BOT + round(H * (r + 1) / rows)
        for c in range(cols):
            if not fill_predicate(r, c):
                continue
            x0 = LEFT + round(W * c / cols)
            x1 = LEFT + round(W * (c + 1) / cols)
            rect(pen, x0, y0, x1, y1)


# (codepoint, name, list of rects as fractions of the box) — rects given as
# (x0, y0, x1, y1) with named helpers below.
def build_glyphs():
    glyphs = {}

    def make(name, draw):
        pen = TTGlyphPen(None)
        draw(pen)
        glyphs[name] = pen.glyph()

    # Halves.
    make("uni2580", lambda p: rect(p, LEFT, MID_Y, RIGHT, TOP))  # ▀
    make("uni2584", lambda p: rect(p, LEFT, BOT, RIGHT, MID_Y))  # ▄
    make("uni258C", lambda p: rect(p, LEFT, BOT, MID_X, TOP))  # ▌
    make("uni2590", lambda p: rect(p, MID_X, BOT, RIGHT, TOP))  # ▐
    make("uni2588", lambda p: rect(p, LEFT, BOT, RIGHT, TOP))  # █

    # Lower n/8 blocks ▁▂▃▄▅▆▇ (2581–2587; 2584 handled as half above,
    # but 4/8 == half so regenerating it is harmless — keep explicit).
    for n, cp in ((1, 0x2581), (2, 0x2582), (3, 0x2583), (5, 0x2585), (6, 0x2586), (7, 0x2587)):
        make(f"uni{cp:04X}", lambda p, n=n: rect(p, LEFT, BOT, RIGHT, eighth_y(n)))

    # Left n/8 blocks ▉▊▋▌▍▎▏ (2589–258F, widths 7/8..1/8).
    for cp, n in ((0x2589, 7), (0x258A, 6), (0x258B, 5), (0x258D, 3), (0x258E, 2), (0x258F, 1)):
        make(f"uni{cp:04X}", lambda p, n=n: rect(p, LEFT, BOT, eighth_x(n), TOP))

    # Upper 1/8 ▔ and right 1/8 ▕.
    make("uni2594", lambda p: rect(p, LEFT, eighth_y(7), RIGHT, TOP))
    make("uni2595", lambda p: rect(p, eighth_x(7), BOT, RIGHT, TOP))

    # Shades ░▒▓ — 25% / 50% / 75% checkerboards.
    make("uni2591", lambda p: shade(p, lambda r, c: (r + 2 * c) % 4 == 0))
    make("uni2592", lambda p: shade(p, lambda r, c: (r + c) % 2 == 0))
    make("uni2593", lambda p: shade(p, lambda r, c: (r + 2 * c) % 4 != 0))

    # Quadrants.
    UL = (LEFT, MID_Y, MID_X, TOP)
    UR = (MID_X, MID_Y, RIGHT, TOP)
    LL = (LEFT, BOT, MID_X, MID_Y)
    LR = (MID_X, BOT, RIGHT, MID_Y)
    quads = {
        0x2596: [LL],  # ▖
        0x2597: [LR],  # ▗
        0x2598: [UL],  # ▘
        0x2599: [UL, LL, LR],  # ▙
        0x259A: [UL, LR],  # ▚
        0x259B: [UL, UR, LL],  # ▛
        0x259C: [UL, UR, LR],  # ▜
        0x259D: [UR],  # ▝
        0x259E: [UR, LL],  # ▞
        0x259F: [UR, LL, LR],  # ▟
    }
    for cp, rects in quads.items():
        def draw(p, rects=rects):
            for r in rects:
                rect(p, *r)
        make(f"uni{cp:04X}", draw)

    return glyphs


def main():
    glyphs = build_glyphs()
    glyph_order = [".notdef"] + sorted(glyphs.keys())
    cmap = {int(n[3:], 16): n for n in glyphs}

    fb = FontBuilder(UPM, isTTF=True)
    fb.setupGlyphOrder(glyph_order)
    fb.setupCharacterMap(cmap)

    pen = TTGlyphPen(None)
    all_glyphs = {".notdef": pen.glyph(), **glyphs}
    fb.setupGlyf(all_glyphs)
    fb.setupHorizontalMetrics({n: (ADVANCE, 0) for n in glyph_order})
    fb.setupHorizontalHeader(ascent=ASCENT, descent=-DESCENT)
    fb.setupOS2(
        sTypoAscender=ASCENT,
        sTypoDescender=-DESCENT,
        sTypoLineGap=0,
        usWinAscent=TOP,
        usWinDescent=-BOT,
    )
    fb.setupNameTable({"familyName": "Tethra Blocks", "styleName": "Regular"})
    fb.setupPost()

    out = Path(__file__).resolve().parent.parent / "apps/ui/src/assets/fonts/TethraBlocks.ttf"
    out.parent.mkdir(parents=True, exist_ok=True)
    fb.save(str(out))
    print(f"wrote {out} ({out.stat().st_size} bytes, {len(glyphs)} glyphs)")


if __name__ == "__main__":
    main()

"""Build the tiny variable test font of the `shaping/fonts` tests (authored here, no third-party glyphs).

Run with fontTools installed: `python tiny-font.py > tiny-font.b64`. The font has one weight axis
(`wght`, 100..900, default 400). Glyphs: space, I (a stem), O (a square ring), B (a bar with two
counters), o (a rounded square, quadratic curves), A and V (a kerning pair of -100 units).
Em = 1000. At the default weight the stroke is 100 units; at 900 it is 200; at 100 it is 50.
"""
import base64
import io

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import newTable
from fontTools.ttLib.tables.TupleVariation import TupleVariation
from fontTools.ttLib.tables._k_e_r_n import KernTable_format_0

EM = 1000
DEFAULT_STROKE = 100
ADVANCE = 700
KERN_AV = -100
# stroke change (font units) per side at wght 900 and at wght 100, relative to the default
STROKE_MAX_DELTA = 100
STROKE_MIN_DELTA = -50


def rect(pen, x0, y0, x1, y1, hole=False):
    pts = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]  # counter-clockwise
    if not hole:
        pts = pts[::-1]  # TrueType: outer contours clockwise
    pen.moveTo(pts[0])
    for p in pts[1:]:
        pen.lineTo(p)
    pen.closePath()


def glyph_i():
    p = TTGlyphPen(None)
    rect(p, 100, 0, 100 + DEFAULT_STROKE, 700)
    return p.glyph()


def glyph_o():
    p = TTGlyphPen(None)
    rect(p, 0, 0, 600, 700)
    rect(p, DEFAULT_STROKE, DEFAULT_STROKE, 600 - DEFAULT_STROKE, 700 - DEFAULT_STROKE, hole=True)
    return p.glyph()


def glyph_b():
    p = TTGlyphPen(None)
    rect(p, 0, 0, 600, 700)
    rect(p, 100, 100, 500, 300, hole=True)
    rect(p, 100, 400, 500, 600, hole=True)
    return p.glyph()


def glyph_round():
    p = TTGlyphPen(None)
    p.moveTo((300, 0))
    p.qCurveTo((600, 0), (600, 300))
    p.qCurveTo((600, 600), (300, 600))
    p.qCurveTo((0, 600), (0, 300))
    p.qCurveTo((0, 0), (300, 0))
    p.closePath()
    return p.glyph()


def glyph_tri():
    p = TTGlyphPen(None)
    p.moveTo((0, 0)); p.lineTo((300, 700)); p.lineTo((600, 0)); p.closePath()
    return p.glyph()


def glyph_inv():
    p = TTGlyphPen(None)
    p.moveTo((0, 700)); p.lineTo((600, 700)); p.lineTo((300, 0)); p.closePath()
    return p.glyph()


def ring_deltas(grow):
    """Deltas for `glyph_o`: the outer square fixed, the counter shrinks by `grow` per side."""
    outer = [(0, 0)] * 4
    d = grow
    # inner rect points (counter-clockwise): (s,s) (600-s,s) (600-s,700-s) (s,700-s); stroke grows => move inwards
    inner = [(d, d), (-d, d), (-d, -d), (d, -d)]
    return outer + inner


def gvar_for(name):
    if name == "O":
        hi, lo = ring_deltas(STROKE_MAX_DELTA), ring_deltas(STROKE_MIN_DELTA)
    elif name == "I":
        # right edge of the stem moves right: points 1 and 2
        hi = [(0, 0), (STROKE_MAX_DELTA, 0), (STROKE_MAX_DELTA, 0), (0, 0)]
        lo = [(0, 0), (STROKE_MIN_DELTA, 0), (STROKE_MIN_DELTA, 0), (0, 0)]
    else:
        return []
    phantom_hi = [(0, 0), (STROKE_MAX_DELTA if name == "I" else 0, 0), (0, 0), (0, 0)]
    phantom_lo = [(0, 0), (STROKE_MIN_DELTA if name == "I" else 0, 0), (0, 0), (0, 0)]
    return [
        TupleVariation({"wght": (0.0, 1.0, 1.0)}, hi + phantom_hi),
        TupleVariation({"wght": (-1.0, -1.0, 0.0)}, lo + phantom_lo),
    ]


def main():
    order = [".notdef", "space", "I", "O", "B", "o", "A", "V"]
    fb = FontBuilder(EM, isTTF=True)
    fb.setupGlyphOrder(order)
    fb.setupCharacterMap({32: "space", ord("I"): "I", ord("O"): "O", ord("B"): "B", ord("o"): "o", ord("A"): "A", ord("V"): "V"})
    glyphs = {
        ".notdef": TTGlyphPen(None).glyph(),
        "space": TTGlyphPen(None).glyph(),
        "I": glyph_i(),
        "O": glyph_o(),
        "B": glyph_b(),
        "o": glyph_round(),
        "A": glyph_tri(),
        "V": glyph_inv(),
    }
    fb.setupGlyf(glyphs)
    fb.setupHorizontalMetrics({g: (ADVANCE, 0) for g in order})
    fb.setupHorizontalHeader(ascent=800, descent=-200)
    fb.setupNameTable({"familyName": "Shaping Tiny", "styleName": "Regular"})
    fb.setupOS2(sTypoAscender=800, sTypoDescender=-200, usWinAscent=800, usWinDescent=200)
    fb.setupPost()
    fb.setupFvar([("wght", 100, 400, 900, "Weight")], [])
    variations = {}
    for name in order:
        v = gvar_for(name)
        if v:
            variations[name] = v
    fb.font["gvar"] = newTable("gvar")
    fb.font["gvar"].version = 1
    fb.font["gvar"].reserved = 0
    fb.font["gvar"].variations = variations
    fb.font["gvar"].axisTags = ["wght"]
    kern = newTable("kern")
    kern.version = 0
    table = KernTable_format_0()
    table.version = 0
    table.coverage = 1
    table.format = 0
    table.kernTable = {("A", "V"): KERN_AV}
    kern.kernTables = [table]
    fb.font["kern"] = kern
    buf = io.BytesIO()
    fb.save(buf)
    print(base64.b64encode(buf.getvalue()).decode())


main()

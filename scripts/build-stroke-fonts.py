"""Rebuild stroke JSON and the Hershey typing font. Requires fonttools.
Original SVG sources and their notices are retained in public/fonts/sources.
Display contours are only for editable text; conversion uses the SVG strokes.
"""
import json, math, re
from pathlib import Path
from xml.etree import ElementTree as ET
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

root = Path(__file__).resolve().parent.parent / 'public/fonts'
ns = {'s': 'http://www.w3.org/2000/svg'}
for stem in ['HersheySans1', 'ReliefSingleLineSVG-Regular']:
    source = ET.parse(root / 'sources' / (stem + '.svg'))
    font = source.find('.//s:font', ns)
    face = font.find('s:font-face', ns)
    glyphs = {g.get('unicode'): {'path': g.get('d', ''), 'advance': float(g.get('horiz-adv-x', font.get('horiz-adv-x')))}
              for g in font.findall('s:glyph', ns) if g.get('unicode') and len(g.get('unicode')) == 1}
    data = {'unitsPerEm': int(face.get('units-per-em')), 'ascender': int(face.get('ascent')), 'glyphs': glyphs}
    (root / (stem + '.json')).write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')) + '\n')
    if stem != 'HersheySans1':
        continue
    notice = source.find('s:metadata', ns).text.strip()
    (root / 'Hershey-NOTICE.txt').write_text(notice + '\n\nVectora display TTF: a 24-unit round stroke of this original single-line data.\nOriginal SVG/JSON center lines remain the conversion source.\n')
    # All Hershey Sans 1 glyphs are polylines. Fill overlapping clockwise stroke
    # rectangles and round caps using the nonzero winding rule in browser fonts.
    order = ['.notdef'] + [f'uni{ord(char):04X}' for char in glyphs]
    outlines = {'.notdef': TTGlyphPen(None).glyph()}
    metrics = {'.notdef': (378, 0)}
    for char, glyph in glyphs.items():
        pen = TTGlyphPen(None)
        def polygon(points):
            pen.moveTo(tuple(round(v) for v in points[0]))
            for point in points[1:]: pen.lineTo(tuple(round(v) for v in point))
            pen.closePath()
        def cap(point):
            polygon([(point[0] + 12 * math.cos(-i * math.tau / 12), point[1] + 12 * math.sin(-i * math.tau / 12)) for i in range(12)])
        previous = None
        for command, sx, sy in re.findall(r'([ML])\s*([-\d.]+)\s+([-\d.]+)', glyph['path']):
            point = (float(sx), float(sy))
            if command == 'L' and previous is not None:
                dx, dy = point[0]-previous[0], point[1]-previous[1]
                length = math.hypot(dx, dy)
                if length:
                    nx, ny = -dy / length * 12, dx / length * 12
                    polygon([(previous[0]+nx,previous[1]+ny),(point[0]+nx,point[1]+ny),(point[0]-nx,point[1]-ny),(previous[0]-nx,previous[1]-ny)])
            cap(point)
            previous = point
        name = f'uni{ord(char):04X}'
        outlines[name] = pen.glyph()
        # TTF lsb must match the actual xMin to retain the source SVG placement.
        contours = outlines[name]
        lsb = min((p[0] for p in contours.coordinates), default=0) if contours.numberOfContours else 0
        metrics[name] = (round(glyph['advance']), lsb)
    builder = FontBuilder(1000, isTTF=True)
    builder.setupGlyphOrder(order)
    builder.setupCharacterMap({ord(char): f'uni{ord(char):04X}' for char in glyphs})
    builder.setupGlyf(outlines)
    builder.setupHorizontalMetrics(metrics)
    builder.setupHorizontalHeader(ascent=800, descent=-200)
    builder.setupNameTable({'familyName': 'Vectora Hershey Display', 'styleName': 'Regular', 'uniqueFontIdentifier': 'VectoraHersheyDisplay-Regular-1', 'fullName': 'Vectora Hershey Display Regular', 'psName': 'VectoraHersheyDisplay-Regular', 'version': 'Version 1.0', 'copyright': notice})
    builder.setupOS2(sTypoAscender=800, sTypoDescender=-200, usWinAscent=1000, usWinDescent=300)
    builder.setupPost()
    builder.save(root / 'HersheySans1-Display.ttf')
    print('Built Hershey display font and original stroke data')

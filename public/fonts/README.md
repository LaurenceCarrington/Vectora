# Bundled text fonts

All fonts load from this directory; there are no external font requests. Existing Lato, PT Serif and Space Mono remain available. Newly added families:

| Font | Upstream | License / files |
| --- | --- | --- |
| Hershey Sans 1-stroke | [Hershey Text JS SVG collection](https://github.com/techninja/hersheytextjs/tree/262f4782cd412ee539eb43d4d9d9b92562d7590b/svg_fonts) | Hershey's original use conditions and acknowledgements, `Hershey-NOTICE.txt`; also embedded in `sources/HersheySans1.svg` |
| Relief Single Line | [isdaT Relief SingleLine](https://github.com/isdat-type/Relief-SingleLine/tree/01dfc5779ec1e9e4b288d96c6c96c23bfccbaf9d) | OFL 1.1, `Relief-OFL.txt` |
| FreeMono (GNU FreeFont 20120503) | [GNU binary release](https://ftp.gnu.org/gnu/freefont/freefont-ttf-20120503.zip), [corresponding source](https://ftp.gnu.org/gnu/freefont/freefont-src-20120503.tar.gz) | GPLv3+ with font exception; `FreeFont-LICENSE.txt`, `FreeFont-COPYING.txt`, `FreeFont-AUTHORS.txt`, `FreeFont-README.txt` |
| Inter | [Google Fonts / Inter](https://github.com/google/fonts/tree/main/ofl/inter) | OFL, `inter-OFL.txt` |
| JetBrains Mono | [Google Fonts / JetBrains Mono](https://github.com/google/fonts/tree/main/ofl/jetbrainsmono) | OFL, `jetbrainsmono-OFL.txt` |
| Oswald | [Google Fonts / Oswald](https://github.com/google/fonts/tree/main/ofl/oswald) | OFL, `oswald-OFL.txt` |
| Montserrat | [Google Fonts / Montserrat](https://github.com/google/fonts/tree/main/ofl/montserrat) | OFL, `montserrat-OFL.txt` |
| Bebas Neue | [Google Fonts / Bebas Neue](https://github.com/google/fonts/tree/main/ofl/bebasneue) | OFL, `bebasneue-OFL.txt` |
| Allerta Stencil | [Google Fonts / Allerta Stencil](https://github.com/google/fonts/tree/main/ofl/allertastencil) | OFL, `allertastencil-OFL.txt` |
| Saira Stencil One | [Google Fonts / Saira Stencil One](https://github.com/google/fonts/tree/main/ofl/sairastencilone) | OFL, `sairastencilone-OFL.txt` |

Downloaded 2026-09-26. Inter, JetBrains Mono, Oswald and Montserrat are static Regular (400) instances made with FontTools 4.60.2; Inter optical size is 14. This keeps browser typing and OpenType path conversion on exactly the same font instance. The remaining outline font binaries are unmodified upstream Regular files.

Hershey and Relief use the original single-line SVG data (retained under `sources/`) for Convert to path and DXF, not the filled display outlines. JSON contains the original glyph path commands and advance widths. `scripts/build-stroke-fonts.py` rebuilds the JSON and a Hershey display TTF with 24-unit round strokes for editable browser text. That display font uses the source's glyph advances, coordinates and metrics. Relief uses its upstream outline OTF for browser text and its SVG paths for engraving. No font library code was copied from Hershey Text JS. The Hershey data carries its own permissive use conditions, rather than the repository's code license.

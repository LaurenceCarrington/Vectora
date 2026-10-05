# Paint by numbers

Generates printable vector colouring sheets from local images. Open **Generators → Paint by numbers**, choose an image, adjust the palette/detail/cleanup/page settings and click **Insert into canvas**. Each connected region receives its palette number; the sheet includes a numbered colour key. The optional reference uses the same simplified regions and edited palette.

Insertion creates uniquely named custom Artwork layers, selects the numbered sheet and puts the reference 20 mm beside it. It is one undo transaction. Paths, region numbers, key text, swatches and white page backgrounds are ordinary editable document objects. Save/reopen `.vectora` normally; to print/export only the numbered page, choose **File → Export → Selection → SVG or PDF**. The source image and generator parameters are not stored or linked to inserted artwork.

## Modules

- `quantize.ts`: deterministic, weighted 5-bit RGB histogram clustering, bounded to 32,768 bins and 12 iterations. Full channel sums preserve exact flat colours. Transparent pixels below alpha 16 are excluded; other alpha composites over white.
- `regions.ts`: four-neighbour components, adjacency-guided cleanup using union-find, shared pixel boundaries with retained junctions, collinear simplification, holes and conservative label placement. Candidate distance fields rank interior points; row-run tests verify actual Lato glyph rectangles plus outline clearance. Unlabelable isolated fragments cannot insert.
- `process.ts` / `paint.worker.ts`: validate settings and run the bounded pipeline off the UI thread. Actual palette count determines physical image fit before cleanup. Every worker response is tied to source/generation IDs; the dialog terminates obsolete requests.
- `layout.ts`: A4/A3/custom physical page sizing, proportional image fit, editable three-column colour keys and the vector preview. Includes true white backgrounds and black ink, independent of appearance theme.
- `paperSheets.ts`: locally bundled Lato metrics, ordinary editable text and detached paths with supported style metadata. No raster picture is embedded in output.
- `dialog.ts`: local validated image decoding, 400/800/1200-pixel analysis detail, debounced settings, shared internal palette picker, preview tabs and guarded insertion.

Input limits are 20 MB / 40 megapixels. Analysis stays below 1200 pixels per side. At most 20,000 initial components, 2,000 final regions, 800,000 boundary edges and 100,000 simplified vertices are processed. Existing document contour/segment limits also include all text glyphs and both sheets before insertion. High detail may exceed these limits; fewer colours, lower detail or increased cleanup make simpler sheets. Cleanup and automatic number fitting can merge small details, so the reference represents the resulting paintable design rather than an exact photographic trace.

Implementation is original and uses existing browser/Paper/OpenType APIs without another dependency or image-upload service. Tests cover deterministic colours, alpha, coverage, holes, diagonal contacts, cleanup, labels, topology/complexity limits, page sizing, editable insertion/rollback/history, document/export fidelity, worker cancellation, palette editing and responsive themes/reference parity.

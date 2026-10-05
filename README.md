# Vectora

Vectora is a browser-based 2D CAD and vector drawing app for creating precise artwork, laser-cut outlines, engraving designs, sticker artwork and editable mechanical profiles. Work in millimetres on an infinite or measured canvas, then save your projects or export them for other applications.

**[Open Vectora on GitHub Pages](https://laurencecarrington.github.io/Vectora/)** — no installation required.

## What you can do

- **Draw precisely:** rectangles, circles, ellipses, polygons, stars, hearts, lines, polylines, freehand curves and three arc workflows. Use rulers, grid and object snapping, and exact dimensions.
- **Edit geometry:** move, resize, rotate, flip, duplicate, align and distribute objects. Edit curve nodes, join or explode contours, close paths, trim sections, create offsets, and apply fillets or chamfers to straight-edge corners.
- **Combine and repeat:** Weld, Subtract and Intersect closed shapes, or create rectangular and circular patterns with editable copies.
- **Create text and artwork:** type directly on the canvas, choose bundled fonts, convert lettering to paths, and trace images into outlines, centre lines or filled vectors.
- **Apply fills:** colour individual enclosed regions, including intersections between overlapping outlines. Choose solid colours, linear or radial gradients, and stripes, crosshatch, dots or checkerboard patterns.
- **Generate designs:** gears, racks, sprockets, pulleys, fasteners, cams, finger-jointed boxes, living hinges, packaging nets, trusses, Voronoi panels, spirographs, mazes, jigsaw puzzles, colour-by-numbers sheets, halftone holes and wave patterns. Generators produce editable 2D paths and views. Colour by numbers defaults to Heavy smoothing, with Off and Light options; numbered and coloured-reference sheets share matching smooth boundaries. Raster to vector also has a Colour mode with 2–32 colours and an Off/Light/Heavy smoothing slider, inserting editable filled regions into Artwork.
- **Preview finished pieces:** inspect a 360° material preview with through-cut outlines and holes, recessed vector/raster engraving, six materials, sheet thickness and optional Artwork colours.
- **Manage documents:** open multiple tabbed projects, use Undo/Redo, and save editable `.vectora` files with their layers, text, canvas, grid and view settings.

## Getting started

1. [Open the app](https://laurencecarrington.github.io/Vectora/). Choose **Infinite**, a **Machine beds** or **Sticker sheets** preset, or enter a custom canvas size. Choose the grid pattern and spacing, then create your document.
2. Open **Layers** on the right toolbar and click the layer you want to draw in. New shapes go into the active layer, which must be visible and unlocked.
3. Choose a drawing tool on the left toolbar. For example, press **R** and drag to draw a rectangle, then press **V** to return to Select.
4. Select your object and open **Properties** on the right for exact position, dimensions, rotation, line style and line weight in millimetres.
5. Use **File → Save** to keep an editable `.vectora` project, or **File → Export…** to prepare an SVG, PDF, PNG or DXF.

A fixed canvas is a visual size guide: you can draw outside it, and it does not crop exports or automatically set their size. Change it later through **File → Canvas size**. Grid settings remain editable in **Preferences → Grid** and are saved separately for each document.

**Preferences → General** remembers your default canvas preset, measurement units (mm/cm/inches), decimal places, startup choice and recovery interval in this browser. New-document defaults do not change an existing canvas or grid. Units apply to Properties, precise creation, rulers and dimension labels; focused fields show unrounded values and display rounding never alters geometry. Startup can restore tabs or open New document alongside recovered tabs. Recovery shows the working-copy size and, where supported, estimated browser site storage usage. Backups run every 250 ms to one minute and are attempted again when leaving the page; save `.vectora` files for independent copies.

## Moving around and editing

Scroll over the canvas to zoom around the pointer. Hold **Space** and drag to pan. Click the zoom percentage in the bottom bar to return to **100%**. The magnet at the bottom of the left toolbar, or **S**, pauses and resumes snapping; configure individual modes in **Preferences → Snapping**.

Click an object to select it, or drag from empty canvas to select fully enclosed objects. **Shift-click** toggles an object in the selection; **Shift-drag** adds objects. Drag selected objects to move them, square handles to resize, and the round handle above the selection to rotate. The floating selection menu contains alignment, shape operations and other editing tools. Right-click with Select for copy, paste and layer changes.

Selecting **Rectangle, Circle, Ellipse, Polygon, Star, Heart, Line or an arc tool** opens Properties with a creation form. Enter exact position and dimensions, choose line style/weight and click **Add to canvas**. The object goes into the active visible, unlocked layer, is selected and can be undone in one step. Circle offers radius/diameter; Line uses length and clockwise angle; polygons/stars have side/point counts; arcs have radius, start and signed sweep. Draft fields do not change the drawing. Normal canvas gestures remain available, and Properties shows the completed object for editing.

Editing **Properties** uses the same compact controls: circle radius/diameter, line length/angle, regular polygon/star radius and side/point count, and circular arc radius/start/sweep. X/Y is the centre for circles, regular polygons/stars and arcs, or the start of a line. **Bounds & rotation** contains additional axis-aligned size controls; freeform paths and multi-selections show bounds directly. Each edit preserves the layer and styling and supports undo.

Use **Node editing (N)** to reshape paths. Drag nodes and curve handles, double-click a path to add a node, or right-click a node for corner and path operations. In **Properties → Line**, choose Solid, Dashed, Dotted or Dash-dot and enter a physical line weight.

The top toolbar’s **Search** finds available tools. The **Help** icon opens a guide with controls, keyboard commands and worked examples. Notifications are stored behind the bell icon at the bottom of the right toolbar.

## Layers and fills

| Layer | Purpose |
| --- | --- |
| Cut Path — red | Cutting outlines, exported separately in DXF. |
| Engrave Path — blue | Engraving paths and score/fold geometry. |
| Construction Path — magenta | Editing guides, excluded from exports. |
| Raster Engrave — black | Black outlines and filled engraving artwork; included in SVG, PDF and PNG, excluded from DXF. |
| Artwork | General drawing, text, colour fills and annotations. Default strokes follow the editor theme and export as black. |

Expand layers to inspect their objects. Use the eye and lock controls to hide or protect content. Move objects by dragging their rows onto another visible, unlocked layer, or use **right-click → Layer** on the canvas.

Choose **Add layer** below the list to create an Artwork, Cut, Engrave or Construction layer. Double-click its name or press **F2** to rename it; Enter saves and Escape cancels. Click its colour marker to choose a layer colour. **Delete layer** confirms removal of the custom layer and its contents. Built-in layers stay protected, and locked custom layers must be unlocked first. Names and colours are saved with the document, and these edits support Undo/Redo. Layer colours affect inherited outlines and text; individual Artwork colours and fills keep their appearance.

For fills, select **Fill (B)** to open **Fill & appearance**, or open it using the palette icon on the right. Choose **Colour**, **Gradient** or **Pattern**, then click inside an enclosed area with Fill active. All fill types create or recolour objects in Artwork, regardless of the active drawing layer. Artwork must be visible and unlocked. **No fill** is selected initially; use it to remove a region’s colour while keeping the surrounding outlines.

## Material & process preview

Click **Preview** (the cube in the top toolbar) to inspect finished pieces. Closed Cut Path outlines define the parts; nested outlines form holes. Engrave Path and Raster Engrave recess filled regions or line strokes, with separate depths. Open cuts form narrow grooves. Overlapping operations use the deepest depth, and engraving without a cut outline gets a fitted rectangular blank.

Choose a material and thickness, then adjust the process depths. **Artwork colours** overlays your original artwork. Drag to rotate, middle/right-drag or Shift-drag to pan, and scroll or Ctrl/Cmd-drag to zoom. On touchscreens, use one finger to rotate and two fingers to pan and pinch. **Fit** (or **F**) recentres the model without changing the viewing angle; **Reset** (or **Home**) returns to the fitted top view. View buttons provide Top, Back, Front, Left, Right and Isometric views with smooth transitions. The preview starts in Top view and leaves your drawing and exports unchanged. Material finishes are visual approximations; Raster Engrave previews existing vector regions at a uniform depth.

## Saving and exporting

Click the project name at the top to rename it. **File → New document**, or the **+** on the document bar, creates a new tab; **Open** adds a saved `.vectora` file in another tab. Each tab keeps its own drawing, history, selection, grid, view and save target. **Save As** creates a separate project file.

Vectora keeps local recovery copies of open documents in your browser. Clearing site data removes them, and undo history does not survive a reload. Save `.vectora` files for portable copies. Browsers with file-picker support can save directly to a chosen file; other browsers download it using their download settings.

**File → Export…** opens a preview and format-specific settings. Choose the whole drawing or the current selection, name your file, and use **Advanced → Layers** to control which layers are included.

| Format | Options and use |
| --- | --- |
| SVG | Vector curves, colours, fills and outlined lettering. Set physical width, margin and layer grouping. |
| PDF | Printable artwork with fitted, A4, A3 or Letter pages, orientation, margin and scale. Use 100% scale for actual-size output. |
| PNG | Raster artwork with adjustable DPI and pixel width, plus transparent or coloured backgrounds. Default resolution is 300 DPI. |
| DXF | Cutting and engraving geometry. Choose Standard DXF (2000) or Laser-compatible DXF (R12), curve tolerance, and optional Move to origin. Include Artwork when needed. |

Laser-compatible DXF uses basic line segments for more restrictive importers. Select **millimetres** when importing it and check dimensions and contours in the receiving software before cutting. DXF exports geometry: fills become boundaries, and dashed styles export as continuous paths. SVG, PDF and PNG retain the visual line styles and fills; transparent PDF gradients are rasterised while other artwork remains vector.

Exporting leaves the editable document unchanged. Keep a `.vectora` copy when you want to retain editable text and the complete project structure.

## Handy shortcuts

Use **Ctrl** on Windows/Linux and **Cmd (⌘)** on macOS. Click the canvas before using drawing shortcuts.

| Shortcut | Action |
| --- | --- |
| V / N | Select / Node editing |
| R / C / E | Rectangle / Circle / Ellipse |
| L / P / F | Line / Polyline / Freehand |
| T / B / S | Text / Fill / Toggle snapping |
| Space + drag | Pan |
| Escape | Cancel an unfinished action or clear selection |
| Delete / Backspace | Delete selection or active node |
| Ctrl/Cmd + Z | Undo |
| Ctrl/Cmd + Shift + Z | Redo |
| Ctrl/Cmd + C / V | Copy / Paste |
| Ctrl/Cmd + N / O | New document / Open |
| Ctrl/Cmd + S | Save |
| Ctrl/Cmd + Shift + S | Save As |
| Ctrl/Cmd + E | Open export settings on SVG |
| Ctrl/Cmd + Shift + E | Open export settings on DXF |
| F1 | Help |

Browser-reserved shortcuts may behave differently across browsers and operating systems. The in-app Help menu includes the full shortcut list and drawing instructions.

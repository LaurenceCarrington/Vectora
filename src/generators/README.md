# Mechanical profile generators

All calculations are local, in millimetres. No external service or additional runtime dependency is used. The lazy-loaded workbench shares its controls, geometry and styles with the design-system reference. Parameter changes debounce for 80 ms; counts and dimensions are bounded, and insertion is disabled until the current preview validates.

## Profile definitions

- **Spur**: pitch radius `m*z/2`, base radius `rp*cos(alpha)`, addendum `m`, dedendum `1.25*m`. Involute polar angle is `sqrt((r/rb)^2 - 1) - atan(sqrt((r/rb)^2 - 1))`. Pitch-circle tooth thickness is half the circular pitch minus the entered backlash. Roots have radial connections and circular lands; no trochoidal fillets, profile shift or cutter undercut is generated.
- **Helical transverse section**: inputs are normal module and normal pressure angle. Transverse module is `mn/cos(beta)` and transverse pressure angle is `atan(tan(alpha_n)/cos(beta))`. Addendum/dedendum use normal module. This is a 2D section, without helix geometry.
- **Bevel approximation**: virtual spur radius and tooth count are divided by `cos(pitch cone angle)`. Virtual radial coordinates are projected by that cosine; local tooth angles are divided by it to retain physical pitch thickness and tooth count. This is an approximate outer-end projection using the back-cone construction, not a spherical involute or a manufactured bevel tooth surface.
- **Rack & pinion**: straight rack flanks use the pressure angle; pitch is `pi*m`. The rack pitch line is tangent to the pinion pitch circle, phased with a rack valley beneath the pinion's downward-facing tooth. Both are inserted as separate parts.
- **Sprocket**: pitch radius is `chain pitch / (2*sin(pi/z))`. Circular roller seats, with editable radial clearance, intersect the selected outer circle. Seats are linked by circular outer lands. Standard-specific entry/flank radii are not included.
- **Timing pulleys**: pitch radius is `z*pitch/(2*pi)`; outer radius is reduced by pitch-line offset. Trapezoidal grooves have editable opening, radial depth and flank angle. Rounded grooves use a smooth half-sine radial depression over a cosine-spaced angle. Both are custom profiles, not GT/HTD or other belt standards.
- **Threads**: a custom V-form axial section, with flank run `depth*tan(included angle/2)` and equal crest/root flats. Opposite sides are offset by half a pitch. Bolt heads use a rectangular side silhouette; nuts are hexagonal top views with plain circular bores. No ISO/UNC tolerance or standard truncation is implied.
- **Cams**: inline translating knife-edge or roller follower. Rise/return use cycloidal, simple harmonic, or 3–4–5 polynomial displacement. The roller pitch curve is offset inward along its normal by the roller radius. Positive pitch-curve curvature is checked against roller radius to reject local offset cusps/undercutting. Maximum pressure angle is reported. Remaining rotation becomes the low dwell; base/lift and phase angles are checked before generation.

Engineering curves are adaptive polylines with approximately 0.015 mm chord tolerance; circular arcs use a chord-error limit and cams also sample at least every degree and at phase boundaries. Sampling is bounded to 50,000 points. Native Paper circle contours retain cubic circle geometry. Shared endpoints are deduplicated. Generated paths are ordinary editable objects (not parametric objects); bores have opposite winding, and guides are preview-only. No manufacturing simulation is performed.

## Reference material

These sources informed the mathematical definitions; no third-party implementation was copied:

- [KHK — Calculation of gear dimensions](https://khkgears.net/new/gear_knowledge/gear_technical_reference/calculation_gear_dimensions.html): involute, normal/transverse and bevel gear systems.
- [Carnegie Mellon — Mechanisms, Chapter 6: Cams](https://www.cs.cmu.edu/~rapidproto/mechanisms/chpt6.html): follower displacement, motion laws and roller cam geometry.
- [Renold — Conveyor chain designer guide](https://www.renold.com/media/165388/conveyor-ins-main-ren16-eng-10-10.pdf): chain pitch circles and sprocket tooth-profile terminology.
- [SDP/SI — Timing belt pulleys](https://sdp-si.com/products/Timing-Belt-Pulleys/index.php): distinction between trapezoidal and standard-specific curvilinear profiles.

`tests/generators.spec.ts` covers default contour topology, physical dimensions, invalid inputs, bounded generation, live controls, undo, layers, document round-trip, SVG/DXF, production loading, reference parity, keyboard isolation and responsive layouts.

## Enclosures and structural profiles

Four more families share the same lazy-loaded workbench and ordinary editable path insertion:

- **Finger-jointed boxes:** six-panel closed and five-panel open-top layouts. Inputs are outside width/depth/height. Every shared edge uses an odd number of evenly divided fingers over the span between its thickness-sized corners. Partner edges use complementary phases. Front/back panels own the three-way corner blocks; side/base/top panels omit those blocks. The first/last finger phase keeps every panel connected. Joint clearance expands notch spans by half the clearance on each side; it is not a laser offset. Layout gap only changes part placement. Kerf compensation is left to cutting software.
- **Interlocking tab/slot joints:** projecting tabs on one upright fit rectangular holes in a receiver. The receiver holes are wider and deeper by the specified fit clearance. The T-slot variant uses an even tab count, a central bolt clearance hole in the receiver and a shaft-width open notch leading to a wider nut pocket in the upright. Nut width, thickness and setback are editable; checks prevent overlap with tabs and panel edges.
- **Living hinges:** alternating columns of interrupted slits, with a half-period shift in adjacent columns; horizontal mode rotates the pattern inside the supplied panel dimensions. Rounded-slot mode creates closed capsule cuts. The outside panel remains a closed contour, while slit paths stay open. Border dimensions are measured to the cut geometry, including slot width. Expected cut width estimates remaining bridges and webs without moving paths. Material-specific bend radius, fatigue and strength are not calculated.
- **Packaging:** a reverse-tuck folding carton, equal-flap slotted shipping carton and four-wall glued tray. Dimensions are crease-to-crease; flap shortfall provides editable closing clearance. Glue tabs, flap separation and tuck length are explicit. These are custom nets, not a claim of compliance with a named packaging standard. Board caliper, crease width and bend allowance must be accounted for when selecting dimensions. Adjacent rectangles are united into one perimeter so common cut edges are not duplicated. Fold paths cover only attached panel interfaces and remain separate open geometry.
- **Frameworks:** Warren, Pratt and Howe trusses plus rectangular lattices. Overall outer dimensions include the frame. Truss skeleton faces are triangles inset by half the member width; adjacent inset faces leave a web of the requested perpendicular width. Collapsed holes are rejected. Pratt and Howe use an even bay count. This is cutting geometry without load, support or buckling calculations.

`structural.ts` uses a bounded coordinate-compressed grid for exact orthogonal panel unions/differences. Grid boundaries are normalized to 1e-8 mm before tracing; collinear points are removed. Box edges are limited to 101 finger divisions, hinge patterns to 2,500 cuts, and all generated output retains the 50,000-point cap. No image sampling, worker, geometry dependency or network request is introduced.

Packaging cut outlines use the active layer; fold/score objects go to the first Engrave Path layer. Both destinations are checked before any mutation, and insertion across layers is one undo transaction. The preview shows fold paths as blue dashed lines with an operation legend; the Guides switch hides only non-inserted guides/part labels. Fold objects use the ordinary engraving stroke after insertion. Export retains the existing layer semantics.

References used for feature terminology and scope (implementation is original):

- [Boxes.py user manual](https://florianfesti.github.io/boxes/html/usermanual.html): measured thickness, finger dimensions, clearance and the distinction between cut geometry and burn/kerf compensation.
- [Trotec — Cutting techniques for bending](https://www.troteclaser.com/en-us/helpcenter/materials/application-techniques/bending-technique): interrupted-cut patterns and material-dependent bending behaviour.

`tests/structuralGenerators.spec.ts` checks all 14 new default profiles, contour topology, complementary box volumes at every coordinate-grid cell (including three-way corners), dimensional changes, invalid/over-dense inputs, fold-layer preflight, one-step undo, SVG/DXF, document round-trip, all live profile selectors, mobile/theme layout, production and reference parity.

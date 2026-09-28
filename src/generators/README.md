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

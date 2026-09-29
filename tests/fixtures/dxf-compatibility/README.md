# DXF importer test pack

Synthetic Vectora exports. No user drawings are included.

- `standard.dxf`: R2000, one native CIRCLE and one native ARC.
- `standard-origin.dxf`: the same Standard geometry translated to the origin.
- `laser-r12.dxf`: the same drawing as basic R12 LINE entities.

Expected geometry: a 40 mm diameter circle, a 10 mm radius / 270° open arc to its right, and combined extents of **80 × 40 mm**. Both shapes are on red CUTLINE. The arc's upper-right quarter is absent. Standard coordinates span (30, −80) to (110, −40) mm; the origin version spans (0, 0) to (80, 40) mm.

## Import procedure

Open/import each file into LightBurn, TechSoft 2D Design and Adobe Illustrator. Choose millimetres, original size / 100%, and one drawing unit = 1 mm. Disable fit-to-page scaling. Check both shapes are visible, the circle is closed, the arc is open, dimensions match the values above, and the red cut layer remains distinguishable. Check the origin file separately. Do not send this test to a machine.

## Recorded checks — 2026-09-29

| Reader | Standard | Laser R12 |
| --- | --- | --- |
| ezdxf 1.4.2 independent parser/audit | Passed, no errors or repairs | Passed, no errors or repairs |
| Adobe Illustrator 2026, macOS | Imported circle and arc; 226.7717 × 113.3858 pt = 80 × 40 mm | Imported line geometry; same physical dimensions |
| LightBurn | Not tested: not installed in this environment | Not tested: not installed in this environment |
| TechSoft 2D Design | Not tested: not installed in this environment | Not tested: not installed in this environment |

Illustrator required explicitly setting 1 drawing unit = 1 millimetre even for the unit-tagged Standard file. Import support depends on application/version; this is not a universal compatibility guarantee.

The actual import exposed missing R2000 symbol-table defaults and layer plot-style references that ezdxf supplies silently while reading. Regression tests therefore inspect those raw records in addition to running an independent audit.

## Regenerate and validate

Run `npx playwright test tests/dxfCompatibility.spec.ts`. It writes the current exporter output into `test-results/standard-native.dxf`, `standard-native-origin.dxf` and `laser-native-fallback.dxf`. Copy those three files here using the corresponding names above whenever the exporter changes.

For independent validation, install `ezdxf==1.4.2` in a separate Python virtual environment and run:

```sh
python scripts/audit-dxf.py tests/fixtures/dxf-compatibility/*.dxf
```

The application has no Python/ezdxf runtime dependency. Automated coverage also checks transformed/edited circles, reflected arcs with short/long sweeps, three-point arcs, compound holes, zero-area self-crossings, annotation styles, safe layer names, curve tolerance, origin/preview bounds and 30,000-vertex exports.

Development verification: 33 focused exporter/dialog/font/dimension tests passed. Additional editor checks covered history, transforms, layers, joining and text conversion. Three older editor tests (ellipse snapping, marquee movement and dissect fixture layer counts) fail identically on unchanged commit `bbdd798`; these are separate from the DXF changes.

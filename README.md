# Vectora

Vectora is a browser-based 2D CAD and manufacturing workspace for drawing, editing, and preparing designs for laser cutting and CNC machining.

[Launch Vectora](https://laurencecarrington.github.io/Vectora/)

## Features

- Precision drawing with shapes, paths, freehand strokes, text, grids, snapping, and measurements.
- Layers and object properties, including line and fill colours.
- Copy and paste selected objects with keyboard shortcuts, with undo/redo support.
- Parametric generators for gears, flat-pack boxes, living hinges, and mounting plates.
- Image tracing with outline, centreline, and filled-vector modes.
- SVG and DXF import/export, plus native `.vectora` project files.
- Part nesting, toolpath preparation, G-code export, and 3D previews.

## Your drawings

Drawings are processed on your device. Preferences, cutter libraries, and recovery copies stay in the current browser profile; they are not synced to the cloud.

Save a `.vectora` project file to keep a portable copy of your work. Local recovery is a fallback and does not replace saving your project.

## Browser support

Direct USB machine control is experimental and disabled by default. It requires an explicit risk acknowledgement, Web Serial support, and a compatible device. Access resets when Manufacture closes, USB disconnects, or the page reloads; connections never resume automatically.

Machine control has not been hardware-validated or independently reviewed for safety and is not approved for production or unattended use. A browser stop is not a physical emergency stop. G-code export remains available, but exported jobs still require validation before machine use. The 3D preview requires WebGL.

## Further information

- [Machine validation status](REAL_WORLD_VALIDATION.md)
- [Third-party attributions](LEGAL_ATTRIBUTIONS.md)
- [Dependency and provenance review](legal/AUDIT.md)

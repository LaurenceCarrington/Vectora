"""Optional independent structural audit: python3 scripts/dxf-audit.py drawing.dxf.

Requires ezdxf. Kept outside the application's runtime dependencies.
"""
import sys

import ezdxf


document = ezdxf.readfile(sys.argv[1])
auditor = document.audit()
for issue in auditor.errors + auditor.fixes:
    print(issue.code, issue.message)
assert not auditor.errors and not auditor.fixes, "DXF required errors or repairs"

curves = 0
dimensions = 0
for block in document.blocks:
    for entity in block:
        if entity.dxftype() == "SPLINE":
            spline = entity.construction_tool()
            assert spline.degree == 3
            assert len(spline.knots()) == len(spline.control_points) + 4
            curves += 1
        elif entity.dxftype() == "DIMENSION":
            assert entity.dxf.dimstyle in document.dimstyles
            assert entity.dxf.geometry in document.blocks
            assert len(document.blocks[entity.dxf.geometry]) > 0
            dimensions += 1
        elif entity.dxftype() == "INSERT":
            assert entity.dxf.name in document.blocks
assert curves and dimensions, "Expected the DXF hardening verification fixture"
print(f"Independent DXF audit passed: {curves} splines, {dimensions} dimensions, zero errors or repairs.")

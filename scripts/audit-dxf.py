"""Optional independent audit: pip install ezdxf==1.4.2, then pass DXF filenames."""
import sys
from collections import Counter
from pathlib import Path
import ezdxf
from ezdxf import bbox

paths = [Path(name) for name in sys.argv[1:]]
if not paths:
    raise SystemExit('Usage: python scripts/audit-dxf.py file.dxf [file.dxf ...]')
failed = False
for path in paths:
    try:
        doc = ezdxf.readfile(path)
        report = doc.audit()
        if report.errors or report.fixes:
            failed = True
            for issue in [*report.errors, *report.fixes]:
                print(f'{path}: {issue.code}: {issue.message}')
        bounds = bbox.extents(doc.modelspace())
        print(f'{path}: {doc.dxfversion}, {dict(Counter(e.dxftype() for e in doc.modelspace()))}, '
              f'errors={len(report.errors)}, repairs={len(report.fixes)}, '
              f'bounds={bounds.extmin}..{bounds.extmax}')
    except Exception as error:
        failed = True
        print(f'{path}: FAILED: {error}')
raise SystemExit(1 if failed else 0)

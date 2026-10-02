import ClipperFactory from 'clipper2-wasm/dist/es/clipper2z.js';
import wasmURL from 'clipper2-wasm/dist/es/clipper2z.wasm?url';
import type { MainModule, PathsD } from 'clipper2-wasm/dist/clipper2z';
import type { MaterialPreviewInput, MaterialPreviewModel, PreviewLoop, PreviewRegion, PreviewPoint, ProcessSettings } from './materialPreviewTypes';
let modulePromise: Promise<MainModule> | undefined;
const area = (p: PreviewLoop) => p.reduce((a, v, i) => { const w = p[(i + 1) % p.length]; return a + v.x * w.y - w.x * v.y; }, 0) / 2;
const inside = (p: PreviewLoop, v: PreviewPoint) => { let result = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const a = p[i], b = p[j];
    if ((a.y > v.y) !== (b.y > v.y) && v.x < (b.x - a.x) * (v.y - a.y) / (b.y - a.y) + a.x)
        result = !result;
} return result; };
function uniqueLoops(loops: PreviewLoop[]): PreviewLoop[] {
    const seen = new Set<string>();
    return loops.filter(loop => {
        const rounded = loop.map(v => [Number(v.x.toFixed(4)), Number(v.y.toFixed(4))]);
        const distinct = rounded.filter((v, i) => v[0] !== rounded[(i + rounded.length - 1) % rounded.length][0] || v[1] !== rounded[(i + rounded.length - 1) % rounded.length][1]);
        const p = distinct.filter((v, i) => { const a = distinct[(i + distinct.length - 1) % distinct.length], b = distinct[(i + 1) % distinct.length]; return Math.abs((v[0] - a[0]) * (b[1] - v[1]) - (v[1] - a[1]) * (b[0] - v[0])) > 1e-8; });
        if (p.length < 3)
            return false;
        let first = 0;
        for (let i = 1; i < p.length; i++)
            if (p[i][0] < p[first][0] || p[i][0] === p[first][0] && p[i][1] < p[first][1])
                first = i;
        const a = p.map((_, i) => p[(first + i) % p.length].join(',')).join(';'), b = p.map((_, i) => p[(first - i + p.length) % p.length].join(',')).join(';'), key = a < b ? a : b;
        if (seen.has(key))
            return false;
        seen.add(key);
        return true;
    });
}
export function previewRegions(loops: PreviewLoop[]): PreviewRegion[] {
    if (loops.length > 6000)
        throw new Error('Preview has too many contours. Hide some layers.');
    const bounds = loops.map(p => { const b = { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity }; for (const v of p) {
        b.left = Math.min(b.left, v.x);
        b.right = Math.max(b.right, v.x);
        b.top = Math.min(b.top, v.y);
        b.bottom = Math.max(b.bottom, v.y);
    } return b; }), areas = loops.map(p => Math.abs(area(p)));
    const parents = loops.map((p, i) => { let parent = -1; for (let j = 0; j < loops.length; j++) {
        const b = bounds[j], v = p[0];
        if (areas[j] <= areas[i] || v.x < b.left || v.x > b.right || v.y < b.top || v.y > b.bottom)
            continue;
        if ((parent < 0 || areas[j] < areas[parent]) && inside(loops[j], v))
            parent = j;
    } return parent; });
    const depths = parents.map((_, i) => { let d = 0; for (let p = parents[i]; p >= 0; p = parents[p])
        d++; return d; });
    return loops.flatMap((outer, i) => depths[i] % 2 ? [] : [{ outer, holes: loops.filter((_, j) => parents[j] === i) }]);
}
/** Integer-precision polygon work lives off the UI thread in production. */
export async function buildMaterialPreview(input: MaterialPreviewInput, s: ProcessSettings): Promise<MaterialPreviewModel | null> {
    if (!Number.isFinite(s.thickness) || s.thickness < .1 || s.thickness > 100 || [s.vectorDepth, s.rasterDepth, s.openCutDepth].some(d => !Number.isFinite(d) || d < 0 || d > s.thickness))
        throw new Error('Thickness must be 0.1–100 mm; process depths must be between zero and the thickness.');
    if (!input.cuts.length && !input.marks.length)
        return null;
    const engine = await (modulePromise ??= ClipperFactory({ locateFile: () => wasmURL }));
    const read = (paths: PathsD): PreviewLoop[] => { const result: PreviewLoop[] = []; let count = 0; try {
        for (let i = 0; i < paths.size(); i++) {
            const path = paths.get(i), points: PreviewLoop = [];
            try {
                count += path.size();
                if (count > 300000)
                    throw new Error('Preview geometry is too complex. Hide some layers.');
                for (let j = 0; j < path.size(); j++) {
                    const p = path.get(j);
                    try {
                        points.push({ x: p.x, y: p.y });
                    }
                    finally {
                        p.delete();
                    }
                }
            }
            finally {
                path.delete();
            }
            if (points.length >= 3)
                result.push(points);
        }
    }
    finally {
        paths.delete();
    } return result; };
    const make = (loops: PreviewLoop[]) => { const paths = new engine.PathsD(); for (const loop of loops) {
        const p = engine.MakePathD(loop.flatMap(v => [v.x, v.y]));
        try {
            paths.push_back(p);
        }
        finally {
            p.delete();
        }
    } return paths; };
    const normalize = (loops: PreviewLoop[], evenOdd: boolean) => { const p = make(loops); try {
        return read(engine.UnionSelfD(p, evenOdd ? engine.FillRule.EvenOdd : engine.FillRule.NonZero, 4));
    }
    finally {
        p.delete();
    } };
    const boolean = (a: PreviewLoop[], b: PreviewLoop[], operation: 'intersection' | 'difference' | 'union') => { const subjects = make(a), clips = make(b); try {
        return read(operation === 'intersection' ? engine.IntersectD(subjects, clips, engine.FillRule.NonZero, 4) : operation === 'difference' ? engine.DifferenceD(subjects, clips, engine.FillRule.NonZero, 4) : engine.UnionD(subjects, clips, engine.FillRule.NonZero, 4));
    }
    finally {
        subjects.delete();
        clips.delete();
    } };
    const stock = !input.cuts.length;
    let base = stock ? [] : normalize(uniqueLoops(input.cuts), true);
    if (stock) {
        const p = input.marks.flatMap(m => m.contours.flatMap(c => c.points));
        let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
        for (const v of p) {
            l = Math.min(l, v.x);
            t = Math.min(t, v.y);
            r = Math.max(r, v.x);
            b = Math.max(b, v.y);
        }
        if (!p.length)
            return null;
        const margin = Math.max(5, Math.max(r - l, b - t) * .08);
        base = normalize([[{ x: l - margin, y: t - margin }, { x: r + margin, y: t - margin }, { x: r + margin, y: b + margin }, { x: l - margin, y: b + margin }]], true);
    }
    if (!base.length)
        throw new Error('No material remains inside the Cut outlines. Check the closed paths.');
    const points = base.flat();
    let x = Infinity, y = Infinity, right = -Infinity, bottom = -Infinity;
    for (const p of points) {
        x = Math.min(x, p.x);
        y = Math.min(y, p.y);
        right = Math.max(right, p.x);
        bottom = Math.max(bottom, p.y);
    }
    const masks = new Map<number, PreviewLoop[]>();
    for (const mark of input.marks) {
        const depth = mark.role === 'vector' ? s.vectorDepth : mark.role === 'raster' ? s.rasterDepth : s.openCutDepth;
        if (depth === 0)
            continue;
        let loops: PreviewLoop[] = [];
        if (mark.filled)
            loops = normalize(mark.contours.filter(c => c.closed && c.points.length >= 3).map(c => c.points), mark.evenOdd);
        else
            for (const contour of mark.contours) {
                if (contour.points.length < 2)
                    continue;
                const p = make([contour.points]);
                let inflated: PreviewLoop[];
                try {
                    inflated = read(engine.InflatePathsD(p, mark.width / 2, engine.JoinType.Round, contour.closed ? engine.EndType.Joined : engine.EndType.Round, 2, 4, .01));
                }
                finally {
                    p.delete();
                }
                loops.push(...inflated);
            }
        const grouped = masks.get(depth) ?? [];
        grouped.push(...loops);
        masks.set(depth, grouped);
    }
    for (const [depth, loops] of masks)
        masks.set(depth, boolean(base, normalize(loops, false), 'intersection'));
    const depths = [...masks.keys()].filter(d => masks.get(d)!.length).sort((a, b) => b - a), maxDepth = depths[0] ?? 0, volumes: MaterialPreviewModel['volumes'] = [];
    if (s.thickness > maxDepth)
        volumes.push({ bottom: 0, top: s.thickness - maxDepth, regions: previewRegions(base) });
    for (let i = 0; i < depths.length; i++) {
        const previous = depths[i], next = depths[i + 1] ?? 0;
        let removed: PreviewLoop[] = [];
        for (const [depth, mask] of masks)
            if (depth > next)
                removed = boolean(removed, mask, 'union');
        const remaining = boolean(base, removed, 'difference');
        if (remaining.length && previous > next)
            volumes.push({ bottom: s.thickness - previous, top: s.thickness - next, regions: previewRegions(remaining) });
    }
    if (!volumes.length)
        throw new Error('No material remains after the process depths. Reduce the engraving depth.');
    // Only exterior horizontal faces: no coincident internal caps in acrylic.
    const contourLoops = (regions: PreviewRegion[]) => regions.flatMap(r => [r.outer, ...r.holes]);
    for (let i = 0; i < volumes.length; i++)
        volumes[i].topRegions = i === volumes.length - 1 ? volumes[i].regions : previewRegions(boolean(contourLoops(volumes[i].regions), contourLoops(volumes[i + 1].regions), 'difference'));
    const regions = previewRegions(base);
    return { volumes, regions, bounds: { x, y, width: right - x, height: bottom - y }, pieces: regions.length, holes: regions.reduce((sum, r) => sum + r.holes.length, 0), stock, openCuts: input.marks.filter(m => m.role === 'cut').reduce((sum, m) => sum + m.contours.length, 0) };
}

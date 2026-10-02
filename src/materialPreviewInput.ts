import { flattenInDocument, pathsOf, validateGeometryInput } from './geometry';
import {MAX_FLATTEN_POINTS} from './processingLimits';
import { documentPath } from './deletion';
import { hasFilledArea, artworkColor } from './shapeStyles';
import { lineWeightMM } from './lineAppearance';
import { exportSVG } from './exportSVG';
import type { Shape } from './types';
import type { MaterialPreviewInput } from './materialPreviewTypes';
/** Read-only snapshot in millimetres. Yield between batches so the modal can paint. */
export async function materialPreviewInput(objects: readonly Shape[]): Promise<MaterialPreviewInput> {
    const input: MaterialPreviewInput = { cuts: [], marks: [], artworkSVG: null };
    let vertices = 0, index = 0;
    const visible = objects.filter(s => s.visible && s.layer.visible && !s.layer.data.deleted && s.opacity > 0 && !s.data.dimension && s.data.role !== 'construction');
    if (visible.length > 10000)
        throw new Error('This drawing is too complex to preview. Hide some layers first.');
    validateGeometryInput(visible);
    const segments=visible.reduce((sum,item)=>sum+pathsOf(item).reduce((n,p)=>n+p.segments.length,0),0);
    if(segments>120000)throw new Error('This drawing has too many curve points to preview.');
    for (const item of visible) {
        if (item.data.role === 'artwork')
            continue;
        const contours = flattenInDocument(item, .03,MAX_FLATTEN_POINTS-vertices);
        vertices += contours.reduce((sum, c) => sum + c.points.length, 0);
        const copies = pathsOf(item).map(documentPath);
        let path: string;
        try {
            path = copies.map(p => p.pathData).join(' ');
        }
        finally {
            copies.forEach(p => p.remove());
        }
        if (item.data.role === 'cutline') {
            input.cuts.push(...contours.filter(c => c.closed && c.points.length >= 3).map(c => c.points));
            const open = contours.filter(c => !c.closed && c.points.length >= 2);
            if (open.length)
                input.marks.push({ contours: open, filled: false, evenOdd: true, width: .15, role: 'cut', path: open.map(c => 'M' + c.points.map(p => `${p.x},${p.y}`).join('L')).join(' ') });
        }
        else
            input.marks.push({ contours, filled: hasFilledArea(item), evenOdd: item.fillRule === 'evenodd', width: Math.max(.01, lineWeightMM(item)), role: item.data.role === 'raster' ? 'raster' : 'vector', path });
        if (++index % 40 === 0)
            await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
    const artwork = visible.filter(s => s.data.role === 'artwork');
    if (artwork.length) {
        try {
            input.artworkSVG = exportSVG(artwork, false, artworkColor());
        }
        catch {
            input.artworkSVG = null;
        }
    }
    return input;
}

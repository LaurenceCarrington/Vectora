import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { MaterialPreviewInput, MaterialPreviewModel, ProcessSettings } from './materialPreviewTypes';
export const PREVIEW_MATERIALS = [
    { id: 'wood', name: 'Birch plywood', base: '#c9a775', edge: '#5d3b22', mark: '#684529', roughness: .85, metalness: 0, grain: true },
    { id: 'mdf', name: 'MDF', base: '#b39266', edge: '#62482e', mark: '#604228', roughness: .95, metalness: 0, grain: false },
    { id: 'acrylic', name: 'Clear acrylic', base: '#b6dbe1', edge: '#84b6c2', mark: '#edf6f8', roughness: .1, metalness: 0, grain: false },
    { id: 'frosted', name: 'Frosted acrylic', base: '#b7d1d4', edge: '#90b5ba', mark: '#ffffff', roughness: .65, metalness: 0, grain: false },
    { id: 'aluminium', name: 'Brushed aluminium', base: '#b5bec7', edge: '#757f89', mark: '#505d65', roughness: .45, metalness: .8, grain: false },
    { id: 'leather', name: 'Natural leather', base: '#aa7248', edge: '#593920', mark: '#4b3022', roughness: .95, metalness: 0, grain: false },
] as const;
export function disposePreview(root: THREE.Object3D): void { const geometry = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>(); root.traverse(object => { const mesh = object as THREE.Mesh; if (mesh.geometry)
    geometry.add(mesh.geometry); if (mesh.material)
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        materials.add(material);
        for (const value of Object.values(material))
            if (value instanceof THREE.Texture)
                textures.add(value);
    } }); geometry.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); textures.forEach(t => t.dispose()); root.clear(); }
export async function previewAssembly(input: MaterialPreviewInput, model: MaterialPreviewModel, settings: ProcessSettings, materialId: string, overlay: boolean): Promise<THREE.Group> {
    const material = PREVIEW_MATERIALS.find(m => m.id === materialId) ?? PREVIEW_MATERIALS[0], b = model.bounds, canvas = document.createElement('canvas');
    canvas.width = Math.max(16, Math.round(1024 * b.width / Math.max(b.width, b.height)));
    canvas.height = Math.max(16, Math.round(1024 * b.height / Math.max(b.width, b.height)));
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = material.base;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    let seed = 17;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    if (material.grain)
        for (let i = 0; i < 200; i++) {
            const y = random() * canvas.height;
            ctx.strokeStyle = i % 3 ? '#72451b14' : '#fff4dc25';
            ctx.lineWidth = .5 + random();
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.bezierCurveTo(canvas.width * .3, y + random() * 10, canvas.width * .7, y - random() * 10, canvas.width, y + random() * 4);
            ctx.stroke();
        }
    if (material.id === 'aluminium')
        for (let y = 0; y < canvas.height; y++) {
            ctx.fillStyle = `rgba(255,255,255,${random() * .1})`;
            ctx.fillRect(0, y, canvas.width, 1);
        }
    const backCanvas = document.createElement('canvas');
    backCanvas.width = canvas.width;
    backCanvas.height = canvas.height;
    backCanvas.getContext('2d')!.drawImage(canvas, 0, 0);
    ctx.save();
    ctx.scale(canvas.width / b.width, canvas.height / b.height);
    ctx.translate(-b.x, -b.y);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const mark of input.marks) {
        const depth = mark.role === 'vector' ? settings.vectorDepth : mark.role === 'raster' ? settings.rasterDepth : settings.openCutDepth;
        if (depth === 0)
            continue;
        ctx.fillStyle = ctx.strokeStyle = material.mark;
        ctx.lineWidth = mark.width;
        const path = new Path2D(mark.path);
        if (mark.filled)
            ctx.fill(path, mark.evenOdd ? 'evenodd' : 'nonzero');
        else
            ctx.stroke(path);
    }
    ctx.restore();
    if (overlay && input.artworkSVG) {
        const svg = new DOMParser().parseFromString(input.artworkSVG, 'image/svg+xml').documentElement;
        svg.setAttribute('viewBox', `${b.x} ${b.y} ${b.width} ${b.height}`);
        svg.setAttribute('width', String(canvas.width));
        svg.setAttribute('height', String(canvas.height));
        const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' }));
        try {
            const image = new Image();
            await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('Could not render Artwork colours.')); image.src = url; });
            ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        }
        finally {
            URL.revokeObjectURL(url);
        }
    }
    const texture = (source: HTMLCanvasElement) => { const t = new THREE.CanvasTexture(source); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 2; return t; };
    const acrylic = material.id === 'acrylic' || material.id === 'frosted', shared = { roughness: material.roughness, metalness: material.metalness, transmission: acrylic ? (material.id === 'acrylic' ? .65 : .25) : 0, thickness: settings.thickness, ior: 1.49 };
    const top = new THREE.MeshPhysicalMaterial({ ...shared, map: texture(canvas) }), back = new THREE.MeshPhysicalMaterial({ ...shared, map: texture(backCanvas) }), edge = new THREE.MeshPhysicalMaterial({ ...shared, color: material.edge });
    const root = new THREE.Group();
    root.rotation.x = -Math.PI / 2;
    let count = 0;
    const geometries: THREE.BufferGeometry[] = [];
    const shapeOf = (region: MaterialPreviewModel['regions'][number]) => {
        const points = (p: typeof region.outer) => p.map(v => new THREE.Vector2(v.x - b.x - b.width / 2, -(v.y - b.y - b.height / 2))), shape = new THREE.Shape(points(region.outer));
        shape.holes = region.holes.map(h => new THREE.Path(points(h)));
        return shape;
    };
    const retain = (geometry: THREE.BufferGeometry) => {
        count += geometry.getAttribute('position').count;
        if (count > 1500000) {
            geometry.dispose();
            throw new Error('The 3D mesh is too complex. Hide some layers before previewing.');
        }
        const pos = geometry.getAttribute('position'), uv = geometry.getAttribute('uv');
        for (let i = 0; i < pos.count; i++)
            uv.setXY(i, (pos.getX(i) + b.width / 2) / b.width, (pos.getY(i) + b.height / 2) / b.height);
        geometries.push(geometry);
    };
    try {
        for (const volume of model.volumes) {
            for (const region of volume.regions) {
                const geometry = new THREE.ExtrudeGeometry(shapeOf(region), { depth: volume.top - volume.bottom, bevelEnabled: false, steps: 1 });
                geometry.translate(0, 0, volume.bottom);
                const normal = geometry.getAttribute('normal'), indices: number[] = [];
                for (let i = 0; i < normal.count; i += 3)
                    if (Math.abs(normal.getZ(i)) < .5)
                        indices.push(i, i + 1, i + 2);
                geometry.setIndex(indices);
                geometry.clearGroups();
                retain(geometry);
                if (volume.bottom === 0) {
                    const bottom = new THREE.ShapeGeometry(shapeOf(region));
                    bottom.scale(1, 1, -1);
                    bottom.setIndex(Array.from(bottom.index!.array).reverse());
                    retain(bottom);
                }
            }
            for (const region of volume.topRegions ?? volume.regions) {
                const cap = new THREE.ShapeGeometry(shapeOf(region));
                cap.translate(0, 0, volume.top);
                retain(cap);
            }
        }
        // Batch every piece and depth into three draw groups instead of thousands of meshes.
        const merged = mergeGeometries(geometries, false);
        if (!merged)
            throw new Error('Could not combine the preview surfaces.');
        const normal = merged.getAttribute('normal'), source = merged.index!, buckets: number[][] = [[], [], []];
        for (let i = 0; i < source.count; i += 3) {
            const a = source.getX(i), nz = normal.getZ(a), bucket = nz > .5 ? 0 : nz < -.5 ? 1 : 2;
            buckets[bucket].push(a, source.getX(i + 1), source.getX(i + 2));
        }
        const indices = new Uint32Array(source.count);
        merged.clearGroups();
        let start = 0;
        buckets.forEach((bucket, index) => { indices.set(bucket, start); if (bucket.length)
            merged.addGroup(start, bucket.length, index); start += bucket.length; });
        merged.setIndex(new THREE.BufferAttribute(indices, 1));
        root.add(new THREE.Mesh(merged, [top, back, edge]));
        return root;
    }
    catch (error) {
        disposePreview(root);
        top.dispose();
        back.dispose();
        edge.dispose();
        top.map?.dispose();
        back.map?.dispose();
        throw error;
    }
    finally {
        geometries.forEach(g => g.dispose());
    }
}

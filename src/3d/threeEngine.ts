import { createRasterSurfaceMesh } from "./rasterSurface";
import { createPocketedContourMesh } from "./pocketMesh";
import { buildPocketHierarchy } from "../cam/pocketingEngine";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { OBJExporter } from "three/examples/jsm/exporters/OBJExporter.js";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";
import type {
  BoundingBox,
  CadDocument,
  DocumentUnits,
  Entity,
  Point2D,
  PreviewMaterialKind,
} from "../document/types";
import { entityToClosedPath, entityToPath } from "../geometry/operations/pathConversion";
import {
  buildContourHierarchy,
  signedPolygonArea,
  type ContourHierarchyNode,
} from "../geometry/topology";
import { getBoxPanelTransform, identifyBoxAssemblies, type BoxAssembly } from "./boxFolder";
import { mmPerUnit } from "../cam/physicalUnits";
import type { PixelPhysicalScale } from "../cam/gcodeCompiler";
import { vectoraRenderColors, vectoraRenderOpacity } from "../design/vectoraRenderColors";

export interface ThreePreviewOptions {
  readonly material: PreviewMaterialKind;
  readonly thicknessMm: number;
  readonly explodedFactor: number;
  readonly physicalScale?: PixelPhysicalScale;
  readonly pocketDepthMm?: number;
  readonly pocketToolDiameterMm?: number;
}

export interface ThreePreviewStats {
  readonly closedProfiles: number;
  readonly surfaceFeatures: number;
  readonly openCutPaths: number;
  readonly assemblies: number;
  readonly triangles: number;
}

export interface ThreePreviewEntityGroups {
  readonly cut: readonly Entity[];
  readonly engrave: readonly Entity[];
  readonly score: readonly Entity[];
  readonly pocket: readonly Entity[];
  readonly raster: readonly Entity[];
}

interface AssemblyBinding {
  readonly assembly: BoxAssembly;
  readonly panelGroups: ReadonlyMap<string, THREE.Group>;
  readonly offsetX: number;
  readonly unitScale: number;
}

const DEFAULT_OPTIONS: ThreePreviewOptions = Object.freeze({
  material: "wood",
  thicknessMm: 3,
  explodedFactor: 0,
});

export function documentUnitToMillimetres(units: DocumentUnits, physicalScale?: PixelPhysicalScale): number {
  return mmPerUnit(units, physicalScale);
}

function appendContour(
  target: THREE.Shape | THREE.Path,
  points: readonly { readonly x: number; readonly y: number }[],
  unitScale: number,
  origin: { readonly x: number; readonly y: number },
  clockwise: boolean,
): void {
  const isClockwise = signedPolygonArea(points) < 0;
  const ordered = isClockwise === clockwise ? points : [...points].reverse();
  const first = ordered[0]!;
  target.moveTo((first.x - origin.x) * unitScale, (first.y - origin.y) * unitScale);
  for (let index = 1; index < ordered.length; index += 1) {
    const point = ordered[index]!;
    target.lineTo((point.x - origin.x) * unitScale, (point.y - origin.y) * unitScale);
  }
  target.closePath();
}

export function entityToThreeShape(
  entity: Entity,
  unitScale = 1,
  origin: { readonly x: number; readonly y: number } = { x: 0, y: 0 },
): THREE.Shape | null {
  const points = entityToClosedPath(entity, { tolerance: 0.05, maximumSegments: 2_048 });
  if (!points || points.length < 3 || Math.abs(signedPolygonArea(points)) < 1e-10) return null;
  const shape = new THREE.Shape();
  appendContour(shape, points, unitScale, origin, true);
  return shape;
}

/** Converts one even-depth topology boundary and its direct holes to a compound Three.js shape. */
export function contourNodeToThreeShape(
  node: ContourHierarchyNode,
  unitScale = 1,
  origin: { readonly x: number; readonly y: number } = { x: 0, y: 0 },
): THREE.Shape {
  if (node.kind !== "outer") {
    throw new TypeError(`Contour "${node.entityId}" is a hole and cannot be extruded independently.`);
  }
  const shape = new THREE.Shape();
  // ExtrudeGeometry expects a clockwise shell and counter-clockwise holes.
  appendContour(shape, node.path, unitScale, origin, true);
  for (const holeNode of node.holes) {
    const hole = new THREE.Path();
    appendContour(hole, holeNode.path, unitScale, origin, false);
    shape.holes.push(hole);
  }
  return shape;
}

function grainTexture(): THREE.DataTexture {
  const size = 256;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = (y * size + x) * 4;
      const wave = Math.sin(y * 0.16 + Math.sin(x * 0.035) * 3.2) * 9;
      const fine = Math.sin(y * 0.73 + x * 0.021) * 3;
      const noise = (((x * 17 + y * 31 + x * y * 7) % 23) - 11) * 0.34;
      data[index] = Math.round(216 + wave + fine + noise);
      data[index + 1] = Math.round(183 + wave * 0.76 + fine + noise);
      data[index + 2] = Math.round(132 + wave * 0.46 + fine + noise);
      data[index + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2.5, 2.5);
  texture.needsUpdate = true;
  return texture;
}

function createMaterials(kind: PreviewMaterialKind): THREE.Material[] {
  if (kind === "wood") {
    const map = grainTexture();
    return [
      new THREE.MeshStandardMaterial({ color: vectoraRenderColors.material.woodFace, map, roughness: 0.68, metalness: 0 }),
      new THREE.MeshStandardMaterial({ color: vectoraRenderColors.material.woodEdge, roughness: 0.82, metalness: 0 }),
    ];
  }
  if (kind === "clear-acrylic" || kind === "dark-acrylic") {
    const dark = kind === "dark-acrylic";
    const color = dark ? vectoraRenderColors.material.darkAcrylicFace : vectoraRenderColors.material.clearAcrylicFace;
    return [
      new THREE.MeshPhysicalMaterial({
        color,
        roughness: 0.08,
        metalness: 0,
        transmission: dark ? 0.52 : 0.88,
        transparent: true,
        opacity: dark ? vectoraRenderOpacity.darkAcrylicFace : vectoraRenderOpacity.acrylicFace,
        thickness: 2,
        ior: 1.49,
        side: THREE.DoubleSide,
      }),
      new THREE.MeshPhysicalMaterial({
        color: dark ? vectoraRenderColors.material.darkAcrylicEdge : vectoraRenderColors.material.clearAcrylicEdge,
        roughness: 0.16,
        transmission: dark ? 0.28 : 0.65,
        transparent: true,
        opacity: dark ? vectoraRenderOpacity.darkAcrylicEdge : vectoraRenderOpacity.acrylicEdge,
        side: THREE.DoubleSide,
      }),
    ];
  }
  if (kind === "aluminum") {
    return [
      new THREE.MeshStandardMaterial({ color: vectoraRenderColors.material.aluminumFace, roughness: 0.28, metalness: 0.9 }),
      new THREE.MeshStandardMaterial({ color: vectoraRenderColors.material.aluminumEdge, roughness: 0.36, metalness: 0.84 }),
    ];
  }
  return [
    new THREE.MeshStandardMaterial({ color: vectoraRenderColors.material.cardboardFace, roughness: 0.92, metalness: 0 }),
    new THREE.MeshStandardMaterial({ color: vectoraRenderColors.material.cardboardEdge, roughness: 0.96, metalness: 0 }),
  ];
}

/** Dark surface material shared by shallow engravings and score tubes. */
export function createBurnedMaterial(kind: PreviewMaterialKind): THREE.MeshStandardMaterial {
  const color = kind === "wood" || kind === "cardboard"
    ? vectoraRenderColors.material.burnedWood
    : kind === "aluminum"
      ? vectoraRenderColors.material.burnedMetal
      : vectoraRenderColors.material.burnedAcrylic;
  return new THREE.MeshStandardMaterial({
    name: `vectora-burned-${kind}`,
    color,
    roughness: kind === "aluminum" ? 0.24 : 0.34,
    metalness: kind === "aluminum" ? 0.48 : 0.04,
    side: THREE.DoubleSide,
  });
}

/** High-contrast material reserved for invalid open cut diagnostics. */
export function createOpenCutWarningMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    name: "vectora-open-cut-warning",
    color: vectoraRenderColors.preview.openCut,
    emissive: vectoraRenderColors.preview.openCutEmissive,
    emissiveIntensity: 0.62,
    roughness: 0.28,
    metalness: 0.02,
    side: THREE.DoubleSide,
  });
}

export function createExtrudedEntityMesh(
  entity: Entity,
  thicknessMm: number,
  materials: THREE.Material[],
  unitScale = 1,
): THREE.Mesh | null {
  if (!Number.isFinite(thicknessMm) || thicknessMm <= 0) {
    throw new RangeError("Preview thickness must be greater than zero.");
  }
  const center = {
    x: (entity.bbox.minX + entity.bbox.maxX) / 2,
    y: (entity.bbox.minY + entity.bbox.maxY) / 2,
  };
  const shape = entityToThreeShape(entity, unitScale, center);
  if (!shape) return null;
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: thicknessMm,
    bevelEnabled: false,
    curveSegments: 16,
    steps: 1,
  });
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, materials);
  mesh.name = entity.id;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.entityId = entity.id;
  return mesh;
}

export function createExtrudedContourMesh(
  node: ContourHierarchyNode,
  thicknessMm: number,
  materials: THREE.Material[],
  unitScale = 1,
): THREE.Mesh {
  if (!Number.isFinite(thicknessMm) || thicknessMm <= 0) {
    throw new RangeError("Preview thickness must be greater than zero.");
  }
  const center = {
    x: (node.bbox.minX + node.bbox.maxX) / 2,
    y: (node.bbox.minY + node.bbox.maxY) / 2,
  };
  const shape = contourNodeToThreeShape(node, unitScale, center);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: thicknessMm,
    bevelEnabled: false,
    curveSegments: 16,
    steps: 1,
  });
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, materials);
  mesh.name = node.entityId;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.entityId = node.entityId;
  mesh.userData.holeEntityIds = node.holes.map((hole) => hole.entityId);
  return mesh;
}

const ENGRAVE_DEPTH_MM = 0.1;
const ENGRAVE_SURFACE_OFFSET_MM = 0.01;
const SCORE_TUBE_RADIUS_MM = 0.15;
const SCORE_SURFACE_OFFSET_MM = 0.05;
const PATH_EPSILON = 1e-8;

/** Builds a thin, closed marking that sits just above the material top face. */
export function createSurfaceEngravingMesh(
  entity: Entity,
  materialThicknessMm: number,
  material: THREE.Material,
  unitScale = 1,
  origin: Point2D = { x: 0, y: 0 },
): THREE.Mesh | null {
  if (!Number.isFinite(materialThicknessMm) || materialThicknessMm <= 0) {
    throw new RangeError("Preview thickness must be greater than zero.");
  }
  const shape = entityToThreeShape(entity, unitScale, origin);
  if (!shape) return null;
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: ENGRAVE_DEPTH_MM,
    bevelEnabled: false,
    curveSegments: 12,
    steps: 1,
  });
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = `engrave:${entity.id}`;
  mesh.position.z = materialThicknessMm + ENGRAVE_SURFACE_OFFSET_MM;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.userData.entityId = entity.id;
  mesh.userData.intent = entity.intent;
  mesh.userData.surfaceGeometry = "engrave";
  return mesh;
}

function pathVectors(
  points: readonly Point2D[],
  unitScale: number,
  origin: Point2D,
): THREE.Vector3[] {
  const vectors: THREE.Vector3[] = [];
  for (const point of points) {
    const vector = new THREE.Vector3(
      (point.x - origin.x) * unitScale,
      (point.y - origin.y) * unitScale,
      0,
    );
    const previous = vectors.at(-1);
    if (previous && previous.distanceToSquared(vector) <= PATH_EPSILON * PATH_EPSILON) continue;
    vectors.push(vector);
  }
  if (vectors.length > 2 && vectors[0]!.distanceToSquared(vectors.at(-1)!) <= PATH_EPSILON * PATH_EPSILON) {
    vectors.pop();
  }
  return vectors;
}

/** Converts open engraves or score geometry into an exact piecewise-linear 3D tube. */
export function createSurfacePathMesh(
  entity: Entity,
  materialThicknessMm: number,
  material: THREE.Material,
  unitScale = 1,
  origin: Point2D = { x: 0, y: 0 },
): THREE.Mesh | null {
  if (!Number.isFinite(materialThicknessMm) || materialThicknessMm <= 0) {
    throw new RangeError("Preview thickness must be greater than zero.");
  }
  const converted = entityToPath(entity, { tolerance: 0.05, maximumSegments: 2_048 });
  if (!converted) return null;
  const vectors = pathVectors(converted.points, unitScale, origin);
  if (vectors.length < 2) return null;
  const curve = new THREE.CurvePath<THREE.Vector3>();
  let lengthMm = 0;
  for (let index = 1; index < vectors.length; index += 1) {
    const start = vectors[index - 1]!;
    const end = vectors[index]!;
    lengthMm += start.distanceTo(end);
    curve.add(new THREE.LineCurve3(start, end));
  }
  if (converted.closed) {
    const start = vectors.at(-1)!;
    const end = vectors[0]!;
    lengthMm += start.distanceTo(end);
    curve.add(new THREE.LineCurve3(start, end));
  }
  if (lengthMm <= PATH_EPSILON || curve.curves.length === 0) return null;
  const tubularSegments = Math.min(
    4_096,
    Math.max(curve.curves.length * 2, Math.ceil(lengthMm / 0.75)),
  );
  const geometry = new THREE.TubeGeometry(
    curve,
    tubularSegments,
    SCORE_TUBE_RADIUS_MM,
    8,
    false,
  );
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = `score:${entity.id}`;
  mesh.position.z = materialThicknessMm + SCORE_SURFACE_OFFSET_MM;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.userData.entityId = entity.id;
  mesh.userData.intent = entity.intent;
  mesh.userData.surfaceGeometry = "tube";
  mesh.userData.closed = converted.closed;
  return mesh;
}

/** Renders an invalid open cut using the same precise path tessellation as score lines. */
export function createOpenCutDiagnosticMesh(
  entity: Entity,
  materialThicknessMm: number,
  material: THREE.Material,
  unitScale = 1,
  origin: Point2D = { x: 0, y: 0 },
): THREE.Mesh | null {
  const mesh = createSurfacePathMesh(entity, materialThicknessMm, material, unitScale, origin);
  if (!mesh) return null;
  mesh.name = `open-cut-warning:${entity.id}`;
  mesh.userData.surfaceGeometry = "open-cut-diagnostic";
  mesh.userData.warning = "open-cut";
  return mesh;
}

function boundsContain(outer: BoundingBox, inner: BoundingBox): boolean {
  const epsilon = 1e-7;
  return outer.minX <= inner.minX + epsilon &&
    outer.minY <= inner.minY + epsilon &&
    outer.maxX >= inner.maxX - epsilon &&
    outer.maxY >= inner.maxY - epsilon;
}

function boundsArea(bounds: BoundingBox): number {
  return Math.max(0, bounds.maxX - bounds.minX) * Math.max(0, bounds.maxY - bounds.minY);
}

/** Chooses the smallest cut boundary whose world-space bounds contain the mark. */
export function findParentCutBoundary(
  entity: Entity,
  boundaries: readonly ContourHierarchyNode[],
): ContourHierarchyNode | null {
  let match: ContourHierarchyNode | null = null;
  let matchArea = Number.POSITIVE_INFINITY;
  for (const boundary of boundaries) {
    if (!boundsContain(boundary.bbox, entity.bbox)) continue;
    const area = boundsArea(boundary.bbox);
    if (area < matchArea) {
      match = boundary;
      matchArea = area;
    }
  }
  return match;
}

/** Partitions renderable preview geometry in one pass; construction geometry is intentionally discarded. */
export function groupPreviewEntities(entities: readonly Entity[]): ThreePreviewEntityGroups {
  const cut: Entity[] = [];
  const engrave: Entity[] = [];
  const score: Entity[] = [];
  const pocket: Entity[] = [];
  const raster: Entity[] = [];
  for (const entity of entities) {
    switch (entity.intent) {
      case "cut": cut.push(entity); break;
      case "engrave": engrave.push(entity); break;
      case "score": score.push(entity); break;
      case "pocket": pocket.push(entity); break;
      case "raster": raster.push(entity); break;
      case "construction": break;
    }
  }
  return Object.freeze({
    cut: Object.freeze(cut),
    engrave: Object.freeze(engrave),
    score: Object.freeze(score),
    pocket: Object.freeze(pocket),
    raster: Object.freeze(raster),
  });
}

function triangleCount(mesh: THREE.Mesh): number {
  const index = mesh.geometry.getIndex();
  if (index) return Math.floor(index.count / 3);
  const position = mesh.geometry.getAttribute("position");
  return position ? Math.floor(position.count / 3) : 0;
}

function disposeObject(root: THREE.Object3D): void {
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.dispose();
    const candidates = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of candidates) {
      materials.add(material);
      const map = (material as THREE.MeshStandardMaterial).map;
      if (map) textures.add(map);
    }
  });
  for (const texture of textures) texture.dispose();
  for (const material of materials) material.dispose();
}

export class ThreePreviewEngine {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100_000);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly controls: OrbitControls;
  private readonly resizeObserver: ResizeObserver;
  private readonly grid: THREE.GridHelper;
  private modelRoot = new THREE.Group();
  private assemblyBindings: readonly AssemblyBinding[] = [];
  private animationFrame: number | null = null;
  private explodedFactor = 0;
  private stats: ThreePreviewStats = Object.freeze({
    closedProfiles: 0,
    surfaceFeatures: 0,
    openCutPaths: 0,
    assemblies: 0,
    triangles: 0,
  });

  constructor(private readonly container: HTMLElement) {
    this.scene.background = new THREE.Color(vectoraRenderColors.preview.background);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.className = "three-preview-canvas";
    this.container.appendChild(this.renderer.domElement);

    this.camera.position.set(150, 120, 180);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.07;
    this.controls.screenSpacePanning = true;
    this.controls.minDistance = 5;
    this.controls.maxDistance = 20_000;

    this.scene.add(new THREE.HemisphereLight(0xffffff, vectoraRenderColors.preview.hemisphereGround, 2.2));
    const key = new THREE.DirectionalLight(0xffffff, 3.2);
    key.position.set(180, 260, 220);
    key.castShadow = true;
    key.shadow.mapSize.set(1_024, 1_024);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(vectoraRenderColors.preview.fillLight, 1.25);
    fill.position.set(-180, 80, -140);
    this.scene.add(fill);

    this.grid = new THREE.GridHelper(2_000, 80, vectoraRenderColors.preview.gridMajor, vectoraRenderColors.preview.gridMinor);
    this.grid.position.y = -0.2;
    (this.grid.material as THREE.Material).transparent = true;
    (this.grid.material as THREE.Material).opacity = vectoraRenderOpacity.previewGrid;
    this.scene.add(this.grid);
    this.scene.add(this.modelRoot);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.tick();
  }

  setDocument(document: Readonly<CadDocument>, options: ThreePreviewOptions = DEFAULT_OPTIONS): ThreePreviewStats {
    if (!Number.isFinite(options.thicknessMm) || options.thicknessMm <= 0) {
      throw new RangeError("Material thickness must be greater than zero.");
    }
    this.scene.remove(this.modelRoot);
    disposeObject(this.modelRoot);
    this.modelRoot = new THREE.Group();
    this.scene.add(this.modelRoot);
    this.explodedFactor = Math.min(1, Math.max(0, options.explodedFactor));

    const layers = new Map(document.layers.map((layer) => [layer.id, layer]));
    const visibleEntities = [...document.entities.values()].filter(
      (entity) => entity.visible && layers.get(entity.layerId)?.visible,
    );
    const grouped = groupPreviewEntities(visibleEntities);
    const closedCutEntities: Entity[] = [];
    const openCutEntities: Entity[] = [];
    for (const entity of grouped.cut) {
      if (entityToClosedPath(entity, { tolerance: 0.05, maximumSegments: 2_048 })) {
        closedCutEntities.push(entity);
      } else if (entityToPath(entity, { tolerance: 0.05, maximumSegments: 2_048 })) {
        openCutEntities.push(entity);
      }
    }
    // Only cut contours define physical material or void topology. Engraving
    // contours must never accidentally punch holes through the base mesh.
    const hierarchy = buildContourHierarchy(closedCutEntities, { tolerance: 0.05, maximumSegments: 2_048 });
    const unitScale = documentUnitToMillimetres(document.units, options.physicalScale);
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const entity of [...grouped.cut, ...grouped.engrave, ...grouped.score, ...grouped.pocket, ...grouped.raster]) {
      minX = Math.min(minX, entity.bbox.minX);
      minY = Math.min(minY, entity.bbox.minY);
      maxX = Math.max(maxX, entity.bbox.maxX);
      maxY = Math.max(maxY, entity.bbox.maxY);
    }
    const hasRenderableBounds = Number.isFinite(minX) && Number.isFinite(minY) &&
      Number.isFinite(maxX) && Number.isFinite(maxY);
    const centerX = hasRenderableBounds ? (minX + maxX) / 2 : 0;
    const centerY = hasRenderableBounds ? (minY + maxY) / 2 : 0;
    const materials = createMaterials(options.material);
    const burnedMaterial = createBurnedMaterial(options.material);
    const openCutWarningMaterial = createOpenCutWarningMaterial();
    let burnedMaterialUsed = false;
    const panelGroups = new Map<string, THREE.Group>();
    let triangles = 0;
    let surfaceFeatures = 0;
    let openCutDiagnostics = 0;

    const pockets = buildPocketHierarchy([...grouped.pocket, ...grouped.cut]);
    const previewBoundaries = [...hierarchy.solidBoundaries];
    const pocketsByStock = new Map<string, ContourHierarchyNode[]>();
    for (const root of pockets.roots) {
      let owner = findParentCutBoundary(root.entity, hierarchy.solidBoundaries);
      if (!owner) {
        // A standalone pocket needs a stock reference in the preview. Use an
        // explicitly marked blank with one cutter diameter of surrounding stock.
        const margin = (options.pocketToolDiameterMm ?? 3) / unitScale;
        const bbox = { minX: root.bbox.minX - margin, minY: root.bbox.minY - margin,
          maxX: root.bbox.maxX + margin, maxY: root.bbox.maxY + margin };
        const blank: Entity = { ...root.entity, id: `pocket-stock:${root.entityId}`, type: "rectangle", intent: "cut", bbox,
          origin: { x: bbox.minX, y: bbox.minY }, width: bbox.maxX - bbox.minX, height: bbox.maxY - bbox.minY, cornerRadius: 0 };
        owner = buildContourHierarchy([blank]).roots[0]!;
        previewBoundaries.push(owner);
      }
      const descendants = pockets.nodes.filter((node) => {
        let current: ContourHierarchyNode | undefined = node;
        while (current) {
          if (current.entityId === root.entityId) return true;
          current = current.parentId ? pockets.byEntityId.get(current.parentId) : undefined;
        }
        return false;
      });
      pocketsByStock.set(owner.entityId, [...(pocketsByStock.get(owner.entityId) ?? []), ...descendants]);
    }
    for (const node of previewBoundaries) {
      const pocketContours = pocketsByStock.get(node.entityId) ?? [];
      const mesh = pocketContours.length
        ? createPocketedContourMesh(node, pocketContours, options.thicknessMm, options.pocketDepthMm ?? 1, materials, unitScale)
        : createExtrudedContourMesh(node, options.thicknessMm, materials, unitScale);
      mesh.userData.inferredStock = node.entityId.startsWith("pocket-stock:");
      surfaceFeatures += pocketContours.filter((contour) => contour.depth % 2 === 0).length;
      const entityCenterX = (node.bbox.minX + node.bbox.maxX) / 2;
      const entityCenterY = (node.bbox.minY + node.bbox.maxY) / 2;
      const panelGroup = new THREE.Group();
      panelGroup.name = `cut-panel:${node.entityId}`;
      panelGroup.position.set(
        (entityCenterX - centerX) * unitScale,
        (entityCenterY - centerY) * unitScale,
        0,
      );
      panelGroup.userData.entityId = node.entityId;
      panelGroup.userData.intent = "cut";
      panelGroup.add(mesh);
      panelGroups.set(node.entityId, panelGroup);
      this.modelRoot.add(panelGroup);
      triangles += triangleCount(mesh);
    }

    const unboundSurfaceGroup = new THREE.Group();
    unboundSurfaceGroup.name = "unbound-surface-features";
    const addSurfaceFeature = (entity: Entity, renderAsClosedEngraving: boolean): void => {
      const parentBoundary = findParentCutBoundary(entity, hierarchy.solidBoundaries);
      const parentGroup = parentBoundary ? panelGroups.get(parentBoundary.entityId) : undefined;
      const origin = parentBoundary
        ? {
            x: (parentBoundary.bbox.minX + parentBoundary.bbox.maxX) / 2,
            y: (parentBoundary.bbox.minY + parentBoundary.bbox.maxY) / 2,
          }
        : { x: centerX, y: centerY };
      const mesh = renderAsClosedEngraving
        ? createSurfaceEngravingMesh(
            entity,
            options.thicknessMm,
            burnedMaterial,
            unitScale,
            origin,
          )
        : createSurfacePathMesh(
            entity,
            options.thicknessMm,
            burnedMaterial,
            unitScale,
            origin,
          );
      if (!mesh) return;
      burnedMaterialUsed = true;
      (parentGroup ?? unboundSurfaceGroup).add(mesh);
      surfaceFeatures += 1;
      triangles += triangleCount(mesh);
    };

    for (const entity of grouped.raster) {
      if (entity.type !== "image") continue;
      const parent = findParentCutBoundary(entity, hierarchy.solidBoundaries);
      const parentGroup = parent ? panelGroups.get(parent.entityId) : undefined;
      const origin = parent ? { x: (parent.bbox.minX + parent.bbox.maxX) / 2, y: (parent.bbox.minY + parent.bbox.maxY) / 2 } : { x: centerX, y: centerY };
      const mesh = createRasterSurfaceMesh(entity, options.thicknessMm, unitScale, origin, Boolean(parentGroup));
      (parentGroup ?? unboundSurfaceGroup).add(mesh);
      surfaceFeatures += 1; triangles += triangleCount(mesh);
    }
    for (const entity of grouped.engrave) {
      addSurfaceFeature(entity, entityToClosedPath(entity, {
        tolerance: 0.05,
        maximumSegments: 2_048,
      }) !== null);
    }
    // Score contours are deliberately rendered as narrow tubes even when they
    // are closed; they describe surface marks, never shallow filled regions.
    for (const entity of grouped.score) addSurfaceFeature(entity, false);

    const addOpenCutDiagnostic = (entity: Entity): void => {
      const parentBoundary = findParentCutBoundary(entity, hierarchy.solidBoundaries);
      const parentGroup = parentBoundary ? panelGroups.get(parentBoundary.entityId) : undefined;
      const origin = parentBoundary
        ? {
            x: (parentBoundary.bbox.minX + parentBoundary.bbox.maxX) / 2,
            y: (parentBoundary.bbox.minY + parentBoundary.bbox.maxY) / 2,
          }
        : { x: centerX, y: centerY };
      const mesh = createOpenCutDiagnosticMesh(
        entity,
        options.thicknessMm,
        openCutWarningMaterial,
        unitScale,
        origin,
      );
      if (!mesh) return;
      (parentGroup ?? unboundSurfaceGroup).add(mesh);
      openCutDiagnostics += 1;
      triangles += triangleCount(mesh);
    };
    for (const entity of openCutEntities) addOpenCutDiagnostic(entity);
    if (unboundSurfaceGroup.children.length > 0) this.modelRoot.add(unboundSurfaceGroup);

    if (panelGroups.size === 0) {
      for (const material of materials) {
        const map = (material as THREE.MeshStandardMaterial).map;
        map?.dispose();
        material.dispose();
      }
    }
    if (!burnedMaterialUsed) burnedMaterial.dispose();
    if (openCutDiagnostics === 0) openCutWarningMaterial.dispose();

    // Only physical cut panels can participate in folding. Each binding points
    // at the whole group so its engraves and score tubes inherit the transform.
    const assemblies = identifyBoxAssemblies(grouped.cut);
    this.assemblyBindings = assemblies.map((assembly, index) => ({
      assembly,
      panelGroups,
      offsetX: (index - (assemblies.length - 1) / 2) * assembly.dimensions.width * unitScale * 1.65,
      unitScale,
    }));
    this.applyExplodedTransforms();
    this.stats = Object.freeze({
      closedProfiles: hierarchy.nodes.length,
      surfaceFeatures,
      openCutPaths: openCutEntities.length,
      assemblies: assemblies.length,
      triangles,
    });
    this.fitCamera();
    return this.stats;
  }

  setExplodedFactor(value: number): void {
    this.explodedFactor = Math.min(1, Math.max(0, value));
    this.applyExplodedTransforms();
  }

  setAutoRotate(enabled: boolean): void {
    this.controls.autoRotate = enabled;
    this.controls.autoRotateSpeed = 1.1;
  }

  getStats(): ThreePreviewStats {
    return this.stats;
  }

  exportModel(format: "stl" | "obj"): Blob {
    if (this.stats.triangles === 0) throw new Error("There is no 3D geometry to export.");
    this.modelRoot.updateMatrixWorld(true);
    if (format === "obj") {
      return new Blob([new OBJExporter().parse(this.modelRoot)], { type: "text/plain;charset=utf-8" });
    }
    const data = new STLExporter().parse(this.modelRoot, { binary: true });
    return new Blob([data], { type: "model/stl" });
  }

  dispose(): void {
    if (this.animationFrame !== null) cancelAnimationFrame(this.animationFrame);
    this.animationFrame = null;
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.scene.remove(this.modelRoot);
    disposeObject(this.modelRoot);
    this.grid.geometry.dispose();
    const gridMaterials = Array.isArray(this.grid.material) ? this.grid.material : [this.grid.material];
    for (const material of gridMaterials) material.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }

  private applyExplodedTransforms(): void {
    for (const binding of this.assemblyBindings) {
      const dimensions = {
        width: binding.assembly.dimensions.width * binding.unitScale,
        depth: binding.assembly.dimensions.depth * binding.unitScale,
        height: binding.assembly.dimensions.height * binding.unitScale,
      };
      for (const [panelName, entity] of binding.assembly.panels) {
        const panelGroup = binding.panelGroups.get(entity.id);
        if (!panelGroup) continue;
        const transform = getBoxPanelTransform(panelName, dimensions, this.explodedFactor);
        panelGroup.position.set(
          transform.position[0] + binding.offsetX,
          transform.position[1],
          transform.position[2],
        );
        panelGroup.rotation.set(...transform.rotation);
      }
    }
  }

  private fitCamera(): void {
    const box = new THREE.Box3().setFromObject(this.modelRoot);
    if (box.isEmpty()) {
      this.controls.target.set(0, 0, 0);
      this.camera.position.set(150, 120, 180);
      return;
    }
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const radius = Math.max(10, sphere.radius);
    this.controls.target.copy(sphere.center);
    this.camera.position.copy(sphere.center).add(new THREE.Vector3(radius * 1.45, radius * 1.05, radius * 1.65));
    this.camera.near = Math.max(0.05, radius / 500);
    this.camera.far = Math.max(2_000, radius * 30);
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  private resize(): void {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private tick = (): void => {
    this.animationFrame = requestAnimationFrame(this.tick);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };
}

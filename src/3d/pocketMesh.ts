import * as THREE from "three";
import { differenceD, intersectD, FillRule, unionD, type PathsD } from "clipper2-ts";
import { pointInClosedPath, signedPolygonArea, type ContourHierarchyNode } from "../geometry/topology";
import { orientPocketPath } from "../cam/pocketingEngine";
import type { Point2D } from "../document/types";

function shapes(paths: PathsD, scale: number, origin: Point2D): THREE.Shape[] {
  const shells = paths.filter((path) => signedPolygonArea(path) > 0);
  const holes = paths.filter((path) => signedPolygonArea(path) < 0);
  return shells.map((shell) => {
    const shape = new THREE.Shape(shell.map((p) => new THREE.Vector2((p.x - origin.x) * scale, (p.y - origin.y) * scale)));
    for (const hole of holes) {
      const owner = shells.filter((candidate) => pointInClosedPath(hole[0]!, candidate))
        .sort((a, b) => Math.abs(signedPolygonArea(a)) - Math.abs(signedPolygonArea(b)))[0];
      if (owner === shell) shape.holes.push(new THREE.Path(hole.map((p) => new THREE.Vector2((p.x - origin.x) * scale, (p.y - origin.y) * scale))));
    }
    return shape;
  });
}

/** Actual top faces, recessed floors and vertical walls; no overlaid filled decal. */
export function createPocketedContourMesh(
  node: ContourHierarchyNode,
  pocketContours: readonly ContourHierarchyNode[],
  thicknessMm: number,
  depthMm: number,
  materials: THREE.Material[],
  unitScale = 1,
): THREE.Mesh {
  if (!Number.isFinite(depthMm) || depthMm <= 0 || depthMm >= thicknessMm) throw new RangeError("Pocket depth must be less than the preview stock thickness.");
  const base = [orientPocketPath(node.path, true), ...node.holes.map((hole) => orientPocketPath(hole.path, false))];
  const pockets = unionD(pocketContours.map((pocket) => orientPocketPath(pocket.path, pocket.depth % 2 === 0)), [], FillRule.NonZero, 6);
  const outside = differenceD(pockets, base, FillRule.NonZero, 6);
  if (outside.some((path) => Math.abs(signedPolygonArea(path)) > 1e-6)) throw new Error("Pocket must fit inside solid stock, clear of through-holes.");
  const recess = intersectD(base, pockets, FillRule.NonZero, 6);
  const top = differenceD(base, recess, FillRule.NonZero, 6);
  const origin = { x: (node.bbox.minX + node.bbox.maxX) / 2, y: (node.bbox.minY + node.bbox.maxY) / 2 };
  const positions: number[] = [];
  const geometry = new THREE.BufferGeometry();
  const floorZ = thicknessMm - depthMm;
  const face = (paths: PathsD, z: number, reverse = false) => {
    const surface = new THREE.ShapeGeometry(shapes(paths, unitScale, origin));
    const indices = surface.getIndex()!;
    const vertices = surface.getAttribute("position");
    for (let i = 0; i < indices.count; i += 3) {
      for (const j of reverse ? [2, 1, 0] : [0, 1, 2]) {
        const index = indices.getX(i + j);
        positions.push(vertices.getX(index), vertices.getY(index), z);
      }
    }
    surface.dispose();
  };
  face(base, 0, true);
  face(top, thicknessMm);
  face(recess, floorZ);
  geometry.addGroup(0, positions.length / 3, 0);
  const sideStart = positions.length / 3;
  const walls = (paths: PathsD, low: number, high: number, reverse = false) => {
    for (const path of paths) {
      for (let i = 0; i < path.length; i += 1) {
        const a = path[i]!; const b = path[(i + 1) % path.length]!;
        const vertices = [[(a.x - origin.x) * unitScale, (a.y - origin.y) * unitScale, low],
          [(b.x - origin.x) * unitScale, (b.y - origin.y) * unitScale, low],
          [(b.x - origin.x) * unitScale, (b.y - origin.y) * unitScale, high],
          [(a.x - origin.x) * unitScale, (a.y - origin.y) * unitScale, high]];
        for (const index of reverse ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3]) positions.push(...vertices[index]!);
      }
    }
  };
  walls(base, 0, floorZ);
  walls(top, floorZ, thicknessMm);
  geometry.addGroup(sideStart, positions.length / 3 - sideStart, 1);
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, materials);
  mesh.name = node.entityId;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.entityId = node.entityId;
  mesh.userData.pocketDepthMm = depthMm;
  mesh.userData.pocketFloorZ = floorZ;
  mesh.userData.pocketEntityIds = pocketContours.map((pocket) => pocket.entityId);
  return mesh;
}

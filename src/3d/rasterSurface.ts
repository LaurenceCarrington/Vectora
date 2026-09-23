import * as THREE from "three";
import type { ImageEntity, Point2D } from "../document/types";
import { imageCorners, rasterPowerMap } from "../cam/rasterCamEngine";

/** Nominal char color/opacity from the same power map as CAM; no material removal. */
export function createRasterSurfaceMesh(image: ImageEntity, thicknessMm: number, mmPerUnit: number, origin: Point2D, onStock = true): THREE.Mesh {
  const map = rasterPowerMap(image, mmPerUnit);
  const rgba = new Uint8Array(map.width * map.height * 4);
  for (let i = 0; i < map.powers.length; i += 1) {
    const strength = map.powers[i]! / image.raster.maxPower;
    rgba.set(onStock ? [48, 28, 16, Math.round(255 * strength)]
      : [Math.round(210 - 162 * strength), Math.round(177 - 149 * strength), Math.round(132 - 116 * strength), 255], i * 4);
  }
  const texture = new THREE.DataTexture(rgba, map.width, map.height, THREE.RGBAFormat);
  texture.magFilter = THREE.NearestFilter; texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false; texture.colorSpace = THREE.SRGBColorSpace; texture.needsUpdate = true;
  const material = new THREE.MeshStandardMaterial({ map: texture, transparent: onStock, depthWrite: !onStock, roughness: 1, side: THREE.DoubleSide });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(imageCorners(image).flatMap((p) => [(p.x - origin.x) * mmPerUnit, (p.y - origin.y) * mmPerUnit, thicknessMm + 0.015]), 3));
  // DataTexture's first row is v=0; map it to the upper image edge.
  const uMax = 1 / (map.width * map.stepX), vMax = 1 / (map.height * map.stepY);
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute([0, vMax, uMax, vMax, uMax, 0, 0, 0], 2));
  geometry.setIndex([0, 1, 2, 0, 2, 3]); geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = `raster-char:${image.id}`; mesh.userData = { entityId: image.id, intent: "raster", surfaceGeometry: "raster", inferredSurface: !onStock };
  return mesh;
}

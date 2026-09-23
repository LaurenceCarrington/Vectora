import type { BoxPanelMetadata, BoxPanelName, Entity } from "../document/types";

export interface BoxAssemblyDimensions {
  readonly width: number;
  readonly depth: number;
  readonly height: number;
}

export interface BoxAssembly {
  readonly id: string;
  readonly dimensions: BoxAssemblyDimensions;
  readonly panels: ReadonlyMap<BoxPanelName, Entity>;
}

export interface PanelTransform3D {
  readonly position: readonly [number, number, number];
  readonly rotation: readonly [number, number, number];
  readonly normal: readonly [number, number, number];
}

const PANEL_NAMES: readonly BoxPanelName[] = ["front", "back", "left", "right", "top", "bottom"];

function boxMetadata(entity: Entity): BoxPanelMetadata | null {
  return entity.metadata?.kind === "box-panel" ? entity.metadata : null;
}

function dimensionsMatch(left: BoxPanelMetadata, right: BoxPanelMetadata): boolean {
  const epsilon = 1e-7;
  return Math.abs(left.width - right.width) <= epsilon &&
    Math.abs(left.depth - right.depth) <= epsilon &&
    Math.abs(left.height - right.height) <= epsilon;
}

/** Returns only complete, consistently dimensioned six-panel box assemblies. */
export function identifyBoxAssemblies(entities: readonly Entity[]): readonly BoxAssembly[] {
  const grouped = new Map<string, Entity[]>();
  for (const entity of entities) {
    const metadata = boxMetadata(entity);
    if (!metadata) continue;
    const group = grouped.get(metadata.assemblyId);
    if (group) group.push(entity);
    else grouped.set(metadata.assemblyId, [entity]);
  }

  const assemblies: BoxAssembly[] = [];
  for (const [id, candidates] of grouped) {
    const firstMetadata = boxMetadata(candidates[0]!);
    if (!firstMetadata || candidates.some((entity) => {
      const metadata = boxMetadata(entity);
      return !metadata || !dimensionsMatch(firstMetadata, metadata);
    })) continue;

    const panels = new Map<BoxPanelName, Entity>();
    for (const entity of candidates) {
      const metadata = boxMetadata(entity);
      if (metadata && !panels.has(metadata.panel)) panels.set(metadata.panel, entity);
    }
    if (!PANEL_NAMES.every((name) => panels.has(name))) continue;
    assemblies.push(Object.freeze({
      id,
      dimensions: Object.freeze({
        width: firstMetadata.width,
        depth: firstMetadata.depth,
        height: firstMetadata.height,
      }),
      panels,
    }));
  }
  return Object.freeze(assemblies);
}

/** Computes a folded panel transform with a deterministic outward explosion offset. */
export function getBoxPanelTransform(
  panel: BoxPanelName,
  dimensions: BoxAssemblyDimensions,
  explodedFactor: number,
): PanelTransform3D {
  const factor = Math.min(1, Math.max(0, explodedFactor));
  const { width, depth, height } = dimensions;
  const explosion = Math.max(width, depth, height) * 0.45 * factor;
  let position: readonly [number, number, number];
  let rotation: readonly [number, number, number];
  let normal: readonly [number, number, number];

  switch (panel) {
    case "front":
      position = [0, 0, depth / 2]; rotation = [0, 0, 0]; normal = [0, 0, 1]; break;
    case "back":
      position = [0, 0, -depth / 2]; rotation = [0, Math.PI, 0]; normal = [0, 0, -1]; break;
    case "left":
      position = [-width / 2, 0, 0]; rotation = [0, -Math.PI / 2, 0]; normal = [-1, 0, 0]; break;
    case "right":
      position = [width / 2, 0, 0]; rotation = [0, Math.PI / 2, 0]; normal = [1, 0, 0]; break;
    case "top":
      position = [0, height / 2, 0]; rotation = [-Math.PI / 2, 0, 0]; normal = [0, 1, 0]; break;
    case "bottom":
      position = [0, -height / 2, 0]; rotation = [Math.PI / 2, 0, 0]; normal = [0, -1, 0]; break;
  }

  const explodedPosition: readonly [number, number, number] = Object.freeze([
    position[0] + normal[0] * explosion,
    position[1] + normal[1] * explosion,
    position[2] + normal[2] * explosion,
  ]);
  return Object.freeze({
    position: explodedPosition,
    rotation,
    normal,
  });
}

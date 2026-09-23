import type { Entity, Layer, LayerId } from "../../document/types";

export interface OperationLayerContext {
  readonly layers: readonly Pick<Layer, "id" | "name" | "locked">[];
}

export function getLockedSelectionReason(
  entities: readonly Entity[],
  layers: OperationLayerContext["layers"],
): string | null {
  const lockedEntity = entities.find((entity) => entity.locked);
  if (lockedEntity) return `Entity "${lockedEntity.id}" is locked.`;
  const layerById = new Map(layers.map((layer) => [layer.id, layer]));
  for (const entity of entities) {
    const layer = layerById.get(entity.layerId);
    if (!layer) return `Layer "${entity.layerId}" does not exist.`;
    if (layer.locked) return `Layer "${layer.name}" is locked.`;
  }
  return null;
}

export function assertSelectionEditable(
  entities: readonly Entity[],
  layers: OperationLayerContext["layers"],
): void {
  const reason = getLockedSelectionReason(entities, layers);
  if (reason) throw new Error(reason);
}

export function resolveResultLayerId(
  primary: Entity,
  preferredLayerId: LayerId | undefined,
  layers: OperationLayerContext["layers"],
): LayerId {
  if (!preferredLayerId || preferredLayerId === primary.layerId) return primary.layerId;

  const preferred = layers.find((layer) => layer.id === preferredLayerId);
  if (preferred && !preferred.locked) return preferred.id;

  const primaryLayer = layers.find((layer) => layer.id === primary.layerId);
  if (!primaryLayer) throw new Error(`Layer "${primary.layerId}" does not exist.`);
  if (primaryLayer.locked) throw new Error(`Layer "${primaryLayer.name}" is locked.`);
  return primaryLayer.id;
}

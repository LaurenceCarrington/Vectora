import { documentModel } from "../document/DocumentModel";
import type { CadDocument, DimensionAnchorReference, Entity, Point2D } from "../document/types";
import { getSelectionBounds, scaleEntities, translateEntities } from "../renderer/TransformOverlay";
import { parseVectoraDocument, serializeVectoraDocument } from "./filePersistence";

export const OBJECT_CLIPBOARD_PREFIX = "Vectora objects v1\n";
const MAX_CLIPBOARD_LENGTH = 64 * 1024 * 1024;
const MM_PER_UNIT = { mm: 1, in: 25.4, px: 25.4 / 96 } as const;

/** Copy only selected objects and their layer definitions, in drawing order. */
export function copySelectedObjects(): string | null {
  const document = documentModel.getDocument();
  const entities = documentModel.getEntitiesInZOrder().filter(entity => document.selection.has(entity.id));
  if (!entities.length) return null;
  const layerIds = new Set(entities.map(entity => entity.layerId));
  const snapshot: CadDocument = {
    id: document.id, version: 1, title: "Copied objects", units: document.units,
    activeLayerId: entities[0]!.layerId,
    layers: document.layers.filter(layer => layerIds.has(layer.id)),
    entities: new Map(entities.map(entity => [entity.id, entity])), selection: new Set(),
  };
  const text = OBJECT_CLIPBOARD_PREFIX + serializeVectoraDocument(snapshot);
  if (text.length > MAX_CLIPBOARD_LENGTH) throw new Error("This selection is too large for the clipboard. Copy fewer objects at a time.");
  return text;
}

/** Validate and clone before touching the document; each paste is independent. */
export function prepareObjectPaste(text: string, target: Readonly<CadDocument>, offset: Point2D, center: Point2D): readonly Entity[] {
  if (!text.startsWith(OBJECT_CLIPBOARD_PREFIX)) throw new Error("Copy objects from Vectora before pasting them onto the canvas.");
  if (text.length > MAX_CLIPBOARD_LENGTH) throw new Error("This selection is too large for the clipboard.");
  const source = parseVectoraDocument(text.slice(OBJECT_CLIPBOARD_PREFIX.length));
  if (!source.entities.length) throw new Error("There are no objects to paste.");
  const sameDocument = source.id === target.id;
  const ids = new Map(source.entities.map(entity => [entity.id, crypto.randomUUID()]));
  const groupIds = new Map<string, string>();
  const freshGroup = (kind: string, id: string) => {
    const key = `${kind}:${id}`;
    if (!groupIds.has(key)) groupIds.set(key, crypto.randomUUID());
    return groupIds.get(key)!;
  };
  const remapReference = (reference: DimensionAnchorReference | undefined) => {
    const entityId = reference && ids.get(reference.entityId);
    return entityId ? { ...reference!, entityId } : undefined;
  };
  const scale = MM_PER_UNIT[source.units] / MM_PER_UNIT[target.units];
  const scaled = scale === 1 ? source.entities : scaleEntities(source.entities,
    { minX: 0, minY: 0, maxX: 1, maxY: 1 }, "ne", { x: scale, y: scale }, true);
  const copies = scaled.map((entity): Entity => {
    const originalLayer = source.layers.find(layer => layer.id === entity.layerId)!;
    const destination = (sameDocument && target.layers.find(layer => layer.id === entity.layerId))
      || target.layers.find(layer => layer.id === target.activeLayerId);
    if (!destination || destination.locked || !destination.visible) {
      throw new Error(`Cannot paste into ${destination?.name ?? "the active layer"}. Choose a visible, unlocked layer${sameDocument ? " or unlock/show the original layer" : ""}.`);
    }
    const copy: Entity = {
      ...entity, id: ids.get(entity.id)!, layerId: destination.id, locked: false, visible: true,
      style: {
        ...entity.style,
        // A different document/layer must not change the copied line colour.
        strokeColor: entity.style.strokeColor ?? (sameDocument && destination.id === originalLayer.id ? null : originalLayer.color),
      },
      ...(entity.compoundId ? { compoundId: freshGroup("compound", entity.compoundId) } : {}),
      ...(entity.dxfGroup ? { dxfGroup: freshGroup("dxf", entity.dxfGroup) } : {}),
      ...(entity.metadata ? { metadata: {
        ...entity.metadata, assemblyId: freshGroup("assembly", entity.metadata.assemblyId),
        width: entity.metadata.width * scale, depth: entity.metadata.depth * scale,
        height: entity.metadata.height * scale, materialThickness: entity.metadata.materialThickness * scale,
      } } : {}),
    };
    if (copy.type === "dimension") {
      const start = remapReference(copy.references?.start);
      const end = remapReference(copy.references?.end);
      // Never leave copies bound to an original object outside the copied set.
      const { references: _references, ...unbound } = copy;
      return { ...unbound, ...((start || end) ? { references: { ...(start ? { start } : {}), ...(end ? { end } : {}) } } : {}) };
    }
    return copy;
  });
  const bounds = getSelectionBounds(copies)!;
  return translateEntities(copies, {
    x: offset.x + (sameDocument ? 0 : center.x - (bounds.minX + bounds.maxX) / 2),
    y: offset.y + (sameDocument ? 0 : center.y - (bounds.minY + bounds.maxY) / 2),
  });
}

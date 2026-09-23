import { defaultEntityName, documentModel } from "./DocumentModel";
import type { DimensionEntity, Entity, EntityId, Layer } from "./types";
import { updateBoundDimension } from "../geometry/annotations";

export interface Command {
  readonly label: string;
  execute(): void;
  undo(): void;
}

export interface HistorySnapshot {
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly undoLabel: string | null;
  readonly redoLabel: string | null;
}

type HistoryListener = () => void;

export class AddEntityCommand implements Command {
  readonly label = "Add entity";

  constructor(private readonly entity: Entity) {}

  execute(): void {
    documentModel.addEntity(this.entity);
    documentModel.selectEntities([this.entity.id]);
  }

  undo(): void {
    documentModel.removeEntity(this.entity.id);
  }
}

export class AddEntitiesCommand implements Command {
  readonly label: string;
  private readonly selectionBefore: readonly EntityId[];

  constructor(private readonly entities: readonly Entity[], label = "Add generated geometry") {
    if (entities.length === 0) throw new RangeError("AddEntitiesCommand requires at least one entity.");
    this.label = label;
    this.selectionBefore = Object.freeze([...documentModel.getDocument().selection]);
  }

  execute(): void {
    documentModel.replaceEntitySet([], this.entities);
    documentModel.selectEntities(this.entities.map((entity) => entity.id));
  }

  undo(): void {
    documentModel.replaceEntitySet(this.entities.map((entity) => entity.id), []);
    documentModel.selectEntities(this.selectionBefore);
  }
}

export class AddLayerCommand implements Command {
  readonly label = "Add layer";
  private readonly activeLayerBefore: string;

  constructor(private readonly layer: Layer) {
    this.activeLayerBefore = documentModel.getDocument().activeLayerId;
  }

  execute(): void {
    documentModel.addLayer(this.layer);
    documentModel.setActiveLayerId(this.layer.id);
  }

  undo(): void {
    documentModel.removeLayer(this.layer.id);
    if (documentModel.getDocument().layers.some((layer) => layer.id === this.activeLayerBefore)) {
      documentModel.setActiveLayerId(this.activeLayerBefore);
    }
  }
}

export class AddLayerWithEntitiesCommand implements Command {
  readonly label: string;
  private readonly selectionBefore: readonly EntityId[];

  constructor(
    private readonly layer: Layer,
    private readonly entities: readonly Entity[],
    label = "Insert traced image",
  ) {
    if (entities.length === 0) throw new RangeError("A layer insertion requires at least one entity.");
    if (entities.some((entity) => entity.layerId !== layer.id)) {
      throw new Error("Every inserted entity must belong to the inserted layer.");
    }
    this.label = label;
    this.selectionBefore = Object.freeze([...documentModel.getDocument().selection]);
  }

  execute(): void {
    documentModel.addLayer(this.layer);
    try {
      documentModel.replaceEntitySet([], this.entities);
      documentModel.selectEntities(this.entities.map((entity) => entity.id));
    } catch (error) {
      documentModel.removeLayer(this.layer.id);
      throw error;
    }
  }

  undo(): void {
    documentModel.replaceEntitySet(this.entities.map((entity) => entity.id), []);
    documentModel.removeLayer(this.layer.id);
    documentModel.selectEntities(this.selectionBefore);
  }
}

export class DeleteEntityCommand implements Command {
  readonly label: string;
  private readonly requestedIds: readonly EntityId[];
  private entities: readonly Entity[] = Object.freeze([]);
  private lastDeletedEntities: readonly Entity[] = Object.freeze([]);
  private hasCapturedEntities = false;
  private readonly selectionBefore: readonly EntityId[];

  constructor(ids: readonly EntityId[]) {
    const document = documentModel.getDocument();
    this.requestedIds = Object.freeze([...new Set(ids)]);
    const requested = [...new Set(ids)]
      .map((id) => document.entities.get(id))
      .filter((entity): entity is Entity => Boolean(entity));
    const eligibleCount = requested.filter((entity) => documentModel.canMutateEntity(entity)).length;
    this.selectionBefore = Object.freeze([...document.selection]);
    this.label = eligibleCount === 1 ? "Delete entity" : `Delete ${eligibleCount} entities`;
  }

  get isEmpty(): boolean {
    return this.hasCapturedEntities ? this.entities.length === 0 : this.collectEligibleEntities().length === 0;
  }

  get blockedCount(): number {
    const document = documentModel.getDocument();
    const existingCount = this.requestedIds.filter((id) => document.entities.has(id)).length;
    return existingCount - this.collectEligibleEntities().length;
  }

  execute(): void {
    const candidates = this.hasCapturedEntities
      ? this.entities.map((entity) => entity.id)
      : this.requestedIds;
    const eligible = this.collectEligibleEntities(candidates);
    if (!this.hasCapturedEntities) {
      this.entities = eligible;
      this.hasCapturedEntities = true;
    }
    this.lastDeletedEntities = eligible;
    if (eligible.length === 0) return;
    // DocumentModel validates the complete removal set before changing anything,
    // protecting against a lock that changed after this command was created.
    documentModel.replaceEntitySet(eligible.map((entity) => entity.id), []);
    documentModel.clearSelection();
  }

  undo(): void {
    if (this.lastDeletedEntities.length > 0) {
      documentModel.replaceEntitySet([], this.lastDeletedEntities);
    }
    documentModel.selectEntities(this.selectionBefore);
  }

  private collectEligibleEntities(ids: readonly EntityId[] = this.requestedIds): readonly Entity[] {
    const document = documentModel.getDocument();
    return Object.freeze(
      ids
        .map((id) => document.entities.get(id))
        .filter((entity): entity is Entity => entity !== undefined && documentModel.canMutateEntity(entity)),
    );
  }
}

/** A delete command built from snapshots collected during an immediate erase gesture. */
export class EraseEntitiesCommand implements Command {
  readonly label: string;

  constructor(
    private readonly entities: readonly Entity[],
    private readonly selectionBefore: readonly EntityId[],
  ) {
    if (entities.length === 0) throw new RangeError("An erase command requires at least one entity.");
    this.label = entities.length === 1 ? "Erase entity" : `Erase ${entities.length} entities`;
  }

  execute(): void {
    const existingIds = this.entities
      .map((entity) => entity.id)
      .filter((id) => documentModel.getDocument().entities.has(id));
    if (existingIds.length > 0) documentModel.replaceEntitySet(existingIds, []);
    documentModel.clearSelection();
  }

  undo(): void {
    const missing = this.entities.filter(
      (entity) => !documentModel.getDocument().entities.has(entity.id),
    );
    if (missing.length > 0) documentModel.replaceEntitySet([], missing);
    documentModel.selectEntities(this.selectionBefore);
  }
}

export type DeleteLayerStrategy =
  | { readonly kind: "delete-contents" }
  | { readonly kind: "migrate"; readonly targetLayerId: string };

export class DeleteLayerCommand implements Command {
  readonly label: string;
  private readonly layer: Layer;
  private readonly entities: readonly Entity[];
  private readonly selectionBefore: readonly EntityId[];
  private readonly activeLayerBefore: string;

  constructor(
    layerId: string,
    private readonly strategy: DeleteLayerStrategy,
  ) {
    const document = documentModel.getDocument();
    const layer = document.layers.find((candidate) => candidate.id === layerId);
    if (!layer) throw new Error(`Layer "${layerId}" does not exist.`);
    if (document.layers.length <= 1) throw new Error("The final document layer cannot be deleted.");
    if (strategy.kind === "migrate") {
      if (strategy.targetLayerId === layerId) throw new Error("Choose a different destination layer.");
      if (!document.layers.some((candidate) => candidate.id === strategy.targetLayerId)) {
        throw new Error(`Layer "${strategy.targetLayerId}" does not exist.`);
      }
    }
    this.layer = layer;
    this.entities = Object.freeze(
      [...document.entities.values()].filter((entity) => entity.layerId === layerId),
    );
    this.selectionBefore = Object.freeze([...document.selection]);
    this.activeLayerBefore = document.activeLayerId;
    this.label = this.entities.length === 0
      ? `Delete layer ${layer.name}`
      : strategy.kind === "migrate"
        ? `Move objects and delete ${layer.name}`
        : `Delete ${layer.name} and contents`;
  }

  execute(): void {
    if (this.strategy.kind === "migrate" && this.entities.length > 0) {
      const targetLayerId = this.strategy.targetLayerId;
      documentModel.replaceEntities(this.entities.map((entity) => ({
        ...entity,
        layerId: targetLayerId,
      })));
    } else if (this.entities.length > 0) {
      documentModel.replaceEntitySet(this.entities.map((entity) => entity.id), []);
    }
    documentModel.removeLayer(this.layer.id);
  }

  undo(): void {
    documentModel.addLayer(this.layer);
    if (this.strategy.kind === "migrate" && this.entities.length > 0) {
      documentModel.replaceEntities(this.entities);
    } else if (this.entities.length > 0) {
      documentModel.replaceEntitySet([], this.entities);
    }
    documentModel.selectEntities(this.selectionBefore);
    documentModel.setActiveLayerId(this.activeLayerBefore);
  }
}

export class TransformEntityCommand implements Command {
  readonly label: string;
  private readonly before: readonly Entity[];
  private readonly after: readonly Entity[];
  private readonly selectedAfterIds: readonly EntityId[];

  constructor(
    before: readonly Entity[],
    after: readonly Entity[],
    label: string = "Transform",
  ) {
    this.label = `${label} ${before.length === 1 ? "entity" : `${before.length} entities`}`;
    if (before.length !== after.length) {
      throw new Error("Transform snapshots must contain the same number of entities.");
    }
    for (const entity of before) documentModel.assertEntityMutable(entity.id, "modify");
    this.selectedAfterIds = Object.freeze(after.map((entity) => entity.id));
    const document = documentModel.getDocument();
    const changedIds = new Set(before.map((entity) => entity.id));
    const attached = [...document.entities.values()].filter(
      (entity): entity is DimensionEntity => entity.type === "dimension" &&
        !changedIds.has(entity.id) &&
        documentModel.canMutateEntity(entity) &&
        Boolean(
          (entity.references?.start && changedIds.has(entity.references.start.entityId)) ||
          (entity.references?.end && changedIds.has(entity.references.end.entityId)),
        ),
    );
    if (attached.length === 0) {
      this.before = Object.freeze([...before]);
      this.after = Object.freeze([...after]);
      return;
    }
    const futureEntities = new Map(document.entities);
    for (const entity of after) futureEntities.set(entity.id, entity);
    const updatedDimensions = attached.map((dimension) => updateBoundDimension(dimension, futureEntities));
    this.before = Object.freeze([...before, ...attached]);
    this.after = Object.freeze([...after, ...updatedDimensions]);
  }

  execute(): void {
    documentModel.replaceEntitySet(this.before.map((entity) => entity.id), this.after);
    documentModel.selectEntities(this.selectedAfterIds);
  }

  undo(): void {
    documentModel.replaceEntitySet(this.after.map((entity) => entity.id), this.before);
    documentModel.selectEntities(this.selectedAfterIds);
  }
}

const TREE_STATE_KEYS = new Set(["name", "visible", "locked"]);

function isSingleEntityTreeStateChange(before: readonly Entity[], after: readonly Entity[]): boolean {
  if (before.length !== 1 || after.length !== 1) return false;
  const previous = before[0]!;
  const next = after[0]!;
  if (previous.id !== next.id || previous.type !== next.type) return false;
  let treeStateChanged = false;
  const previousRecord = previous as unknown as Record<string, unknown>;
  const nextRecord = next as unknown as Record<string, unknown>;
  for (const key of new Set([...Object.keys(previousRecord), ...Object.keys(nextRecord)])) {
    if (previousRecord[key] === nextRecord[key]) continue;
    if (!TREE_STATE_KEYS.has(key)) return false;
    treeStateChanged = true;
  }
  return treeStateChanged;
}

function treeStatePatch(current: Entity, target: Entity): Partial<Pick<Entity, "name" | "visible" | "locked">> {
  return {
    ...(current.name === target.name ? {} : { name: target.name ?? defaultEntityName(target) }),
    ...(current.visible === target.visible ? {} : { visible: target.visible }),
    ...(current.locked === target.locked ? {} : { locked: target.locked }),
  };
}

/**
 * General entity update command with a narrow tree-state path for reversible
 * name/visibility/lock changes. Geometry continues through TransformEntityCommand.
 */
export class UpdateEntitiesCommand implements Command {
  readonly label: string;
  private readonly transform: TransformEntityCommand | null;
  private readonly before: readonly Entity[];
  private readonly after: readonly Entity[];

  constructor(before: readonly Entity[], after: readonly Entity[], label = "Update properties") {
    this.before = Object.freeze([...before]);
    this.after = Object.freeze([...after]);
    if (isSingleEntityTreeStateChange(before, after)) {
      const previous = before[0]!;
      const next = after[0]!;
      const explicitlyUnlocking = previous.locked && !next.locked &&
        previous.name === next.name && previous.visible === next.visible;
      if (!explicitlyUnlocking) documentModel.assertEntityMutable(previous.id, "modify");
      else if (documentModel.getLayer(previous.layerId)?.locked) {
        documentModel.assertEntityMutable(previous.id, "modify");
      }
      this.transform = null;
      this.label = label;
    } else {
      this.transform = new TransformEntityCommand(before, after, label);
      this.label = this.transform.label;
    }
  }

  execute(): void {
    if (this.transform) {
      this.transform.execute();
      return;
    }
    this.apply(this.after[0]!);
  }

  undo(): void {
    if (this.transform) {
      this.transform.undo();
      return;
    }
    this.apply(this.before[0]!);
  }

  private apply(target: Entity): void {
    const current = documentModel.getDocument().entities.get(target.id);
    if (!current) throw new Error(`Entity "${target.id}" does not exist.`);
    documentModel.updateEntityTreeState(target.id, treeStatePatch(current, target));
  }
}

export type LayerStateProperty = "visible" | "locked";

/** A deterministic, reversible layer visibility or lock transition. */
export class ToggleLayerStateCommand implements Command {
  readonly label: string;
  private readonly previousValue: boolean;
  private readonly nextValue: boolean;

  constructor(
    private readonly layerId: string,
    private readonly property: LayerStateProperty,
    nextValue?: boolean,
  ) {
    const layer = documentModel.getLayer(layerId);
    if (!layer) throw new Error(`Layer "${layerId}" does not exist.`);
    this.previousValue = layer[property];
    this.nextValue = nextValue ?? !this.previousValue;
    this.label = property === "visible"
      ? `${this.nextValue ? "Show" : "Hide"} layer ${layer.name}`
      : `${this.nextValue ? "Lock" : "Unlock"} layer ${layer.name}`;
  }

  get isNoop(): boolean {
    return this.previousValue === this.nextValue;
  }

  execute(): void {
    this.apply(this.nextValue);
  }

  undo(): void {
    this.apply(this.previousValue);
  }

  private apply(value: boolean): void {
    const layer = documentModel.getLayer(this.layerId);
    if (!layer) throw new Error(`Layer "${this.layerId}" does not exist.`);
    if (this.property === "visible") {
      documentModel.updateLayer(this.layerId, { visible: value });
    } else {
      documentModel.updateLayer(this.layerId, { locked: value });
    }
  }
}

export class ReplaceEntitySetCommand implements Command {
  readonly label: string;

  constructor(
    private readonly before: readonly Entity[],
    private readonly after: readonly Entity[],
    label: string,
  ) {
    if (before.length === 0) throw new RangeError("A geometry replacement requires source entities.");
    this.label = label;
  }

  execute(): void {
    documentModel.replaceEntitySet(
      this.before.map((entity) => entity.id),
      this.after,
    );
    documentModel.selectEntities(this.after.map((entity) => entity.id));
  }

  undo(): void {
    documentModel.replaceEntitySet(
      this.after.map((entity) => entity.id),
      this.before,
    );
    documentModel.selectEntities(this.before.map((entity) => entity.id));
  }
}

export class History {
  private readonly undoStack: Command[] = [];
  private readonly redoStack: Command[] = [];
  private readonly listeners = new Set<HistoryListener>();
  private snapshot: HistorySnapshot = Object.freeze({
    canUndo: false,
    canRedo: false,
    undoLabel: null,
    redoLabel: null,
  });

  constructor(private readonly maximumEntries = 200) {
    if (!Number.isInteger(maximumEntries) || maximumEntries < 1) {
      throw new RangeError("History capacity must be a positive integer.");
    }
  }

  executeCommand(command: Command): void {
    command.execute();
    this.recordExecutedCommand(command);
  }

  /** Records a command whose final state has already been applied interactively. */
  recordExecutedCommand(command: Command): void {
    this.undoStack.push(command);
    if (this.undoStack.length > this.maximumEntries) this.undoStack.shift();
    this.redoStack.length = 0;
    this.publish();
  }

  undo(): boolean {
    const command = this.undoStack.pop();
    if (!command) return false;
    try {
      command.undo();
    } catch (error) {
      // A failed command must remain available. Dropping it here corrupts the
      // history cursor even though no successful undo took place.
      this.undoStack.push(command);
      throw error;
    }
    this.redoStack.push(command);
    this.publish();
    return true;
  }

  redo(): boolean {
    const command = this.redoStack.pop();
    if (!command) return false;
    try {
      command.execute();
    } catch (error) {
      this.redoStack.push(command);
      throw error;
    }
    this.undoStack.push(command);
    this.publish();
    return true;
  }

  clear(): void {
    if (this.undoStack.length === 0 && this.redoStack.length === 0) return;
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.publish();
  }

  getSnapshot(): HistorySnapshot {
    return this.snapshot;
  }

  subscribe(listener: HistoryListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private publish(): void {
    this.snapshot = Object.freeze({
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      undoLabel: this.undoStack.at(-1)?.label ?? null,
      redoLabel: this.redoStack.at(-1)?.label ?? null,
    });
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch (error) {
        console.error("History listener failed after the history state changed.", error);
      }
    }
  }
}

export const history = new History();

export function executeCommand(command: Command): void {
  history.executeCommand(command);
}

/** Adds one undo entry for an interactive operation whose live state is already applied. */
export function recordExecutedCommand(command: Command): void {
  history.recordExecutedCommand(command);
}

export function undo(): boolean {
  return history.undo();
}

export function redo(): boolean {
  return history.redo();
}

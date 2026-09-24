import {
  memo,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ComponentType,
  type SVGProps,
} from "react";
import { AnimatePresence, motion, type PanInfo, useDragControls } from "framer-motion";
import {
  ArrowUpRight,
  ChevronRight,
  Circle,
  Cloud,
  CornerDownLeft,
  Eye,
  EyeOff,
  Lock,
  Minus,
  Pentagon,
  Plus,
  Ruler,
  Shapes,
  Square,
  Star,
  Trash2,
  Type,
  Unlock,
  Waypoints,
  X,
} from "lucide-react";
import { defaultEntityName, documentModel } from "../../document/DocumentModel";
import {
  ToggleLayerStateCommand,
  UpdateEntitiesCommand,
  executeCommand,
} from "../../document/History";
import type { Entity, Layer } from "../../document/types";
import { useVectorStore } from "../../store/useVectorStore";
import { toast } from "../ui/Toast";
import { Tooltip } from "../ui/Tooltip";
import { MobilePanelNavigation, useMobilePanelChrome } from "./MobilePanelChrome";

type IconType = ComponentType<SVGProps<SVGSVGElement> & { size?: number; strokeWidth?: number }>;

export interface LayersPanelProps {
  readonly onCreateLayer: () => void;
  readonly onDeleteLayer: (layerId: string) => void;
}

const ENTITY_ICONS: Readonly<Record<Entity["type"], IconType>> = Object.freeze({
  image: Square,
  line: ArrowUpRight,
  polyline: Waypoints,
  rectangle: Square,
  circle: Circle,
  arc: Shapes,
  ellipse: Circle,
  polygon: Pentagon,
  quadrant: Shapes,
  semicircle: Shapes,
  segment: Shapes,
  star: Star,
  cloud: Cloud,
  text: Type,
  dimension: Ruler,
  leader: CornerDownLeft,
});

function runEntityUpdate(entityId: string, update: (current: Entity) => Entity, label: string): void {
  try {
    const current = documentModel.getDocument().entities.get(entityId);
    if (!current) throw new Error(`Entity "${entityId}" no longer exists.`);
    executeCommand(new UpdateEntitiesCommand([current], [update(current)], label));
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "The entity could not be updated.");
  }
}

const EntityTreeRow = memo(function EntityTreeRow({
  entity,
  layerLocked,
  selected,
}: {
  readonly entity: Entity;
  readonly layerLocked: boolean;
  readonly selected: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState("");
  const Icon = ENTITY_ICONS[entity.type];
  const displayName = entity.name?.trim() || defaultEntityName(entity);
  const canRename = !entity.locked && !layerLocked;
  const canToggleVisibility = !entity.locked && !layerLocked;
  const canToggleLock = !layerLocked;

  const beginRename = () => {
    if (!canRename) {
      toast.info("Unlock the entity and its layer before renaming it.");
      return;
    }
    setDraftName(displayName);
    setEditing(true);
  };

  const commitRename = () => {
    if (!editing) return;
    setEditing(false);
    const name = draftName.trim();
    if (!name || name === displayName) return;
    runEntityUpdate(entity.id, (current) => ({ ...current, name }), `Rename ${displayName}`);
  };

  return (
    <div
      className={`entity-tree-row ${selected ? "is-selected" : ""} ${entity.visible ? "" : "is-hidden"}`}
      role="treeitem"
      aria-selected={selected}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {editing ? (
        <div className="entity-tree-select is-editing">
          <Icon size={15} strokeWidth={1.8} aria-hidden="true" />
          <input
            autoFocus
            value={draftName}
            maxLength={160}
            aria-label="Entity name"
            onClick={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
            onChange={(event) => setDraftName(event.target.value)}
            onBlur={commitRename}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commitRename();
              } else if (event.key === "Escape") {
                event.preventDefault();
                setEditing(false);
                setDraftName(displayName);
              }
            }}
          />
        </div>
      ) : (
        <button
          className="entity-tree-select"
          onClick={() => documentModel.setSelection([entity.id])}
          onDoubleClick={(event) => {
            event.stopPropagation();
            beginRename();
          }}
          aria-label={`Select ${displayName}`}
        >
          <Icon size={15} strokeWidth={1.8} aria-hidden="true" />
          <span>{displayName}</span>
        </button>
      )}
      <Tooltip content={canToggleVisibility ? (entity.visible ? "Hide entity" : "Show entity") : "Unlock before changing visibility"} placement="left">
        <button
          className="entity-tree-action"
          disabled={!canToggleVisibility}
          aria-label={entity.visible ? `Hide ${displayName}` : `Show ${displayName}`}
          onClick={() => runEntityUpdate(
            entity.id,
            (current) => ({ ...current, visible: !current.visible }),
            `${entity.visible ? "Hide" : "Show"} ${displayName}`,
          )}
        >{entity.visible ? <Eye size={14} /> : <EyeOff size={14} />}</button>
      </Tooltip>
      <Tooltip content={canToggleLock ? (entity.locked ? "Unlock entity" : "Lock entity") : "Unlock the layer first"} placement="left">
        <button
          className="entity-tree-action"
          disabled={!canToggleLock}
          aria-label={entity.locked ? `Unlock ${displayName}` : `Lock ${displayName}`}
          onClick={() => runEntityUpdate(
            entity.id,
            (current) => ({ ...current, locked: !current.locked }),
            `${entity.locked ? "Unlock" : "Lock"} ${displayName}`,
          )}
        >{entity.locked ? <Lock size={13} /> : <Unlock size={13} />}</button>
      </Tooltip>
    </div>
  );
});

function LayerTreeGroup({
  layer,
  entities,
  active,
  expanded,
  selection,
  onToggleExpanded,
}: {
  readonly layer: Layer;
  readonly entities: readonly Entity[];
  readonly active: boolean;
  readonly expanded: boolean;
  readonly selection: ReadonlySet<string>;
  readonly onToggleExpanded: (layerId: string) => void;
}) {
  return (
    <div className="layer-tree-group" role="treeitem" aria-expanded={expanded}>
      <div className={`layer-row ${active ? "is-selected" : ""}`} onPointerDown={(event) => event.stopPropagation()}>
        <Tooltip content={expanded ? "Collapse layer" : "Expand layer"} placement="left">
          <button
            className="layer-expand"
            aria-label={`${expanded ? "Collapse" : "Expand"} ${layer.name}`}
            onClick={() => onToggleExpanded(layer.id)}
          >
            <ChevronRight className={expanded ? "is-expanded" : ""} size={15} />
          </button>
        </Tooltip>
        <button
          className="layer-select"
          aria-label={`Use ${layer.name} as the active layer`}
          aria-pressed={active}
          onClick={() => documentModel.setActiveLayerId(layer.id)}
        >
          <span className="layer-swatch" style={{ backgroundColor: layer.color }} />
          <span className="layer-name">{layer.name}<small>{entities.length} {entities.length === 1 ? "object" : "objects"}</small></span>
        </button>
        <Tooltip content={layer.visible ? "Hide layer" : "Show layer"} placement="left">
          <button
            className="layer-action"
            aria-label={layer.visible ? "Hide layer" : "Show layer"}
            onClick={() => executeCommand(new ToggleLayerStateCommand(layer.id, "visible"))}
          >{layer.visible ? <Eye size={16} /> : <EyeOff size={16} />}</button>
        </Tooltip>
        <Tooltip content={layer.locked ? "Unlock layer" : "Lock layer"} placement="left">
          <button
            className="layer-action"
            aria-label={layer.locked ? "Unlock layer" : "Lock layer"}
            onClick={() => executeCommand(new ToggleLayerStateCommand(layer.id, "locked"))}
          >{layer.locked ? <Lock size={15} /> : <Unlock size={15} />}</button>
        </Tooltip>
      </div>
      {expanded && (
        <div className="entity-tree-list" role="group">
          {entities.length === 0 ? (
            <div className="entity-tree-empty"><Minus size={12} /> Empty layer</div>
          ) : entities.map((entity) => (
            <EntityTreeRow
              key={entity.id}
              entity={entity}
              layerLocked={layer.locked}
              selected={selection.has(entity.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function LayersPanel({ onCreateLayer, onDeleteLayer }: LayersPanelProps) {
  const open = useVectorStore((state) => state.layersOpen);
  return <AnimatePresence>{open && (
    <LayersPanelContent onCreateLayer={onCreateLayer} onDeleteLayer={onDeleteLayer} />
  )}</AnimatePresence>;
}

function LayersPanelContent({ onCreateLayer, onDeleteLayer }: LayersPanelProps) {
  const { mobile, panelRef } = useMobilePanelChrome("layers");
  const togglePanel = useVectorStore((state) => state.togglePanel);
  const position = useVectorStore((state) => state.panelPositions.layers);
  const setPanelPosition = useVectorStore((state) => state.setPanelPosition);
  const dragControls = useDragControls();
  const documentSnapshot = useSyncExternalStore(
    (onStoreChange) => documentModel.subscribe(() => onStoreChange()),
    () => documentModel.getDocument(),
    () => documentModel.getDocument(),
  );
  const layers = useMemo(
    () => [...documentSnapshot.layers].sort((left, right) => left.order - right.order),
    [documentSnapshot.layers],
  );
  const [expandedLayerIds, setExpandedLayerIds] = useState<ReadonlySet<string>>(() => new Set());

  useEffect(() => {
    if (documentSnapshot.selection.size === 0) return;
    setExpandedLayerIds((current) => {
      const next = new Set(current);
      let changed = false;
      for (const entityId of documentSnapshot.selection) {
        const layerId = documentSnapshot.entities.get(entityId)?.layerId;
        if (layerId && !next.has(layerId)) {
          next.add(layerId);
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [documentSnapshot.entities, documentSnapshot.selection]);

  const toggleExpanded = (layerId: string) => {
    setExpandedLayerIds((current) => {
      const next = new Set(current);
      if (next.has(layerId)) next.delete(layerId);
      else next.add(layerId);
      return next;
    });
  };

  const onDragEnd = (_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    setPanelPosition("layers", { x: position.x + info.offset.x, y: position.y + info.offset.y });
  };

  return (
    <motion.section
      ref={panelRef}
      id="layers-panel"
      className="utility-panel surface layers-panel"
      aria-label="Document layers and entities"
      style={{ x: mobile ? 0 : position.x, y: mobile ? 0 : position.y }}
      initial={{ opacity: 0, scale: 0.97, y: mobile ? 0 : position.y + 8 }}
      animate={{ opacity: 1, scale: 1, y: mobile ? 0 : position.y }}
      exit={{ opacity: 0, scale: 0.97, y: mobile ? 0 : position.y + 8 }}
      transition={{ type: "spring", stiffness: 400, damping: 32 }}
      drag={!mobile}
      dragControls={dragControls}
      dragListener={false}
      dragMomentum={false}
      dragElastic={0}
      onDragEnd={onDragEnd}
      onPointerDown={(event) => {
        event.stopPropagation();
        if (!mobile && (event.target as Element).closest(".drag-handle")) dragControls.start(event);
      }}
    >
      <div className="panel-header drag-handle">
        <div><span className="eyebrow">Document</span><h2>Layers <small>{layers.length}</small></h2></div>
        <Tooltip content="Close panel" placement="left">
          <button
            className="panel-close"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => togglePanel("layers", false)}
            aria-label="Close panel"
          ><X size={20} /></button>
        </Tooltip>
      </div>
      <MobilePanelNavigation active="layers" />
      <div className="panel-rule" />
      <div className="layer-list" role="tree" aria-label="Document layer tree">
        {layers.map((layer) => (
          <LayerTreeGroup
            key={layer.id}
            layer={layer}
            entities={documentModel.getEntitiesForLayer(layer.id)}
            active={documentSnapshot.activeLayerId === layer.id}
            expanded={expandedLayerIds.has(layer.id)}
            selection={documentSnapshot.selection}
            onToggleExpanded={toggleExpanded}
          />
        ))}
      </div>
      <div className="layers-footer">
        <button onClick={onCreateLayer}><Plus size={16} /> Add layer</button>
        <Tooltip content="Delete layer" placement="left">
          <button
            className="delete-layer"
            aria-label="Delete layer"
            disabled={layers.length <= 1}
            onClick={() => onDeleteLayer(documentSnapshot.activeLayerId)}
          ><Trash2 size={16} /></button>
        </Tooltip>
      </div>
      <div className="drag-note"><i /> Drag header to move</div>
    </motion.section>
  );
}

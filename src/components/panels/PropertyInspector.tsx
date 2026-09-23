import { entityToClosedPath } from "../../geometry/operations/pathConversion";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { motion, type PanInfo, useDragControls } from "framer-motion";
import { ChevronDown, SlidersHorizontal, X } from "lucide-react";
import { documentModel } from "../../document/DocumentModel";
import { UpdateEntitiesCommand, executeCommand } from "../../document/History";
import type { Entity, ManufacturingIntent } from "../../document/types";
import {
  getSelectionBounds,
  rotateEntities,
  scaleEntities,
  translateEntities,
} from "../../renderer/TransformOverlay";
import { useVectorStore } from "../../store/useVectorStore";
import { MANUFACTURING_INTENT_LABELS } from "../ui/terminology";
import { Tooltip } from "../ui/Tooltip";

const RADIANS_TO_DEGREES = 180 / Math.PI;
const DEGREES_TO_RADIANS = Math.PI / 180;

const ENTITY_TYPE_NAMES: Record<Entity["type"], { readonly singular: string; readonly plural: string }> = {
  image: { singular: "Bitmap image", plural: "bitmap images" },
  line: { singular: "Line", plural: "lines" },
  polyline: { singular: "Polyline", plural: "polylines" },
  rectangle: { singular: "Rectangle", plural: "rectangles" },
  circle: { singular: "Circle", plural: "circles" },
  arc: { singular: "Arc", plural: "arcs" },
  ellipse: { singular: "Ellipse", plural: "ellipses" },
  polygon: { singular: "Polygon", plural: "polygons" },
  quadrant: { singular: "Quadrant", plural: "quadrants" },
  semicircle: { singular: "Semi-circle", plural: "semi-circles" },
  segment: { singular: "Segment", plural: "segments" },
  star: { singular: "Star", plural: "stars" },
  cloud: { singular: "Cloud", plural: "clouds" },
  text: { singular: "Text", plural: "text objects" },
  dimension: { singular: "Dimension", plural: "dimensions" },
  leader: { singular: "Leader", plural: "leaders" },
};

interface NumericFieldProps {
  readonly label: string;
  readonly value: number | null;
  readonly suffix?: string;
  readonly min?: number;
  readonly disabled?: boolean;
  readonly onCommit: (value: number) => void;
}

function NumericField({ label, value, suffix, min, disabled, onCommit }: NumericFieldProps) {
  const formatted = value === null ? "" : Number(value.toFixed(4)).toString();
  const [draft, setDraft] = useState(formatted);
  const [error, setError] = useState<string | null>(null);
  const cancelBlurRef = useRef(false);
  useEffect(() => {
    setDraft(formatted);
    setError(null);
  }, [formatted]);

  const commit = () => {
    if (cancelBlurRef.current) {
      cancelBlurRef.current = false;
      return;
    }
    if (draft.trim() === "") {
      setError("Enter a numeric value.");
      return;
    }
    const parsed = Number(draft);
    if (!Number.isFinite(parsed)) {
      setError("Enter a valid number.");
      return;
    }
    if (min !== undefined && parsed < min) {
      const minimum = suffix === "°" || suffix === "%" ? `${min}${suffix}` : `${min}${suffix ? ` ${suffix}` : ""}`;
      setError(`${label} must be ${minimum} or greater.`);
      return;
    }
    setError(null);
    if (value === null || Math.abs(parsed - value) > 1e-9) onCommit(parsed);
  };

  return (
    <label className="property-field">
      <span>{label}</span>
      <span className="property-input-wrap">
        <input
          type="number"
          value={draft}
          min={min}
          disabled={disabled}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `property-error-${label.replace(/\s+/g, "-").toLowerCase()}` : undefined}
          placeholder={value === null ? "Mixed" : undefined}
          onChange={(event) => {
            setDraft(event.target.value);
            if (error) setError(null);
          }}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") {
              cancelBlurRef.current = true;
              setDraft(formatted);
              setError(null);
              event.currentTarget.blur();
            }
          }}
        />
        {suffix && <small>{suffix}</small>}
      </span>
      {error && <span className="property-field-error" id={`property-error-${label.replace(/\s+/g, "-").toLowerCase()}`} role="alert">{error}</span>}
    </label>
  );
}

function TextField({ label, value, disabled, live = false, onCommit }: {
  readonly label: string;
  readonly value: string;
  readonly disabled?: boolean;
  readonly live?: boolean;
  readonly onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <label className="property-field property-text-field">
      <span>{label}</span>
      <span className="property-input-wrap">
        <input
          type="text"
          value={draft}
          disabled={disabled}
          onChange={(event) => {
            const next = event.target.value;
            setDraft(next);
            if (live && next !== value) onCommit(next);
          }}
          onBlur={() => { if (!live && draft !== value) onCommit(draft); }}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") { setDraft(value); event.currentTarget.blur(); }
          }}
        />
      </span>
    </label>
  );
}

function ColorField({ label, value, fallback, emptyLabel, disabled, canClear, clearLabel, onChange, onClear }: {
  readonly label: string;
  readonly value: string | null;
  readonly fallback: string;
  readonly emptyLabel: string;
  readonly disabled?: boolean;
  readonly canClear: boolean;
  readonly clearLabel: string;
  readonly onChange: (value: string) => void;
  readonly onClear: () => void;
}) {
  const color = value && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
  return (
    <div className="property-color-field">
      <label>
        <span>{label}</span>
        <span className="property-color-control">
          <input
            type="color"
            aria-label={label}
            value={color}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value)}
          />
          <span>{value ? value.toUpperCase() : emptyLabel}</span>
        </span>
      </label>
      <button type="button" disabled={disabled || !canClear} onClick={onClear}>{clearLabel}</button>
    </div>
  );
}

function CollapsiblePropertySection({
  id,
  title,
  expanded,
  onToggle,
  children,
}: {
  readonly id: string;
  readonly title: string;
  readonly expanded: boolean;
  readonly onToggle: () => void;
  readonly children: ReactNode;
}) {
  const contentId = `property-section-${id}`;
  return (
    <section className={`property-section ${expanded ? "is-expanded" : "is-collapsed"}`}>
      <button
        className="property-section-toggle"
        type="button"
        aria-expanded={expanded}
        aria-controls={contentId}
        onClick={onToggle}
      >
        <span className="property-section-title">{title}</span>
        <ChevronDown size={15} aria-hidden="true" />
      </button>
      <div className="property-section-content" id={contentId} hidden={!expanded}>{children}</div>
    </section>
  );
}

function entityAngle(entity: Entity): number | null {
  switch (entity.type) {
    case "image": return Math.atan2(entity.right.y - entity.origin.y, entity.right.x - entity.origin.x);
    case "line":
      return Math.atan2(entity.end.y - entity.start.y, entity.end.x - entity.start.x);
    case "polyline":
    case "cloud": {
      const first = entity.points[0];
      const second = entity.points[1];
      return first && second ? Math.atan2(second.y - first.y, second.x - first.x) : null;
    }
    case "ellipse":
    case "polygon":
    case "star":
      return entity.rotation;
    case "arc":
    case "semicircle":
    case "segment":
      return entity.startAngle;
    case "quadrant":
      return (entity.quadrantIndex - 1) * Math.PI / 2;
    case "rectangle":
      return 0;
    case "circle":
    case "text":
      return null;
    case "dimension":
      return Math.atan2(entity.endPoint.y - entity.startPoint.y, entity.endPoint.x - entity.startPoint.x);
    case "leader":
      return Math.atan2(entity.elbowPoint.y - entity.arrowPoint.y, entity.elbowPoint.x - entity.arrowPoint.x);
  }
}

function entityRadius(entity: Entity): number | null {
  switch (entity.type) {
    case "circle":
    case "arc":
    case "polygon":
    case "quadrant":
    case "semicircle":
    case "segment":
      return entity.radius;
    case "star":
      return entity.outerRadius;
    default:
      return null;
  }
}

function commonValue<T>(entities: readonly Entity[], value: (entity: Entity) => T): T | null {
  if (entities.length === 0) return null;
  const first = value(entities[0]!);
  return entities.every((entity) => value(entity) === first) ? first : null;
}

function replaceProperties(
  before: readonly Entity[],
  after: readonly Entity[],
  label: string,
): void {
  if (before.length === 0 || after.length !== before.length) return;
  executeCommand(new UpdateEntitiesCommand(before, after, label));
}

export function PropertyInspector() {
  const position = useVectorStore((state) => state.panelPositions.properties);
  const setPanelPosition = useVectorStore((state) => state.setPanelPosition);
  const togglePanel = useVectorStore((state) => state.togglePanel);
  const nodeEditSelection = useVectorStore((state) => state.nodeEditSelection);
  const setNodeEditSelection = useVectorStore((state) => state.setNodeEditSelection);
  const fillBucketColor = useVectorStore((state) => state.fillBucketColor);
  const setFillBucketColor = useVectorStore((state) => state.setFillBucketColor);
  const dragControls = useDragControls();
  const [expandedSections, setExpandedSections] = useState({
    geometry: true,
    appearance: true,
    node: true,
    layer: true,
    operation: true,
  });
  const toggleSection = (section: keyof typeof expandedSections) => {
    setExpandedSections((current) => ({ ...current, [section]: !current[section] }));
  };
  const document = useSyncExternalStore(
    (onStoreChange) => documentModel.subscribe(() => onStoreChange()),
    () => documentModel.getDocument(),
    () => documentModel.getDocument(),
  );
  const selected = useMemo(
    () => [...document.selection]
      .map((id) => document.entities.get(id))
      .filter((entity): entity is Entity => Boolean(entity)),
    [document],
  );
  const bounds = useMemo(() => getSelectionBounds(selected), [selected]);
  const onDragEnd = (_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    setPanelPosition("properties", {
      x: position.x + info.offset.x,
      y: position.y + info.offset.y,
    });
  };

  if (!bounds || selected.length === 0) {
    return (
    <motion.aside
      id="properties-panel"
      className="property-inspector surface is-empty"
        aria-label="Properties"
        style={{ x: position.x, y: position.y }}
        initial={{ opacity: 0, scale: .98 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: .98 }}
        transition={{ type: "spring", stiffness: 400, damping: 32 }}
        drag
        dragControls={dragControls}
        dragListener={false}
        dragMomentum={false}
        dragElastic={0}
        onDragEnd={onDragEnd}
        onPointerDown={(event) => {
          event.stopPropagation();
          if ((event.target as Element).closest(".drag-handle")) dragControls.start(event);
        }}
      >
        <header className="drag-handle">
          <div><span className="eyebrow">Inspector</span><h2>Properties</h2></div>
          <Tooltip content="Close panel" placement="left"><button className="panel-close" type="button" onPointerDown={(event) => event.stopPropagation()} onClick={() => togglePanel("properties", false)} aria-label="Close panel"><X size={18} /></button></Tooltip>
        </header>
        <div className="property-empty"><SlidersHorizontal size={22} /><strong>No selection</strong><p>Select an object to inspect and edit its properties.</p></div>
      </motion.aside>
    );
  }

  const layersById = new Map(document.layers.map((layer) => [layer.id, layer]));
  const editable = selected.every((entity) => !entity.locked && !layersById.get(entity.layerId)?.locked);
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  const single = selected.length === 1 ? selected[0]! : null;
  const selectedNode = single?.type === "polyline" && nodeEditSelection?.entityId === single.id
    ? nodeEditSelection
    : null;
  const radius = single ? entityRadius(single) : null;
  const angle = single ? entityAngle(single) : 0;
  const layerId = commonValue(selected, (entity) => entity.layerId);
  const intent = commonValue(selected, (entity) => entity.intent);
  const fillColor = commonValue(selected, (entity) => entity.style.fillColor);
  const lineColor = commonValue(selected, (entity) => entity.style.strokeColor);
  const lineColorsMixed = selected.some((entity) => entity.style.strokeColor !== selected[0]!.style.strokeColor);
  const lineColorFallback = layersById.get(selected[0]!.layerId)?.color ?? "#64748b";
  const allVectorLines = selected.every((entity) => entity.type !== "image" && entity.type !== "text");
  const allClosedShapes = selected.every((entity) => entityToClosedPath(entity) !== null);
  const commonType = commonValue(selected, (entity) => entity.type);
  const inspectorTitle = commonType
    ? selected.length === 1
      ? ENTITY_TYPE_NAMES[commonType].singular
      : `${selected.length} ${ENTITY_TYPE_NAMES[commonType].plural}`
    : `${selected.length} mixed objects`;
  const updatePosition = (axis: "x" | "y", value: number) => {
    const delta = axis === "x"
      ? { x: value - bounds.minX, y: 0 }
      : { x: 0, y: value - bounds.minY };
    replaceProperties(selected, translateEntities(selected, delta), `Set ${axis.toUpperCase()} position`);
  };

  const updateDimension = (axis: "width" | "height", value: number) => {
    if (value <= 0) return;
    const after = axis === "width"
      ? scaleEntities(selected, bounds, "e", { x: bounds.minX + value, y: (bounds.minY + bounds.maxY) / 2 })
      : scaleEntities(selected, bounds, "n", { x: (bounds.minX + bounds.maxX) / 2, y: bounds.minY + value });
    replaceProperties(selected, after, `Set ${axis}`);
  };

  const updateRotation = (degrees: number) => {
    const current = (angle ?? 0) * RADIANS_TO_DEGREES;
    const center = { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
    replaceProperties(
      selected,
      rotateEntities(selected, center, (degrees - current) * DEGREES_TO_RADIANS),
      "Set rotation",
    );
  };

  const updateRadius = (value: number) => {
    if (!single || value <= 0) return;
    let after: Entity;
    switch (single.type) {
      case "circle":
      case "arc":
      case "polygon":
      case "quadrant":
      case "semicircle":
      case "segment":
        after = { ...single, radius: value };
        break;
      case "star": {
        const ratio = single.outerRadius <= Number.EPSILON ? 0.45 : single.innerRadius / single.outerRadius;
        after = { ...single, outerRadius: value, innerRadius: value * ratio };
        break;
      }
      default:
        return;
    }
    replaceProperties([single], [after], "Set radius");
  };

  const updateAngle = (key: "startAngle" | "endAngle", degrees: number) => {
    if (!single || !(key in single)) return;
    replaceProperties([single], [{ ...single, [key]: degrees * DEGREES_TO_RADIANS } as Entity], `Set ${key === "startAngle" ? "start" : "end"} angle`);
  };

  const updateDimensionFormatting = (
    property: "precision" | "arrowSize" | "prefix" | "suffix",
    value: number | string,
  ) => {
    if (single?.type !== "dimension") return;
    replaceProperties([single], [{ ...single, [property]: value }], `Set dimension ${property}`);
  };

  const updateLeaderText = (text: string) => {
    if (single?.type !== "leader") return;
    replaceProperties([single], [{ ...single, text }], "Set leader text");
  };

  const updateTextProperty = (
    property: "text" | "fontFamily" | "fontSize",
    value: string | number,
  ) => {
    if (single?.type !== "text") return;
    replaceProperties([single], [{ ...single, [property]: value }], `Set text ${property}`);
  };

  const updateFillColor = (color: string | null) => {
    replaceProperties(
      selected,
      selected.map((entity) => ({ ...entity, style: { ...entity.style, fillColor: color } })),
      color ? "Set fill color" : "Remove fill",
    );
    if (color) setFillBucketColor(color);
  };

  const updateLineColor = (color: string | null) => {
    if (selected.every((entity) => entity.style.strokeColor === color)) return;
    replaceProperties(
      selected,
      selected.map((entity) => ({ ...entity, style: { ...entity.style, strokeColor: color } })),
      color ? "Set line color" : "Use layer line color",
    );
  };

  return (
    <motion.aside
      id="properties-panel"
      className="property-inspector surface"
      aria-label={`${inspectorTitle} properties`}
      style={{ x: position.x, y: position.y }}
      initial={{ opacity: 0, scale: .98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: .98 }}
      transition={{ type: "spring", stiffness: 400, damping: 32 }}
      drag
      dragControls={dragControls}
      dragListener={false}
      dragMomentum={false}
      dragElastic={0}
      onDragEnd={onDragEnd}
      onPointerDown={(event) => {
        event.stopPropagation();
        if ((event.target as Element).closest(".drag-handle")) dragControls.start(event);
      }}
    >
      <header className="drag-handle">
        <div><span className="eyebrow">Properties</span><h2>{inspectorTitle}</h2></div>
        <div className="property-header-actions">
          <span className={editable ? "property-editable" : "property-editable is-locked"}>{editable ? "Editable" : "Locked"}</span>
          <Tooltip content="Close panel" placement="left"><button className="panel-close" type="button" onPointerDown={(event) => event.stopPropagation()} onClick={() => togglePanel("properties", false)} aria-label="Close panel"><X size={18} /></button></Tooltip>
        </div>
      </header>
      <CollapsiblePropertySection id="geometry" title="Geometry" expanded={expandedSections.geometry} onToggle={() => toggleSection("geometry")}>
        <div className="property-grid">
          <NumericField label="X" value={bounds.minX} suffix={document.units} disabled={!editable} onCommit={(value) => updatePosition("x", value)} />
          <NumericField label="Y" value={bounds.minY} suffix={document.units} disabled={!editable} onCommit={(value) => updatePosition("y", value)} />
          <NumericField label="W" value={width} suffix={document.units} min={0.0001} disabled={!editable} onCommit={(value) => updateDimension("width", value)} />
          <NumericField label="H" value={height} suffix={document.units} min={0.0001} disabled={!editable} onCommit={(value) => updateDimension("height", value)} />
          {angle !== null && <NumericField label={selected.length > 1 ? "Rotate Δ" : "Rotation"} value={(angle ?? 0) * RADIANS_TO_DEGREES} suffix="°" disabled={!editable} onCommit={updateRotation} />}
          {radius !== null && <NumericField label="Radius" value={radius} suffix={document.units} min={0.0001} disabled={!editable} onCommit={updateRadius} />}
          {single && "startAngle" in single && <NumericField label="Start" value={single.startAngle * RADIANS_TO_DEGREES} suffix="°" disabled={!editable} onCommit={(value) => updateAngle("startAngle", value)} />}
          {single?.type === "arc" || single?.type === "segment" ? <NumericField label="End" value={single.endAngle * RADIANS_TO_DEGREES} suffix="°" disabled={!editable} onCommit={(value) => updateAngle("endAngle", value)} /> : null}
          {single?.type === "dimension" && <NumericField label="Precision" value={single.precision} min={0} disabled={!editable} onCommit={(value) => updateDimensionFormatting("precision", Math.min(8, Math.round(value)))} />}
          {single?.type === "dimension" && <NumericField label="Arrow" value={single.arrowSize} suffix={document.units} min={0.25} disabled={!editable} onCommit={(value) => updateDimensionFormatting("arrowSize", value)} />}
          {single?.type === "dimension" && <TextField label="Prefix" value={single.prefix} disabled={!editable} onCommit={(value) => updateDimensionFormatting("prefix", value)} />}
          {single?.type === "dimension" && <TextField label="Suffix" value={single.suffix} disabled={!editable} onCommit={(value) => updateDimensionFormatting("suffix", value)} />}
          {single?.type === "leader" && <TextField label="Text" value={single.text} disabled={!editable} onCommit={updateLeaderText} />}
          {single?.type === "text" && <TextField label="Text" value={single.text} disabled={!editable} live onCommit={(value) => updateTextProperty("text", value)} />}
          {single?.type === "text" && <NumericField label="Font size" value={single.fontSize} suffix={document.units} min={0.1} disabled={!editable} onCommit={(value) => updateTextProperty("fontSize", value)} />}
          {single?.type === "text" && (
            <label className="property-field property-text-field">
              <span>Font</span>
              <span className="property-input-wrap">
                <select value={single.fontFamily} disabled={!editable} onChange={(event) => updateTextProperty("fontFamily", event.target.value)}>
                  <option value="Roboto">Roboto</option>
                  <option value="Lora">Lora</option>
                  <option value="Roboto Mono">Roboto Mono</option>
                </select>
              </span>
            </label>
          )}
        </div>
      </CollapsiblePropertySection>
      {(allVectorLines || allClosedShapes) && (
        <CollapsiblePropertySection id="appearance" title="Appearance" expanded={expandedSections.appearance} onToggle={() => toggleSection("appearance")}>
          {allVectorLines && (
            <ColorField
              label="Line color"
              value={lineColor}
              fallback={lineColorFallback}
              emptyLabel={lineColorsMixed ? "Mixed" : "Layer color"}
              disabled={!editable}
              canClear={selected.some((entity) => entity.style.strokeColor !== null)}
              clearLabel="Use layer color"
              onChange={updateLineColor}
              onClear={() => updateLineColor(null)}
            />
          )}
          {allClosedShapes && (
            <ColorField
              label="Fill color"
              value={fillColor}
              fallback={fillBucketColor}
              emptyLabel="No fill"
              disabled={!editable}
              canClear={selected.some((entity) => entity.style.fillColor !== null)}
              clearLabel="Remove fill"
              onChange={updateFillColor}
              onClear={() => updateFillColor(null)}
            />
          )}
        </CollapsiblePropertySection>
      )}
      {selectedNode && (
        <CollapsiblePropertySection id="node" title={`Node type · ${selectedNode.vertexIndex + 1}`} expanded={expandedSections.node} onToggle={() => toggleSection("node")}>
          <div className="node-type-toggle" role="group" aria-label="Bézier node type">
            {(["corner", "smooth", "symmetric"] as const).map((nodeType) => (
              <button
                key={nodeType}
                type="button"
                className={selectedNode.nodeType === nodeType ? "is-active" : ""}
                aria-pressed={selectedNode.nodeType === nodeType}
                disabled={!editable}
                onClick={() => setNodeEditSelection({ ...selectedNode, nodeType })}
              >
                {nodeType[0]!.toUpperCase() + nodeType.slice(1)}
              </button>
            ))}
          </div>
          <p className="node-edit-hint">
            Double-click a segment to add a node · Delete removes it<br />
            Shift constrains movement · Alt breaks paired handles
          </p>
        </CollapsiblePropertySection>
      )}
      <CollapsiblePropertySection id="layer" title="Layer" expanded={expandedSections.layer} onToggle={() => toggleSection("layer")}>
        <div className="property-selects">
          <label><span className="sr-only">Layer</span><select aria-label="Layer" value={layerId ?? ""} disabled={!editable} onChange={(event) => replaceProperties(selected, selected.map((entity) => ({ ...entity, layerId: event.target.value })), "Reassign layer")}><option value="" disabled>Mixed</option>{document.layers.map((layer) => <option key={layer.id} value={layer.id}>{layer.name}</option>)}</select></label>
        </div>
      </CollapsiblePropertySection>
      <CollapsiblePropertySection id="operation" title="Operation" expanded={expandedSections.operation} onToggle={() => toggleSection("operation")}>
        <div className="property-selects">
          <label><span className="sr-only">Operation</span><select aria-label="Operation" value={intent ?? ""} disabled={!editable} onChange={(event) => { const next = event.target.value as ManufacturingIntent; replaceProperties(selected, selected.map((entity) => ({ ...entity, intent: next })), "Set operation"); }}><option value="" disabled>Mixed</option>{selected.every((entity) => entity.type === "image") ? <option value="raster">{MANUFACTURING_INTENT_LABELS.raster}</option> : <><option value="cut">{MANUFACTURING_INTENT_LABELS.cut}</option><option value="engrave">{MANUFACTURING_INTENT_LABELS.engrave}</option><option value="score">{MANUFACTURING_INTENT_LABELS.score}</option></>}{selected.every((entity) => entityToClosedPath(entity)) && <option value="pocket">{MANUFACTURING_INTENT_LABELS.pocket}</option>}<option value="construction">{MANUFACTURING_INTENT_LABELS.construction}</option></select></label>
        </div>
      </CollapsiblePropertySection>
    </motion.aside>
  );
}

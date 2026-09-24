import { importRasterImage } from "../io/rasterImport";
import { vectoraRenderColors } from "../design/vectoraRenderColors";
import { getAngleSnapDegrees } from "../geometry/Snapping";
import {
  type ComponentType,
  type KeyboardEvent,
  type SVGProps,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { AnimatePresence, motion, type PanInfo, useDragControls } from "framer-motion";
import {
  ArrowUpRight,
  Box,
  ChevronDown,
  Circle,
  CircleDashed,
  CircleHelp,
  Combine as WeldIcon,
  CornerDownLeft,
  Download,
  Diff as SubtractIcon,
  Eraser,
  Factory,
  FilePlus2,
  Folder,
  Image as BitmapIcon,
  Layers3,
  LayoutGrid,
  Minus,
  MousePointer2,
  PaintBucket,
  Pencil,
  Pentagon,
  Plus,
  RotateCcw,
  RotateCw,
  Save,
  Search,
  Settings2,
  Shapes,
  SlidersHorizontal,
  Square,
  SquaresExclude,
  SquaresIntersect,
  Type,
  WandSparkles,
  X,
} from "lucide-react";
import { VectorizerModal } from "./modals/VectorizerModal";
import { PreferencesModal } from "./modals/PreferencesModal";
import { RecoveryDialog } from "./modals/RecoveryDialog";
import { PropertyInspector } from "./panels/PropertyInspector";
import { CamPanel } from "./panels/CamPanel";
import { RasterPanel } from "./panels/RasterPanel";
import { MachineQuickStop } from "./panels/MachineControlPanel";
import { LayersPanel } from "./panels/LayersPanel";
import { ToastViewport, toast } from "./ui/Toast";
import { Tooltip } from "./ui/Tooltip";
import { NodeTypeMenu } from "./ui/NodeTypeMenu";
import { useCanvasEngine } from "../hooks/useCanvasEngine";
import { useObjectClipboard } from "../hooks/useObjectClipboard";
import { documentModel } from "../document/DocumentModel";
import type { Entity } from "../document/types";
import {
  AddEntitiesCommand,
  AddLayerCommand,
  DeleteLayerCommand,
  DeleteEntityCommand,
  ReplaceEntitySetCommand,
  UpdateEntitiesCommand,
  executeCommand,
  history,
  redo,
  undo,
} from "../document/History";
import {
  generateFlatpackBox,
  getFlatpackBoxLayoutSize,
  type FlatpackBoxDesign,
} from "../geometry/generators/boxBuilder";
import { generateGearWithHoles } from "../geometry/generators/gearGenerator";
import { generateLivingHinge, type LivingHingePattern } from "../geometry/generators/livingHinge";
import { generateMountingPlate, type MountingHoleLayout } from "../geometry/generators/mountingPlate";
import { applyBooleanOperation, type BooleanOperation } from "../geometry/operations/booleans";
import { closePolyline } from "../geometry/operations/closePath";
import { isJoinableOpenPath, joinPaths } from "../geometry/operations/join";
import { entityToClosedPath } from "../geometry/operations/pathConversion";
import { getLockedSelectionReason } from "../geometry/operations/operationSafety";
import type { NestingOptions, NestingProgress, NestingResult } from "../cam/nestingEngine";
import { exportDxf, parseDxf } from "../io/dxfSerializer";
import {
  filePersistence,
  parseVectoraDocument,
  type VectoraFileHandle,
} from "../io/filePersistence";
import { recoveryController } from "../recovery/recoveryController";
import { exportSvg, parseSvg } from "../io/svgParser";
import { useVectorStore, type ToolId } from "../store/useVectorStore";

type IconType = ComponentType<SVGProps<SVGSVGElement> & { size?: number; strokeWidth?: number }>;

const ThreePreviewModal = lazy(() => import("./modals/ThreePreviewModal").then((module) => ({
  default: module.ThreePreviewModal,
})));

function displayToolLabel(label: string, _tool: ToolId): string {
  return label;
}

const SHAPE_TOOLS: Array<{ id: ToolId; label: string; key: string; icon: IconType }> = [
  { id: "rectangle", label: "Rectangle", key: "R", icon: Square },
  { id: "circle", label: "Circle", key: "C", icon: Circle },
  { id: "ellipse", label: "Ellipse", key: "E", icon: Circle },
  { id: "polygon", label: "Polygon", key: "Y", icon: Pentagon },
  { id: "arc", label: "Arc", key: "A", icon: ArcIcon },
];

const DIMENSION_TOOLS: Array<{ id: ToolId; label: string; key: string; icon: IconType }> = [
  { id: "dimension", label: "Aligned dimension", key: "D", icon: DimensionIcon },
  { id: "linear-dimension", label: "Linear dimension", key: "", icon: DimensionIcon },
  { id: "radial-dimension", label: "Radial dimension", key: "", icon: RadialDimensionIcon },
  { id: "diameter-dimension", label: "Diameter dimension", key: "", icon: RadialDimensionIcon },
  { id: "leader", label: "Leader callout", key: "", icon: LeaderIcon },
];

const TOOL_LABELS: Record<ToolId, string> = {
  select: "Select",
  "node-edit": "Node edit",
  line: "Line",
  pen: "Polyline",
  freehand: "Freehand",
  erase: "Segment erase",
  fill: "Fill bucket",
  rectangle: "Rectangle",
  circle: "Circle",
  ellipse: "Ellipse",
  polygon: "Polygon",
  arc: "Arc",
  text: "Text",
  dimension: "Aligned dimension",
  "linear-dimension": "Linear dimension",
  "radial-dimension": "Radial dimension",
  "diameter-dimension": "Diameter dimension",
  leader: "Leader callout",
  measure: "Measure",
};

const TOOL_ICONS: Record<ToolId, IconType> = {
  select: MousePointer2,
  "node-edit": NodeEditIcon,
  line: ArrowUpRight,
  pen: PenLineIcon,
  freehand: Pencil,
  erase: Eraser,
  fill: PaintBucket,
  rectangle: Square,
  circle: Circle,
  ellipse: Circle,
  polygon: Pentagon,
  arc: ArcIcon,
  text: Type,
  dimension: DimensionIcon,
  "linear-dimension": DimensionIcon,
  "radial-dimension": RadialDimensionIcon,
  "diameter-dimension": RadialDimensionIcon,
  leader: LeaderIcon,
  measure: MeasureIcon,
};

const TOOL_SHORTCUTS: Record<ToolId, string> = {
  select: "V",
  "node-edit": "N",
  line: "L",
  pen: "P",
  freehand: "B",
  erase: "X",
  fill: "G",
  rectangle: "R",
  circle: "C",
  ellipse: "E",
  polygon: "Y",
  arc: "A",
  text: "F",
  dimension: "D",
  "linear-dimension": "—",
  "radial-dimension": "—",
  "diameter-dimension": "—",
  leader: "—",
  measure: "⇧M",
};

type CommandItem = {
  id: string;
  label: string;
  description: string;
  key: string;
  icon: IconType;
  tool?: ToolId;
  action?: "preferences" | "layers" | "properties" | "generators" | "cam" | "raster" | "vectorizer" | "preview3d" | "nest" | "help";
};

const COMMANDS: CommandItem[] = [
  { id: "select", label: "Select", description: "Select, move, scale, and rotate geometry", key: "V", icon: MousePointer2, tool: "select" },
  { id: "node-edit", label: "Node edit", description: "Edit shape, line, and polyline anchors or Bézier handles", key: "N", icon: NodeEditIcon, tool: "node-edit" },
  { id: "line", label: "Line", description: "Draw a straight precision line", key: "L", icon: ArrowUpRight, tool: "line" },
  { id: "pen", label: "Polyline", description: "Draw connected line segments", key: "P", icon: PenLineIcon, tool: "pen" },
  { id: "freehand", label: "Freehand", description: "Drag to draw a freehand path; release to finish", key: "B", icon: Pencil, tool: "freehand" },
  { id: "erase", label: "Segment erase", description: "Erase one hovered line or curve segment", key: "X", icon: Eraser, tool: "erase" },
  { id: "fill", label: "Fill bucket", description: "Apply the selected colour inside a closed shape", key: "G", icon: PaintBucket, tool: "fill" },
  { id: "rectangle", label: "Rectangle", description: "Draw a parametric rectangle", key: "R", icon: Square, tool: "rectangle" },
  { id: "circle", label: "Circle", description: "Draw from centre and radius", key: "C", icon: Circle, tool: "circle" },
  { id: "ellipse", label: "Ellipse", description: "Draw an elliptical profile", key: "E", icon: Circle, tool: "ellipse" },
  { id: "polygon", label: "Polygon", description: "Draw a regular polygon", key: "Y", icon: Pentagon, tool: "polygon" },
  { id: "arc", label: "Arc", description: "Draw an arc from centre and endpoints", key: "A", icon: ArcIcon, tool: "arc" },
  { id: "text", label: "Text", description: "Place editable live text, then convert it to machinable paths", key: "F", icon: Type, tool: "text" },
  { id: "dimension", label: "Aligned dimension", description: "Pick two snap points, then place a parametric dimension", key: "D", icon: DimensionIcon, tool: "dimension" },
  { id: "linear-dimension", label: "Linear dimension", description: "Create a horizontal or vertical projected dimension", key: "", icon: DimensionIcon, tool: "linear-dimension" },
  { id: "radial-dimension", label: "Radial dimension", description: "Annotate the radius of a circle or arc", key: "", icon: RadialDimensionIcon, tool: "radial-dimension" },
  { id: "diameter-dimension", label: "Diameter dimension", description: "Annotate the diameter of a circle or arc", key: "", icon: RadialDimensionIcon, tool: "diameter-dimension" },
  { id: "leader", label: "Leader callout", description: "Place an arrowed note with an elbow leader", key: "", icon: LeaderIcon, tool: "leader" },
  { id: "measure", label: "Measuring tape", description: "Measure distance, deltas, and angle without changing the document", key: "⇧ M", icon: MeasureIcon, tool: "measure" },
  { id: "generators", label: "Parametric generators", description: "Create gears, boxes, mounting plates, and living hinges", key: "", icon: WandSparkles, action: "generators" },
  { id: "cam", label: "Manufacture", description: "Prepare, simulate, and export machine toolpaths", key: "", icon: Factory, action: "cam" },
  { id: "raster", label: "Raster engrave", description: "Import bitmap images and configure direct laser engraving", key: "", icon: BitmapIcon, action: "raster" },
  { id: "vectorizer", label: "Trace to vector", description: "Convert PNG, JPEG, or WebP artwork into vectors", key: "", icon: RasterVectorIcon, action: "vectorizer" },
  { id: "preview3d", label: "3D preview", description: "Inspect extruded materials and exploded box assemblies", key: "", icon: Box, action: "preview3d" },
  { id: "nest", label: "Nest selection", description: "Arrange selected closed profiles efficiently on a sheet", key: "", icon: LayoutGrid, action: "nest" },
  { id: "preferences", label: "Preferences", description: "Configure snapping and grid spacing", key: "⌘ ,", icon: Settings2, action: "preferences" },
  { id: "layers", label: "Layers", description: "Manage document structure", key: "⌘ L", icon: Layers3, action: "layers" },
  { id: "properties", label: "Properties", description: "Inspect and edit the current selection", key: "", icon: SlidersHorizontal, action: "properties" },
  { id: "help", label: "Help and shortcuts", description: "Review drawing controls and keyboard shortcuts", key: "?", icon: CircleHelp, action: "help" },
];

function stopPointer(event: React.PointerEvent) {
  event.stopPropagation();
}

function VectoraLogo() {
  return (
    <div className="brand" aria-label="Vectora home">
      <span className="brand-mark" aria-hidden="true" />
      <span>vectora</span>
      <span className="version-badge">BETA</span>
    </div>
  );
}

type SupportedImport = ReturnType<typeof parseSvg> | ReturnType<typeof parseDxf>;

function applyImportedDocument(imported: SupportedImport, fileName: string): void {
  const fallbackTitle = fileName.replace(/\.(svg|dxf)$/i, "").trim();
  documentModel.replaceDocument({
    title: fallbackTitle || imported.title,
    units: imported.units,
    layers: imported.layers,
    entities: imported.entities,
  });
  history.clear();
  filePersistence.markImported();
  useVectorStore.getState().setActiveTool("select");
}

async function importCadFile(file: File, handle: VectoraFileHandle | null = null, beforeReplace?: () => void): Promise<boolean> {
  const extension = file.name.split(".").at(-1)?.toLowerCase();
  if (extension !== "vectora" && extension !== "svg" && extension !== "dxf") {
    toast.error("Vectora can currently open .vectora, SVG, and ASCII DXF files.");
    return false;
  }
  try {
    const source = await file.text();
    beforeReplace?.();
    if (extension === "vectora") {
      documentModel.replaceDocument(parseVectoraDocument(source));
      history.clear();
      filePersistence.markClean(file.name, handle);
      useVectorStore.getState().setActiveTool("select");
      return true;
    }
    const dxfImport = extension === "svg" ? undefined : parseDxf(source);
    const imported = dxfImport ?? parseSvg(source);
    if (dxfImport?.warnings.length) {
      toast.warning(`DXF import: ${dxfImport.warnings.join("\n")}`, 12000);
      if (!dxfImport.entities.length) return false;
    }
    applyImportedDocument(imported, file.name);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : "The file could not be imported.";
    toast.error(message);
    return false;
  }
}

const RASTER_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp"]);

function isRasterFile(file: File): boolean {
  const extension = file.name.split(".").at(-1)?.toLowerCase() ?? "";
  return RASTER_EXTENSIONS.has(extension) || ["image/png", "image/jpeg", "image/webp"].includes(file.type);
}

type FilePickerWindow = Window & {
  showOpenFilePicker?: (options: {
    multiple: boolean;
    types: readonly {
      description: string;
      accept: Readonly<Record<string, readonly string[]>>;
    }[];
  }) => Promise<readonly VectoraFileHandle[]>;
};

async function chooseCadFile(
  onFile: (file: File, handle: VectoraFileHandle | null) => void,
): Promise<void> {
  const picker = (window as FilePickerWindow).showOpenFilePicker;
  if (picker) {
    try {
      const handles = await picker({
        multiple: false,
        types: [{
          description: "CAD and image files",
          accept: {
            "application/vnd.vectora+json": [".vectora"],
            "image/svg+xml": [".svg"],
            "application/dxf": [".dxf"],
            "image/png": [".png"],
            "image/jpeg": [".jpg", ".jpeg"],
            "image/webp": [".webp"],
          },
        }],
      });
      const handle = handles[0];
      if (handle) onFile(await handle.getFile(), handle);
      return;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      // Browsers may expose the API but reject unsupported picker options.
    }
  }
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".vectora,.svg,.dxf,.png,.jpg,.jpeg,.webp,application/vnd.vectora+json,image/svg+xml,application/dxf,image/png,image/jpeg,image/webp";
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (file) onFile(file, null);
  }, { once: true });
  input.click();
}

function downloadText(source: string, fileName: string, mimeType: string): void {
  const url = URL.createObjectURL(new Blob([source], { type: `${mimeType};charset=utf-8` }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function exportCurrentDocument(format: "svg" | "dxf"): void {
  const documentSnapshot = documentModel.getDocument();
  const entities = [...documentSnapshot.entities.values()];
  if (entities.some((entity) => entity.type === "image" && (format === "svg" || entity.visible))) {
    toast.info("SVG and DXF cannot include embedded bitmaps. Save a .vectora file to keep the image, or use Raster engrave for machine output.", 8_000);
    return;
  }
  const safeTitle = documentSnapshot.title.trim().replace(/[^a-z0-9_-]+/gi, "-") || "vectora-drawing";
  try {
    if (format === "svg") {
      downloadText(exportSvg(documentSnapshot), `${safeTitle}.svg`, "image/svg+xml");
    } else {
      const source = exportDxf(documentSnapshot);
      downloadText(source, `${safeTitle}.dxf`, "application/dxf");
      if (entities.some((entity) => entity.visible && entity.style.fillColor)) {
        toast.warning("DXF exports outlines but not fill colors. Use SVG or .vectora to keep fills.", 8_000);
      }
    }
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "The drawing could not be exported.");
  }
}

function primaryShortcut(key: string, shift = false): string {
  return isMacPlatform() ? `${shift ? "⇧" : ""}⌘ ${key}` : `Ctrl${shift ? "+Shift" : ""}+${key}`;
}

function isMacPlatform(): boolean {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform);
}

function FileMenu({
  onNew,
  onOpen,
  onSave,
  onSaveAs,
}: {
  readonly onNew: () => void;
  readonly onOpen: () => void;
  readonly onSave: () => void;
  readonly onSaveAs: () => void;
}) {
  const open = useVectorStore((state) => state.fileMenuOpen);
  const setOpen = useVectorStore((state) => state.setFileMenuOpen);
  const historySnapshot = useSyncExternalStore(
    (onStoreChange) => history.subscribe(onStoreChange),
    () => history.getSnapshot(),
    () => history.getSnapshot(),
  );
  const persistence = useSyncExternalStore(
    filePersistence.subscribe,
    filePersistence.getSnapshot,
    filePersistence.getSnapshot,
  );

  const items: Array<{
    icon: IconType;
    label: string;
    shortcut: string;
    separator?: boolean;
    disabled?: boolean;
    action?: () => void;
  }> = [
    { icon: FilePlus2, label: "New document", shortcut: primaryShortcut("N"), action: onNew },
    { icon: Folder, label: "Open file…", shortcut: primaryShortcut("O"), action: onOpen },
    { separator: true, icon: RotateCcw, label: historySnapshot.undoLabel ? `Undo ${historySnapshot.undoLabel}` : "Undo", shortcut: primaryShortcut("Z"), disabled: !historySnapshot.canUndo, action: undo },
    { icon: RotateCw, label: historySnapshot.redoLabel ? `Redo ${historySnapshot.redoLabel}` : "Redo", shortcut: primaryShortcut("Z", true), disabled: !historySnapshot.canRedo, action: redo },
    { separator: true, icon: Save, label: persistence.dirty ? "Save changes" : "Save", shortcut: primaryShortcut("S"), action: onSave },
    { icon: Save, label: "Save as…", shortcut: primaryShortcut("S", true), action: onSaveAs },
    { separator: true, icon: Download, label: "Export SVG", shortcut: primaryShortcut("E"), action: () => exportCurrentDocument("svg") },
    { icon: Download, label: "Export DXF", shortcut: primaryShortcut("E", true), action: () => exportCurrentDocument("dxf") },
  ];

  return (
    <div className="file-menu-wrap">
      <Tooltip content="File menu" placement="bottom">
        <button
          className={`icon-button file-button ${open ? "is-active" : ""}`}
          aria-label="File menu"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <Folder size={19} />
          <ChevronDown className="file-chevron" size={12} />
        </button>
      </Tooltip>
      <AnimatePresence>
        {open && (
          <motion.div
            className="file-menu surface"
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 440, damping: 32 }}
          >
            <div className="popover-eyebrow">File</div>
            {items.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  className={item.separator ? "menu-row has-separator" : "menu-row"}
                  key={item.label}
                  disabled={item.disabled}
                  onClick={() => {
                    item.action?.();
                    setOpen(false);
                  }}
                >
                  <Icon size={18} />
                  <span>{item.label}</span>
                  <kbd>{item.shortcut}</kbd>
                </button>
              );
            })}
            <p className="file-menu-note">SVG keeps fills; DXF omits them. Embedded bitmaps need a .vectora save or Raster engrave.</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function TopBar({
  camOpen,
  rasterOpen,
  vectorizerOpen,
  onOpenRaster,
  onOpenVectorizer,
  preview3dOpen,
  onOpenCam,
  onOpenThreePreview,
  onOpenFile,
  onOpenPreferences,
  onFindTool,
  onOpenHelp,
  onNew,
  onSave,
  onSaveAs,
}: {
  readonly camOpen: boolean;
  readonly rasterOpen: boolean;
  readonly vectorizerOpen: boolean;
  readonly onOpenRaster: () => void;
  readonly onOpenVectorizer: () => void;
  readonly preview3dOpen: boolean;
  readonly onOpenCam: () => void;
  readonly onOpenThreePreview: () => void;
  readonly onOpenFile: () => void;
  readonly onOpenPreferences: () => void;
  readonly onFindTool: () => void;
  readonly onOpenHelp: () => void;
  readonly onNew: () => void;
  readonly onSave: () => void;
  readonly onSaveAs: () => void;
}) {
  const preferencesOpen = useVectorStore((state) => state.preferencesOpen);
  const commandPaletteOpen = useVectorStore((state) => state.commandPaletteOpen);
  return (
    <header className="topbar surface" onPointerDown={stopPointer}>
      <div className="topbar-start">
        <VectoraLogo />
        <span className="topbar-divider" />
        <FileMenu onNew={onNew} onOpen={onOpenFile} onSave={onSave} onSaveAs={onSaveAs} />
        <Tooltip content="Command search" shortcut={primaryShortcut("K")} placement="bottom">
          <button
            className={`icon-button topbar-action ${commandPaletteOpen ? "is-active" : ""}`}
            aria-label="Command search"
            aria-expanded={commandPaletteOpen}
            onClick={onFindTool}
          >
            <Search size={19} strokeWidth={1.8} />
          </button>
        </Tooltip>
        <span className="topbar-divider topbar-action-divider" />
        <Tooltip content="Raster engrave" placement="bottom">
          <button
            className={`icon-button topbar-action ${rasterOpen ? "is-active" : ""}`}
            aria-label="Raster engrave" aria-expanded={rasterOpen}
            onClick={onOpenRaster}
          >
            <BitmapIcon size={19} strokeWidth={1.8} />
          </button>
        </Tooltip>
        <Tooltip content="Trace to vector" placement="bottom">
          <button
            className={`icon-button topbar-action ${vectorizerOpen ? "is-active" : ""}`}
            aria-label="Trace to vector" aria-expanded={vectorizerOpen}
            onClick={onOpenVectorizer}
          >
            <RasterVectorIcon size={19} />
          </button>
        </Tooltip>
        <Tooltip content="3D preview" placement="bottom">
          <button
            className={`icon-button topbar-action ${preview3dOpen ? "is-active" : ""}`}
            aria-label="3D preview"
            aria-expanded={preview3dOpen}
            onClick={onOpenThreePreview}
          >
            <Box size={19} strokeWidth={1.8} />
          </button>
        </Tooltip>
        <Tooltip content="Manufacture" placement="bottom">
          <button
            className={`icon-button topbar-action ${camOpen ? "is-active" : ""}`}
            aria-label="Manufacture"
            aria-expanded={camOpen}
            onClick={onOpenCam}
          >
            <Factory size={18} strokeWidth={1.8} />
          </button>
        </Tooltip>
        <MachineQuickStop />
        <span className="topbar-divider topbar-action-divider" />
        <Tooltip content="Quick reference" shortcut="?" placement="bottom">
          <button
            className="icon-button topbar-action"
            aria-label="Quick reference"
            onClick={onOpenHelp}
          >
            <CircleHelp size={19} strokeWidth={1.8} />
          </button>
        </Tooltip>
        <Tooltip content="Preferences" shortcut={primaryShortcut(",")} placement="bottom">
          <button
            className={`icon-button topbar-action ${preferencesOpen ? "is-active" : ""}`}
            aria-label="Preferences"
            aria-expanded={preferencesOpen}
            onClick={onOpenPreferences}
          >
            <Settings2 size={19} strokeWidth={1.8} />
          </button>
        </Tooltip>
      </div>
    </header>
  );
}

function ToolButton({
  label,
  tool,
  icon: Icon,
  shortcut,
  onClick,
  highlighted,
  tooltipPlacement = "right",
  expanded,
  controls,
}: {
  label: string;
  tool?: ToolId;
  icon: IconType;
  shortcut?: string;
  onClick?: () => void;
  highlighted?: boolean;
  tooltipPlacement?: "left" | "right";
  expanded?: boolean;
  controls?: string;
}) {
  const activeTool = useVectorStore((state) => state.activeTool);
  const setActiveTool = useVectorStore((state) => state.setActiveTool);
  const isActive = highlighted ?? (tool ? activeTool === tool : false);
  const displayLabel = tool ? displayToolLabel(label, tool) : label;
  return (
    <Tooltip content={displayLabel} shortcut={shortcut} placement={tooltipPlacement}>
      <button
        className={`tool-button ${isActive ? "is-active" : ""}`}
        aria-label={displayLabel}
        aria-keyshortcuts={shortcut ? shortcut.replace(/\s+/g, "+") : undefined}
        aria-pressed={isActive}
        aria-expanded={expanded}
        aria-controls={controls}
        onClick={() => {
          if (tool) setActiveTool(tool);
          onClick?.();
        }}
      >
        <Icon size={20} strokeWidth={1.8} />
      </button>
    </Tooltip>
  );
}

function FillToolButton() {
  const active = useVectorStore((state) => state.activeTool === "fill");
  const color = useVectorStore((state) => state.fillBucketColor);
  const setFillBucketColor = useVectorStore((state) => state.setFillBucketColor);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuWrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!active) setMenuOpen(false);
  }, [active]);
  useEffect(() => {
    if (!menuOpen) return;
    const dismissOnOutsidePointer = (event: PointerEvent) => {
      if (!menuWrapRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const dismissOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("pointerdown", dismissOnOutsidePointer, true);
    document.addEventListener("keydown", dismissOnEscape);
    return () => {
      document.removeEventListener("pointerdown", dismissOnOutsidePointer, true);
      document.removeEventListener("keydown", dismissOnEscape);
    };
  }, [menuOpen]);
  return (
    <div ref={menuWrapRef} className="shape-trigger-wrap">
      <ToolButton
        icon={PaintBucket}
        label="Fill bucket"
        tool="fill"
        shortcut="G"
        expanded={menuOpen}
        controls="fill-tool-options"
        onClick={() => setMenuOpen((open) => !open)}
      />
      <AnimatePresence>
        {menuOpen && (
          <motion.div
            id="fill-tool-options"
            className="fill-tool-menu surface"
            initial={{ opacity: 0, x: -8, scale: 0.98 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: -6, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 450, damping: 34 }}
          >
            <div className="popover-eyebrow">Fill bucket</div>
            <label className="fill-tool-color">
              <input
                type="color"
                aria-label="Fill bucket color"
                value={color}
                onChange={(event) => setFillBucketColor(event.target.value)}
              />
              <span><strong>Fill color</strong><small>{color.toUpperCase()}</small></span>
            </label>
            <p>Click inside a closed shape to apply this color.</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ToolDock({
  onOpenGenerators,
}: {
  readonly onOpenGenerators: () => void;
}) {
  const selectMenuOpen = useVectorStore((state) => state.selectMenuOpen);
  const setSelectMenuOpen = useVectorStore((state) => state.setSelectMenuOpen);
  const lineMenuOpen = useVectorStore((state) => state.lineMenuOpen);
  const setLineMenuOpen = useVectorStore((state) => state.setLineMenuOpen);
  const shapeMenuOpen = useVectorStore((state) => state.shapeMenuOpen);
  const setShapeMenuOpen = useVectorStore((state) => state.setShapeMenuOpen);
  const activeTool = useVectorStore((state) => state.activeTool);
  const setActiveTool = useVectorStore((state) => state.setActiveTool);
  const [dimensionMenuOpen, setDimensionMenuOpen] = useState(false);
  const activeIsShape = SHAPE_TOOLS.some((shape) => shape.id === activeTool);
  const activeIsSelection = activeTool === "select" || activeTool === "node-edit";
  const activeIsLine = activeTool === "line" || activeTool === "pen" || activeTool === "freehand";
  const activeIsDimension = DIMENSION_TOOLS.some((tool) => tool.id === activeTool);

  return (
    <aside className="dock-wrap" onPointerDown={stopPointer}>
      <nav className="tool-dock surface" aria-label="Drawing tools">
        <div
          className="shape-trigger-wrap"
          onMouseEnter={() => setSelectMenuOpen(true)}
          onMouseLeave={() => setSelectMenuOpen(false)}
        >
          <ToolButton
            icon={activeTool === "node-edit" ? NodeEditIcon : MousePointer2}
            label="Selection tools"
            highlighted={selectMenuOpen || activeIsSelection}
            onClick={() => setSelectMenuOpen(!selectMenuOpen)}
          />
          <AnimatePresence>
            {selectMenuOpen && (
              <motion.div
                className="select-menu surface"
                initial={{ opacity: 0, x: -8, scale: 0.98 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: -6, scale: 0.98 }}
                transition={{ type: "spring", stiffness: 450, damping: 34 }}
              >
                <div className="popover-eyebrow">Select</div>
                <button
                  className={`shape-row ${activeTool === "select" ? "is-selected" : ""}`}
                  onClick={() => {
                    setActiveTool("select");
                    setSelectMenuOpen(false);
                  }}
                >
                  <MousePointer2 size={19} />
                  <span>Select</span>
                  <kbd>V</kbd>
                </button>
                <button
                  className={`shape-row ${activeTool === "node-edit" ? "is-selected" : ""}`}
                  onClick={() => {
                    setActiveTool("node-edit");
                    setSelectMenuOpen(false);
                  }}
                >
                  <NodeEditIcon size={19} />
                  <span>Node edit</span>
                  <kbd>N</kbd>
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <div
          className="shape-trigger-wrap"
          onMouseEnter={() => setLineMenuOpen(true)}
          onMouseLeave={() => setLineMenuOpen(false)}
        >
          <ToolButton
            icon={ArrowUpRight}
            label="Line tools"
            highlighted={lineMenuOpen || activeIsLine}
            onClick={() => setLineMenuOpen(!lineMenuOpen)}
          />
          <AnimatePresence>
            {lineMenuOpen && (
              <motion.div
                className="line-menu surface"
                initial={{ opacity: 0, x: -8, scale: 0.98 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: -6, scale: 0.98 }}
                transition={{ type: "spring", stiffness: 450, damping: 34 }}
              >
                <div className="popover-eyebrow">Lines</div>
                <button
                  className={`shape-row ${activeTool === "line" ? "is-selected" : ""}`}
                  onClick={() => {
                    setActiveTool("line");
                    setLineMenuOpen(false);
                  }}
                >
                  <ArrowUpRight size={19} />
                  <span>Line</span>
                  <kbd>L</kbd>
                </button>
                <button
                  className={`shape-row ${activeTool === "pen" ? "is-selected" : ""}`}
                  onClick={() => {
                    setActiveTool("pen");
                    setLineMenuOpen(false);
                  }}
                >
                  <PenLineIcon size={19} />
                  <span>{displayToolLabel("Polyline", "pen")}</span>
                  <kbd>P</kbd>
                </button>
                <button
                  className={`shape-row ${activeTool === "freehand" ? "is-selected" : ""}`}
                  onClick={() => {
                    setActiveTool("freehand");
                    setLineMenuOpen(false);
                  }}
                >
                  <Pencil size={19} />
                  <span>Freehand</span>
                  <kbd>B</kbd>
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <div
          className="shape-trigger-wrap"
          onMouseEnter={() => setShapeMenuOpen(true)}
          onMouseLeave={() => setShapeMenuOpen(false)}
        >
          <ToolButton
            icon={Shapes}
            label="Shape tools"
            highlighted={shapeMenuOpen || activeIsShape}
            onClick={() => setShapeMenuOpen(!shapeMenuOpen)}
          />
          <AnimatePresence>
            {shapeMenuOpen && (
              <motion.div
                className="shape-menu surface"
                initial={{ opacity: 0, x: -8, scale: 0.98 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: -6, scale: 0.98 }}
                transition={{ type: "spring", stiffness: 450, damping: 34 }}
              >
                <div className="popover-eyebrow">Shapes</div>
                {SHAPE_TOOLS.map((shape) => {
                  const Icon = shape.icon;
                  return (
                    <button
                      key={shape.id}
                      className={`shape-row ${activeTool === shape.id ? "is-selected" : ""}`}
                      onClick={() => {
                        setActiveTool(shape.id);
                        setShapeMenuOpen(false);
                      }}
                    >
                      <Icon size={19} />
                      <span>{displayToolLabel(shape.label, shape.id)}</span>
                      <kbd>{shape.key}</kbd>
                    </button>
                  );
                })}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <ToolButton icon={Type} label="Text" tool="text" shortcut="F" />
        <ToolButton icon={Eraser} label="Erase" tool="erase" shortcut="X" />
        <FillToolButton />
        <div
          className="shape-trigger-wrap"
          onMouseEnter={() => setDimensionMenuOpen(true)}
          onMouseLeave={() => setDimensionMenuOpen(false)}
        >
          <ToolButton
            icon={DimensionIcon}
            label="Dimension and callout tools"
            highlighted={dimensionMenuOpen || activeIsDimension}
            onClick={() => setDimensionMenuOpen((open) => !open)}
          />
          <AnimatePresence>
            {dimensionMenuOpen && (
              <motion.div
                className="dimension-menu surface"
                initial={{ opacity: 0, x: -8, scale: 0.98 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: -6, scale: 0.98 }}
                transition={{ type: "spring", stiffness: 450, damping: 34 }}
              >
                <div className="popover-eyebrow">Annotate</div>
                {DIMENSION_TOOLS.map((tool) => {
                  const Icon = tool.icon;
                  return (
                    <button
                      key={tool.id}
                      className={`shape-row ${activeTool === tool.id ? "is-selected" : ""}`}
                      onClick={() => {
                        setActiveTool(tool.id);
                        setDimensionMenuOpen(false);
                      }}
                    >
                      <Icon size={19} />
                      <span>{tool.label}</span>
                      <kbd>{tool.key}</kbd>
                    </button>
                  );
                })}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <ToolButton icon={MeasureIcon} label="Measuring tape" tool="measure" shortcut="Shift M" />
        <ToolButton icon={WandSparkles} label="Parametric generators" onClick={onOpenGenerators} />
      </nav>
    </aside>
  );
}

function UtilityDock() {
  const layersOpen = useVectorStore((state) => state.layersOpen);
  const propertiesOpen = useVectorStore((state) => state.propertiesOpen);
  const togglePanel = useVectorStore((state) => state.togglePanel);

  return (
    <aside className="right-dock-wrap" onPointerDown={stopPointer}>
      <nav className="tool-dock utility-dock surface" aria-label="Document panels">
        <ToolButton
          icon={Layers3}
          label="Layers"
          shortcut={primaryShortcut("L")}
          highlighted={layersOpen}
          tooltipPlacement="left"
          expanded={layersOpen}
          controls="layers-panel"
          onClick={() => togglePanel("layers")}
        />
        <span className="dock-divider" />
        <ToolButton
          icon={SlidersHorizontal}
          label="Properties"
          highlighted={propertiesOpen}
          tooltipPlacement="left"
          expanded={propertiesOpen}
          controls="properties-panel"
          onClick={() => togglePanel("properties")}
        />
      </nav>
    </aside>
  );
}

type GeneratorKind = "gear" | "box" | "plate" | "hinge";

function GeneratorNumber({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max?: number;
  readonly step?: number;
  readonly onChange: (value: number) => void;
}) {
  return (
    <label className="generator-field">
      <span>{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

function GeneratorModal({
  open,
  onClose,
  setPreview,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly setPreview: (entities: readonly Entity[]) => void;
}) {
  const [kind, setKind] = useState<GeneratorKind>("gear");
  const [toothCount, setToothCount] = useState(20);
  const [gearModule, setGearModule] = useState(2);
  const [pressureAngle, setPressureAngle] = useState(20);
  const [boreDiameter, setBoreDiameter] = useState(8);
  const [boltHoleCount, setBoltHoleCount] = useState(0);
  const [boltHoleDiameter, setBoltHoleDiameter] = useState(4);
  const [boltCircleDiameter, setBoltCircleDiameter] = useState(24);
  const [boxWidth, setBoxWidth] = useState(80);
  const [boxDepth, setBoxDepth] = useState(60);
  const [boxHeight, setBoxHeight] = useState(50);
  const [materialThickness, setMaterialThickness] = useState(3);
  const [fingerWidth, setFingerWidth] = useState(10);
  const [panelGap, setPanelGap] = useState(10);
  const [boxDesign, setBoxDesign] = useState<FlatpackBoxDesign>("closed");
  const [dividerCount, setDividerCount] = useState(2);
  const [plateWidth, setPlateWidth] = useState(100);
  const [plateHeight, setPlateHeight] = useState(70);
  const [plateCornerRadius, setPlateCornerRadius] = useState(6);
  const [plateHoleLayout, setPlateHoleLayout] = useState<MountingHoleLayout>("four");
  const [plateHoleDiameter, setPlateHoleDiameter] = useState(5);
  const [plateHoleInset, setPlateHoleInset] = useState(10);
  const [plateCenterHoleDiameter, setPlateCenterHoleDiameter] = useState(20);
  const [hingeWidth, setHingeWidth] = useState(120);
  const [hingeHeight, setHingeHeight] = useState(80);
  const [hingeSpacing, setHingeSpacing] = useState(8);
  const [hingeCutLength, setHingeCutLength] = useState(28);
  const [hingeEdgeInset, setHingeEdgeInset] = useState(4);
  const [hingePattern, setHingePattern] = useState<LivingHingePattern>("straight");

  const generated = useMemo((): { entities: readonly Entity[]; error: string | null } => {
    if (!open) return { entities: [], error: null };
    const document = documentModel.getDocument();
    const layer = document.layers.find((candidate) => candidate.id === document.activeLayerId);
    if (!layer?.visible || layer.locked) {
      return { entities: [], error: "The active layer must be visible and unlocked." };
    }
    const viewport = useVectorStore.getState().viewport;
    const center = { x: -viewport.x / viewport.zoom, y: viewport.y / viewport.zoom };
    const entityOptions = { layerId: layer.id, intent: layer.intent } as const;
    try {
      if (kind === "gear") {
        return {
          entities: generateGearWithHoles({
            ...entityOptions,
            toothCount,
            module: gearModule,
            pressureAngle,
            center,
            boreDiameter,
            boltHoleCount,
            boltHoleDiameter,
            boltCircleDiameter,
          }),
          error: null,
        };
      }
      if (kind === "box") {
        const boxOptions = {
          ...entityOptions,
          width: boxWidth,
          depth: boxDepth,
          height: boxHeight,
          materialThickness,
          fingerWidth,
          panelGap,
          design: boxDesign,
          dividerCount,
        } as const;
        const layout = getFlatpackBoxLayoutSize(boxOptions);
        const panels = generateFlatpackBox({
          ...boxOptions,
          origin: { x: center.x - layout.width / 2, y: center.y - layout.height / 2 },
        });
        return { entities: panels, error: null };
      }
      if (kind === "plate") {
        return {
          entities: generateMountingPlate({
            ...entityOptions,
            center,
            width: plateWidth,
            height: plateHeight,
            cornerRadius: plateCornerRadius,
            mountingHoleLayout: plateHoleLayout,
            mountingHoleDiameter: plateHoleDiameter,
            holeInset: plateHoleInset,
            centerHoleDiameter: plateCenterHoleDiameter,
          }),
          error: null,
        };
      }
      return {
        entities: generateLivingHinge({
          ...entityOptions,
          bounds: {
            minX: center.x - hingeWidth / 2,
            minY: center.y - hingeHeight / 2,
            maxX: center.x + hingeWidth / 2,
            maxY: center.y + hingeHeight / 2,
          },
          pattern: hingePattern,
          spacing: hingeSpacing,
          cutLength: hingeCutLength,
          edgeInset: hingeEdgeInset,
        }),
        error: null,
      };
    } catch (error) {
      return {
        entities: [],
        error: error instanceof Error ? error.message : "The generator configuration is invalid.",
      };
    }
  }, [
    boltCircleDiameter,
    boltHoleCount,
    boltHoleDiameter,
    boreDiameter,
    boxDepth,
    boxDesign,
    boxHeight,
    boxWidth,
    fingerWidth,
    gearModule,
    hingeCutLength,
    hingeEdgeInset,
    hingeHeight,
    hingePattern,
    hingeSpacing,
    hingeWidth,
    kind,
    materialThickness,
    open,
    panelGap,
    plateCenterHoleDiameter,
    plateCornerRadius,
    plateHeight,
    plateHoleDiameter,
    plateHoleInset,
    plateHoleLayout,
    plateWidth,
    pressureAngle,
    dividerCount,
    toothCount,
  ]);

  useEffect(() => {
    setPreview(generated.entities);
    return () => setPreview([]);
  }, [generated.entities, setPreview]);

  const close = () => {
    setPreview([]);
    onClose();
  };

  const commit = () => {
    if (generated.entities.length === 0 || generated.error) return;
    const label = kind === "gear"
      ? "Generate gear"
      : kind === "box"
        ? "Generate flatpack box"
        : kind === "plate"
          ? "Generate mounting plate"
          : "Generate living hinge";
    executeCommand(new AddEntitiesCommand(generated.entities, label));
    close();
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="generator-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={close}
        >
          <motion.section
            className="generator-modal surface"
            role="dialog"
            aria-modal="true"
            aria-label="Parametric generators"
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 390, damping: 32 }}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={stopPointer}
          >
            <header className="generator-head">
              <div><span className="eyebrow">Parametric</span><h2>Generators</h2></div>
              <Tooltip content="Close panel" placement="left"><button className="panel-close" onClick={close} aria-label="Close panel"><X size={20} /></button></Tooltip>
            </header>
            <div className="generator-tabs" role="tablist">
              {(["gear", "box", "plate", "hinge"] as const).map((candidate) => (
                <button
                  key={candidate}
                  role="tab"
                  aria-selected={kind === candidate}
                  className={kind === candidate ? "is-active" : ""}
                  onClick={() => setKind(candidate)}
                >
                  {candidate === "gear" ? "Gear" : candidate === "box" ? "Flatpack box" : candidate === "plate" ? "Mounting plate" : "Living hinge"}
                </button>
              ))}
            </div>
            <div className="generator-grid">
              {kind === "gear" && (
                <>
                  <GeneratorNumber label="Teeth" value={toothCount} min={6} onChange={setToothCount} />
                  <GeneratorNumber label="Module" value={gearModule} min={0.1} step={0.1} onChange={setGearModule} />
                  <GeneratorNumber label="Pressure angle" value={pressureAngle} min={1} step={1} onChange={setPressureAngle} />
                  <GeneratorNumber label="Centre bore diameter" value={boreDiameter} min={0} step={0.5} onChange={setBoreDiameter} />
                  <label className="generator-field">
                    <span>Bolt holes</span>
                    <select value={boltHoleCount} onChange={(event) => setBoltHoleCount(Number(event.target.value))}>
                      {[0, 3, 4, 5, 6, 8].map((count) => <option key={count} value={count}>{count === 0 ? "None" : `${count} holes`}</option>)}
                    </select>
                  </label>
                  {boltHoleCount > 0 && <>
                    <GeneratorNumber label="Bolt-hole diameter" value={boltHoleDiameter} min={0.1} step={0.5} onChange={setBoltHoleDiameter} />
                    <GeneratorNumber label="Bolt-circle diameter" value={boltCircleDiameter} min={0.1} step={0.5} onChange={setBoltCircleDiameter} />
                  </>}
                </>
              )}
              {kind === "box" && (
                <>
                  <label className="generator-field generator-field-wide">
                    <span>Box design</span>
                    <select value={boxDesign} onChange={(event) => setBoxDesign(event.target.value as FlatpackBoxDesign)}>
                      <option value="closed">Closed six-panel box</option>
                      <option value="open-top">Open-top box</option>
                      <option value="divider-tray">Divided tray</option>
                    </select>
                  </label>
                  <GeneratorNumber label="Width" value={boxWidth} min={1} onChange={setBoxWidth} />
                  <GeneratorNumber label="Depth" value={boxDepth} min={1} onChange={setBoxDepth} />
                  <GeneratorNumber label="Height" value={boxHeight} min={1} onChange={setBoxHeight} />
                  <GeneratorNumber label="Material" value={materialThickness} min={0.1} step={0.1} onChange={setMaterialThickness} />
                  <GeneratorNumber label="Finger width" value={fingerWidth} min={0.5} step={0.5} onChange={setFingerWidth} />
                  <GeneratorNumber label="Panel gap" value={panelGap} min={0.1} step={0.5} onChange={setPanelGap} />
                  {boxDesign === "divider-tray" && <GeneratorNumber label="Internal dividers" value={dividerCount} min={1} max={12} onChange={setDividerCount} />}
                </>
              )}
              {kind === "plate" && (
                <>
                  <GeneratorNumber label="Width" value={plateWidth} min={1} onChange={setPlateWidth} />
                  <GeneratorNumber label="Height" value={plateHeight} min={1} onChange={setPlateHeight} />
                  <GeneratorNumber label="Corner radius" value={plateCornerRadius} min={0} step={0.5} onChange={setPlateCornerRadius} />
                  <GeneratorNumber label="Centre-hole diameter" value={plateCenterHoleDiameter} min={0} step={0.5} onChange={setPlateCenterHoleDiameter} />
                  <label className="generator-field">
                    <span>Mounting holes</span>
                    <select value={plateHoleLayout} onChange={(event) => setPlateHoleLayout(event.target.value as MountingHoleLayout)}>
                      <option value="none">None</option>
                      <option value="two">Two holes</option>
                      <option value="four">Four holes</option>
                    </select>
                  </label>
                  {plateHoleLayout !== "none" && <>
                    <GeneratorNumber label="Mounting-hole diameter" value={plateHoleDiameter} min={0.1} step={0.5} onChange={setPlateHoleDiameter} />
                    <GeneratorNumber label="Hole inset" value={plateHoleInset} min={0.1} step={0.5} onChange={setPlateHoleInset} />
                  </>}
                </>
              )}
              {kind === "hinge" && (
                <>
                  <label className="generator-field">
                    <span>Pattern</span>
                    <select value={hingePattern} onChange={(event) => setHingePattern(event.target.value as LivingHingePattern)}>
                      <option value="straight">Straight</option>
                      <option value="lattice">Lattice</option>
                      <option value="wave">Wave</option>
                    </select>
                  </label>
                  <GeneratorNumber label="Width" value={hingeWidth} min={1} onChange={setHingeWidth} />
                  <GeneratorNumber label="Height" value={hingeHeight} min={1} onChange={setHingeHeight} />
                  <GeneratorNumber label="Spacing" value={hingeSpacing} min={0.5} step={0.5} onChange={setHingeSpacing} />
                  <GeneratorNumber label="Cut length" value={hingeCutLength} min={0.5} step={0.5} onChange={setHingeCutLength} />
                  <GeneratorNumber label="Edge margin" value={hingeEdgeInset} min={0} step={0.5} onChange={setHingeEdgeInset} />
                </>
              )}
            </div>
            <div className={generated.error ? "generator-note is-error" : "generator-note"}>
              {generated.error ?? `${generated.entities.length} ${generated.entities.length === 1 ? "path" : "paths"} · live preview`}
            </div>
            <footer className="generator-actions">
              <button onClick={close}>Cancel</button>
              <button className="primary" disabled={Boolean(generated.error) || generated.entities.length === 0} onClick={commit}>Add to document</button>
            </footer>
          </motion.section>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function NestingModal({ open, onClose }: { readonly open: boolean; readonly onClose: () => void }) {
  const document = useSyncExternalStore(
    (onStoreChange) => documentModel.subscribe(() => onStoreChange()),
    () => documentModel.getDocument(),
    () => documentModel.getDocument(),
  );
  const [sheetWidth, setSheetWidth] = useState(600);
  const [sheetHeight, setSheetHeight] = useState(400);
  const [spacing, setSpacing] = useState(3);
  const [margin, setMargin] = useState(3);
  const [rotationStep, setRotationStep] = useState(90);
  const [kerf, setKerf] = useState(0);
  const selected = useMemo(() => [...document.selection]
    .map((id) => document.entities.get(id))
    .filter((entity): entity is Entity => Boolean(entity)), [document]);
  const request = useMemo(() => ({ entities: selected, options: {
    sheetWidth, sheetHeight, spacing, margin, kerf, rotationStep, layers: document.layers,
  } satisfies NestingOptions }), [document.layers, selected, sheetWidth, sheetHeight, spacing, margin, kerf, rotationStep]);
  const [preview, setPreview] = useState<{
    request: typeof request | null;
    result: NestingResult | null;
    error: string | null;
    progress: NestingProgress | null;
  }>({ request: null, result: null, error: null, progress: null });
  useEffect(() => {
    if (!open) return;
    let worker: Worker | undefined;
    const timer = window.setTimeout(() => {
      setPreview({ request, result: null, error: null, progress: null });
      try {
        worker = new Worker(new URL("../cam/nestingWorker.ts", import.meta.url), { type: "module" });
        worker.onmessage = (event: MessageEvent<
          { type: "progress"; progress: NestingProgress } |
          { type: "result"; result: NestingResult } |
          { type: "error"; error: string }
        >) => {
          const message = event.data;
          if (message.type === "progress") setPreview({ request, result: null, error: null, progress: message.progress });
          else {
            setPreview({ request, result: message.type === "result" ? message.result : null,
              error: message.type === "error" ? message.error : null, progress: null });
            worker?.terminate();
          }
        };
        worker.onerror = () => {
          setPreview({ request, result: null, error: "The nesting worker could not complete this layout.", progress: null });
          worker?.terminate();
        };
        worker.postMessage(request);
      } catch (error) {
        worker?.terminate();
          setPreview({ request, result: null, error: error instanceof Error ? error.message : "Nesting is unavailable.", progress: null });
      }
    }, 150);
    return () => { window.clearTimeout(timer); worker?.terminate(); };
  }, [open, request]);
  // An edited selection or setting immediately invalidates the previous preview.
  const result = preview.request === request ? preview.result : null;
  const error = preview.request === request ? preview.error : null;
  const progress = preview.request === request ? preview.progress : null;
  const commit = () => {
    if (!result) return;
    executeCommand(new ReplaceEntitySetCommand(selected, result.entities, "Nest selection"));
    onClose();
  };

  return <AnimatePresence>{open && (
    <motion.div className="phase-modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={onClose}>
      <motion.section className="phase-modal nesting-modal surface" role="dialog" aria-modal="true" aria-label="Nest selected profiles" onMouseDown={(event) => event.stopPropagation()} onPointerDown={stopPointer}>
        <header><div><span className="eyebrow">Sheet optimisation</span><h2>Nest selection</h2></div><Tooltip content="Close panel" placement="left"><button className="panel-close" onClick={onClose} aria-label="Close panel"><X size={20} /></button></Tooltip></header>
        <div className="nesting-fields">
          <GeneratorNumber label={`Sheet width (${document.units})`} value={sheetWidth} min={1} onChange={setSheetWidth} />
          <GeneratorNumber label={`Sheet height (${document.units})`} value={sheetHeight} min={1} onChange={setSheetHeight} />
          <GeneratorNumber label={`Part spacing (${document.units})`} value={spacing} min={0} step={0.5} onChange={setSpacing} />
          <GeneratorNumber label={`Sheet margin (${document.units})`} value={margin} min={0} step={0.5} onChange={setMargin} />
          <GeneratorNumber label={`Cutting kerf (${document.units})`} value={kerf} min={0} step={0.1} onChange={setKerf} />
          <GeneratorNumber label="Rotation step (degrees)" value={rotationStep} min={1} step={1} onChange={setRotationStep} />
        </div>
        <div className={error ? "nesting-result is-error" : "nesting-result"} role="status" aria-live="polite" aria-busy={!result && !error}>
          {error ?? (result
            ? <div>{result.sheets.reduce((sum, sheet) => sum + sheet.partIds.length, 0)} parts · {result.sheets.length} sheets · {(result.utilization * 100).toFixed(1)}% total utilisation
              {result.sheets.map((sheet) => <div key={sheet.sheetIndex}>Sheet {sheet.sheetIndex + 1}: {(sheet.utilization * 100).toFixed(1)}% utilised</div>)}
              <div>Sheets are arranged from left to right in the drawing.</div>
            </div>
            : `Nesting… ${progress ? `${progress.completed}/${progress.total} parts · ${progress.sheetCount} sheets` : "preparing contours"}`)}
        </div>
        <footer><button onClick={onClose}>Cancel</button><button className="primary" disabled={!result} onClick={commit}><LayoutGrid size={15} /> Apply nesting</button></footer>
      </motion.section>
    </motion.div>
  )}</AnimatePresence>;
}

function SelectionActions({ onNest }: { readonly onNest: () => void }) {
  const position = useVectorStore((state) => state.panelPositions.selectionActions);
  const setPanelPosition = useVectorStore((state) => state.setPanelPosition);
  const nodeEditSelection = useVectorStore((state) => state.nodeEditSelection);
  const setNodeEditSelection = useVectorStore((state) => state.setNodeEditSelection);
  const dragControls = useDragControls();
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
  const zOrder = useMemo(
    () => documentModel.getEntitiesInZOrder().map((entity) => entity.id),
    [document],
  );
  const [joinPopoverOpen, setJoinPopoverOpen] = useState(false);
  const [joinTolerance, setJoinTolerance] = useState(0.1);
  const [convertingText, setConvertingText] = useState(false);
  const selectionKey = [...document.selection].join("\u0000");
  useEffect(() => setJoinPopoverOpen(false), [selectionKey]);
  const joinPreview = useMemo(() => {
    if (selected.length < 2 || selected.some((entity) => !isJoinableOpenPath(entity))) return null;
    try {
      const result = joinPaths(selected, joinTolerance);
      return {
        chains: result.length,
        merged: Math.max(0, selected.length - result.length),
        closed: result.filter((entity) => entity.type === "polyline" && entity.closed).length,
      };
    } catch {
      return null;
    }
  }, [joinTolerance, selected]);
  if (selected.length === 0) return null;

  const lockReason = getLockedSelectionReason(selected, document.layers);
  const openEntity = selected.find((entity) => entityToClosedPath(entity) === null);
  const closedReason = openEntity
    ? `${openEntity.type === "polyline" ? "Polyline" : openEntity.type} "${openEntity.id}" is an open path.`
    : null;
  const nonJoinableEntity = selected.find((entity) => !isJoinableOpenPath(entity));
  const joinReason = selected.length < 2
    ? "Select at least two open lines, arcs, or polylines."
    : lockReason ?? (nonJoinableEntity
      ? `${nonJoinableEntity.type === "polyline" ? "Polyline" : nonJoinableEntity.type} "${nonJoinableEntity.id}" is not an open joinable path.`
      : null);
  const nestReason = lockReason ?? closedReason;
  const convertReason = lockReason ?? (convertingText ? "Text conversion is already in progress." : null);
  const primary = selected[0]!;
  const selectedNode = selected.length === 1 && primary.type === "polyline" && nodeEditSelection?.entityId === primary.id
    ? nodeEditSelection
    : null;
  const nodeTypeReason = lockReason ?? (selected.length !== 1
    ? "Select a single path, then select a node with Node edit (N)."
    : ["text", "image", "dimension", "leader"].includes(primary.type)
      ? "Node types apply to vector paths. Select an editable path and a node."
      : selectedNode ? null : "Select a node with Node edit (N) to change its type.");
  const selectedInZOrder = zOrder.filter((id) => document.selection.has(id));
  const primaryNumber = Math.max(1, selectedInZOrder.indexOf(primary.id) + 1);
  const openPolylines = selected.filter(
    (entity): entity is Extract<Entity, { type: "polyline" }> => entity.type === "polyline" && !entity.closed,
  );
  const shortPolyline = openPolylines.find((entity) => entity.points.length < 3);
  const closePathReason = shortPolyline
    ? `Polyline "${shortPolyline.name?.trim() || shortPolyline.id}" needs at least three vertices to close.`
    : openPolylines.length > 0
      ? getLockedSelectionReason(openPolylines, document.layers)
      : null;
  const selectedText = selected.length === 1 && selected[0]?.type === "text" ? selected[0] : null;

  const cyclePrimary = () => {
    if (selected.length < 2) return;
    documentModel.selectEntities([...selected.slice(1), selected[0]!].map((entity) => entity.id));
  };

  const runOrExplain = (reason: string | null, action: () => void) => {
    if (reason) {
      toast.info(reason);
      return;
    }
    action();
  };

  const runBoolean = (operation: BooleanOperation) => {
    try {
      const result = applyBooleanOperation(selected, operation, {
        layers: document.layers,
        resultLayerId: document.activeLayerId,
        zOrder,
        primaryEntityId: primary.id,
      });
      const label = operation === "union"
        ? "Weld paths"
        : operation === "difference"
          ? "Subtract paths"
          : operation === "intersection"
            ? "Intersect paths"
            : "Exclude overlap";
      executeCommand(new ReplaceEntitySetCommand(selected, result, label));
      if (result.length === 0) toast.info("The selected profiles do not overlap. Undo restores the source geometry.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The path operation failed.");
    }
  };
  const closeSelectedPolylines = () => {
    if (openPolylines.length === 0 || closePathReason) return;
    const closed = openPolylines.map(closePolyline);
    try {
      executeCommand(new UpdateEntitiesCommand(openPolylines, closed, "Close path"));
      toast.success(`Closed ${closed.length} polyline${closed.length === 1 ? "" : "s"} for 3D and Manufacture.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The selected polyline could not be closed.");
    }
  };
  const runJoin = (tolerance: number) => {
    try {
      const result = joinPaths(selected, tolerance);
      if (result.length === selected.length) {
        toast.info(`No selected endpoints are within ${tolerance.toFixed(2)} ${document.units}.`);
        return;
      }
      executeCommand(new ReplaceEntitySetCommand(selected, result, "Join paths"));
      const closedCount = result.filter((entity) => entity.type === "polyline" && entity.closed).length;
      toast.success(
        closedCount > 0
          ? `Joined paths into ${result.length} chain${result.length === 1 ? "" : "s"}; ${closedCount} closed.`
          : `Joined paths into ${result.length} open chain${result.length === 1 ? "" : "s"}.`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The selected paths could not be joined.");
    }
  };
  const confirmJoin = () => {
    runJoin(joinTolerance);
    setJoinPopoverOpen(false);
  };
  const convertSelectedText = async () => {
    if (!selectedText || convertingText) return;
    if (lockReason) {
      toast.error(lockReason);
      return;
    }
    setConvertingText(true);
    const sourceDocumentId = documentModel.getDocument().id;
    const sourceText = selectedText;
    try {
      const { convertTextToPaths } = await import("../geometry/operations/textToPath");
      const contours = await convertTextToPaths(sourceText);
      const current = documentModel.getDocument();
      if (current.id !== sourceDocumentId || current.entities.get(sourceText.id) !== sourceText) {
        throw new Error("The text changed while its font was loading. Convert it again.");
      }
      if (contours.length === 0) {
        toast.info("This text does not contain any closed visible glyph contours.");
        return;
      }
      executeCommand(new ReplaceEntitySetCommand([sourceText], contours, "Convert text to paths"));
      toast.success(`Converted text to ${contours.length} closed path${contours.length === 1 ? "" : "s"}.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The text could not be converted to paths.");
    } finally {
      setConvertingText(false);
    }
  };
  const onDragEnd = (_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    setPanelPosition("selectionActions", {
      x: position.x + info.offset.x,
      y: position.y + info.offset.y,
    });
  };

  return (
    <div className="selection-actions-anchor">
      <motion.div
        className="selection-actions surface"
        style={{ x: position.x, y: position.y }}
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: "spring", stiffness: 400, damping: 32 }}
        drag
        dragControls={dragControls}
        dragListener={false}
        dragMomentum={false}
        dragElastic={0}
        onDragEnd={onDragEnd}
        onPointerDown={(event) => {
          stopPointer(event);
          if (!(event.target as Element).closest("button")) dragControls.start(event);
        }}
        role="toolbar"
        aria-label="Selection actions. Drag the empty area to move."
      >
        <Tooltip content="Drag to move" placement="top"><span className="selection-actions-handle">{selected.length} selected</span></Tooltip>
        {selected.length > 1 && !closedReason && (
          <Tooltip content={`${primary.name?.trim() || primary.type} is the Boolean subject. Click to select the next subject.`} placement="top">
            <button
              type="button"
              className="primary-subject-key"
              aria-label={`${primary.name?.trim() || primary.type} is primary subject ${primaryNumber}. Make the next selected object primary.`}
              onClick={cyclePrimary}
            >
              <b>{primaryNumber}</b>
              <span>Primary</span>
              <ChevronDown size={11} aria-hidden="true" />
            </button>
          </Tooltip>
        )}
        <i />
        <NodeTypeMenu
          selectedNode={selectedNode}
          disabledReason={nodeTypeReason}
          contextKey={`${selectionKey}:${selectedNode?.vertexIndex ?? "none"}:${nodeTypeReason ?? "editable"}`}
          onChange={(nodeType) => { if (selectedNode) setNodeEditSelection({ ...selectedNode, nodeType }); }}
        />
        {selected.length >= 2 && !closedReason && (
          <div className="boolean-actions-group" role="group" aria-label="Boolean operations">
            <Tooltip content={lockReason ?? "Weld selected profiles into their union"} placement="top"><button aria-disabled={Boolean(lockReason)} onClick={() => runOrExplain(lockReason, () => runBoolean("union"))}><WeldIcon size={13} /> Weld</button></Tooltip>
            <Tooltip content={lockReason ?? "Subtract every other selected profile from the current primary subject"} placement="top"><button aria-disabled={Boolean(lockReason)} onClick={() => runOrExplain(lockReason, () => runBoolean("difference"))}><SubtractIcon size={13} /> Subtract</button></Tooltip>
            <Tooltip content={lockReason ?? "Keep only areas shared by every selected profile"} placement="top"><button aria-disabled={Boolean(lockReason)} onClick={() => runOrExplain(lockReason, () => runBoolean("intersection"))}><SquaresIntersect size={13} /> Intersect</button></Tooltip>
            <Tooltip content={lockReason ?? "Keep areas covered by an odd number of selected profiles"} placement="top"><button aria-disabled={Boolean(lockReason)} onClick={() => runOrExplain(lockReason, () => runBoolean("xor"))}><SquaresExclude size={13} /> Exclude</button></Tooltip>
          </div>
        )}
        <Tooltip content={joinReason ?? "Set the tolerance used to weld matching endpoints"} placement="top">
          <button
            aria-disabled={Boolean(joinReason)}
            aria-expanded={joinPopoverOpen}
            onClick={() => runOrExplain(joinReason, () => setJoinPopoverOpen((current) => !current))}
          >Join</button>
        </Tooltip>
        {openPolylines.length > 0 && (
          <Tooltip content={closePathReason ?? "Connect the final vertex back to the first for 3D and CAM"} placement="top">
            <button
              aria-disabled={Boolean(closePathReason)}
              onClick={() => runOrExplain(closePathReason, closeSelectedPolylines)}
            ><CircleDashed size={13} /> Close path</button>
          </Tooltip>
        )}
        {selectedText && (
          <Tooltip content={convertReason ?? "Replace live text with closed machinable vector contours"} placement="top">
            <button
              aria-disabled={Boolean(convertReason)}
              onClick={() => runOrExplain(convertReason, () => void convertSelectedText())}
            >{convertingText ? "Converting…" : "Convert to paths"}</button>
          </Tooltip>
        )}
        <Tooltip content={nestReason ?? "Nest selected closed profiles"} placement="top"><button aria-disabled={Boolean(nestReason)} onClick={() => runOrExplain(nestReason, onNest)}><LayoutGrid size={13} /> Nest</button></Tooltip>
        <AnimatePresence>
          {joinPopoverOpen && !joinReason && (
            <motion.div
              className="join-tolerance-popover surface"
              role="dialog"
              aria-label="Join path tolerance"
              initial={{ opacity: 0, y: 6, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 4, scale: 0.98 }}
              transition={{ type: "spring", stiffness: 430, damping: 32 }}
              onPointerDown={stopPointer}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.stopPropagation();
                  setJoinPopoverOpen(false);
                }
              }}
            >
              <header>
                <div><span>Join paths</span><strong>Endpoint tolerance</strong></div>
                <button type="button" onClick={() => setJoinPopoverOpen(false)} aria-label="Close join tolerance"><X size={14} /></button>
              </header>
              <label className="join-tolerance-value">
                <span>Join tolerance</span>
                <span><input
                  type="number"
                  min="0.1"
                  max="10"
                  step="0.1"
                  value={joinTolerance}
                  onChange={(event) => setJoinTolerance(Math.min(10, Math.max(0.1, Number(event.target.value) || 0.1)))}
                  aria-label={`Join tolerance in ${document.units}`}
                /><b>{document.units}</b></span>
              </label>
              <input
                className="join-tolerance-slider"
                type="range"
                min="0.1"
                max="10"
                step="0.1"
                value={joinTolerance}
                onChange={(event) => setJoinTolerance(Number(event.target.value))}
                aria-label={`Join tolerance slider in ${document.units}`}
              />
              <div className={joinPreview?.merged ? "join-preview-summary can-join" : "join-preview-summary"}>
                <i />
                {joinPreview?.merged
                  ? `${selected.length} segments → ${joinPreview.chains} chain${joinPreview.chains === 1 ? "" : "s"}${joinPreview.closed ? ` · ${joinPreview.closed} closed` : ""}`
                  : "No matching endpoints at this tolerance"}
              </div>
              <footer>
                <button type="button" onClick={() => setJoinPopoverOpen(false)}>Cancel</button>
                <button type="button" className="primary" onClick={confirmJoin}>Confirm join</button>
              </footer>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}

function CommandPalette({
  onOpenGenerators,
  onOpenCam,
  onOpenRaster,
  onOpenVectorizer,
  onOpenThreePreview,
  onNest,
  onOpenHelp,
}: {
  readonly onOpenGenerators: () => void;
  readonly onOpenCam: () => void;
  readonly onOpenRaster: () => void;
  readonly onOpenVectorizer: () => void;
  readonly onOpenThreePreview: () => void;
  readonly onNest: () => void;
  readonly onOpenHelp: () => void;
}) {
  const open = useVectorStore((state) => state.commandPaletteOpen);
  const setOpen = useVectorStore((state) => state.setCommandPaletteOpen);
  const setActiveTool = useVectorStore((state) => state.setActiveTool);
  const togglePanel = useVectorStore((state) => state.togglePanel);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const filtered = useMemo(() => {
    const value = query.trim().toLowerCase();
    if (!value) return COMMANDS;
    return COMMANDS.filter((command) => `${command.label} ${command.description}`.toLowerCase().includes(value));
  }, [query]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setSelected(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => setSelected(0), [query]);

  const runCommand = (command: CommandItem | undefined) => {
    if (!command) return;
    if (command.tool) setActiveTool(command.tool);
    if (command.action === "preferences" || command.action === "layers" || command.action === "properties") togglePanel(command.action, true);
    if (command.action === "generators") onOpenGenerators();
    if (command.action === "cam") onOpenCam();
    if (command.action === "raster") onOpenRaster();
    if (command.action === "vectorizer") onOpenVectorizer();
    if (command.action === "preview3d") onOpenThreePreview();
    if (command.action === "nest") onNest();
    if (command.action === "help") onOpenHelp();
    setOpen(false);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelected((value) => Math.min(filtered.length - 1, value + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelected((value) => Math.max(0, value - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      runCommand(filtered[selected]);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="palette-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={() => setOpen(false)}>
          <motion.div
            className="command-palette surface"
            role="dialog"
            aria-modal="true"
            aria-label="Command search"
            initial={{ opacity: 0, y: -18, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 390, damping: 32 }}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="palette-head">
              <div><span className="eyebrow">Command search</span><h2>Find a tool</h2></div>
              <Tooltip content="Close command search" shortcut="Esc" placement="left">
                <button className="panel-close" onClick={() => setOpen(false)} aria-label="Close command search">
                  <X size={20} />
                </button>
              </Tooltip>
            </div>
            <div className="search-box">
              <Search size={22} />
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Search tools and actions…"
                aria-label="Search commands"
              />
              <kbd>⌘ K</kbd>
            </div>
            <div className="command-list">
              {filtered.length ? filtered.map((command, index) => {
                const Icon = command.icon;
                const commandLabel = command.tool
                  ? displayToolLabel(command.label, command.tool)
                  : command.label;
                return (
                  <button
                    key={command.id}
                    className={`command-row ${selected === index ? "is-selected" : ""}`}
                    onMouseEnter={() => setSelected(index)}
                    onClick={() => runCommand(command)}
                  >
                    <Icon size={22} />
                    <span><strong>{commandLabel}</strong><small>{command.description}</small></span>
                    <kbd>{command.key}</kbd>
                  </button>
                );
              }) : (
                <div className="empty-commands"><Search size={24} /><strong>No matching commands</strong><span>Try “line”, “layer”, or “grid”.</span></div>
              )}
            </div>
            <footer className="palette-footer">
              <span><kbd>↑ ↓</kbd> Navigate</span>
              <span><kbd><CornerDownLeft size={12} /></kbd> Select</span>
            </footer>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Telemetry({ coordinateRef }: { readonly coordinateRef: React.RefObject<HTMLSpanElement | null> }) {
  const activeTool = useVectorStore((state) => state.activeTool);
  const snapToGrid = useVectorStore((state) => state.preferences.drafting.snapToGrid);
  const gridVisible = useVectorStore((state) => state.preferences.drafting.gridVisible);
  const setSnapToGrid = useVectorStore((state) => state.setSnapToGrid);
  const updateDraftingPreferences = useVectorStore((state) => state.updateDraftingPreferences);
  const zoom = useVectorStore((state) => state.viewport.zoom);
  const zoomBy = useVectorStore((state) => state.zoomBy);
  const resetViewport = useVectorStore((state) => state.resetViewport);
  const documentUnits = useSyncExternalStore(
    (onStoreChange) => documentModel.subscribe(() => onStoreChange()),
    () => documentModel.getDocument().units,
    () => documentModel.getDocument().units,
  );
  const ActiveToolIcon = TOOL_ICONS[activeTool];
  const activeToolLabel = displayToolLabel(TOOL_LABELS[activeTool], activeTool);
  const toggleGridSnap = () => setSnapToGrid(!snapToGrid);
  const toggleGrid = () => updateDraftingPreferences({ gridVisible: !gridVisible });

  return (
    <>
      <div className="telemetry surface" aria-label="Canvas telemetry">
        <span className="tool-state"><ActiveToolIcon size={15} /> {activeToolLabel}</span>
        <kbd>{TOOL_SHORTCUTS[activeTool]}</kbd>
        <i className="telemetry-rule" />
        <button
          type="button"
          className={snapToGrid ? "telemetry-toggle is-on" : "telemetry-toggle"}
          aria-label={snapToGrid ? "Turn grid snapping off" : "Turn grid snapping on"}
          aria-pressed={snapToGrid}
          onClick={toggleGridSnap}
        >
          <span>Snap</span><i />{snapToGrid ? "On" : "Off"}
        </button>
        <i className="telemetry-rule" />
        <Tooltip content={gridVisible ? "Turn grid off" : "Turn grid on"} placement="top">
          <button
            type="button"
            className={gridVisible ? "telemetry-toggle is-on" : "telemetry-toggle"}
            aria-label={gridVisible ? "Turn grid off" : "Turn grid on"}
            aria-pressed={gridVisible}
            onClick={toggleGrid}
          >
            <span>Grid</span><i />{gridVisible ? "On" : "Off"}
          </button>
        </Tooltip>
        <i className="telemetry-rule" />
        <span ref={coordinateRef} className="coordinates">x 0 {documentUnits} · y 0 {documentUnits}</span>
      </div>
      <div className="zoom-control surface">
        <Tooltip content="Zoom out"><button onClick={() => zoomBy(0.8)} aria-label="Zoom out"><Minus size={17} /></button></Tooltip>
        <Tooltip content="Reset zoom"><button className="zoom-value" onClick={resetViewport} aria-label="Reset zoom">{Math.round(zoom * 100)}%</button></Tooltip>
        <Tooltip content="Zoom in"><button onClick={() => zoomBy(1.25)} aria-label="Zoom in"><Plus size={17} /></button></Tooltip>
      </div>
    </>
  );
}

type PendingDocumentAction = {
  readonly title: string;
  readonly description: string;
  readonly confirmLabel: string;
  readonly run: (beforeReplace?: () => void) => void | Promise<void>;
};

function UnsavedChangesModal({
  pending,
  saving,
  onCancel,
  onDiscard,
  onSave,
}: {
  readonly pending: PendingDocumentAction | null;
  readonly saving: boolean;
  readonly onCancel: () => void;
  readonly onDiscard: () => void;
  readonly onSave: () => void;
}) {
  return (
    <AnimatePresence>
      {pending && (
        <motion.div className="phase-modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.section
            className="phase-modal surface unsaved-modal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="unsaved-dialog-title"
            aria-describedby="unsaved-dialog-description"
            initial={{ opacity: 0, y: 14, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            onPointerDown={stopPointer}
          >
            <header>
              <div><span className="eyebrow">Unsaved changes</span><h2 id="unsaved-dialog-title">{pending.title}</h2></div>
              <Tooltip content="Cancel" placement="left"><button className="panel-close" disabled={saving} onClick={onCancel} aria-label="Cancel"><X size={20} /></button></Tooltip>
            </header>
            <div className="panel-rule" />
            <div className="unsaved-content">
              <h3>Save your work before continuing?</h3>
              <p id="unsaved-dialog-description">{pending.description}</p>
              <p className="unsaved-save-note">If your browser starts a download, Vectora cannot confirm it was saved and will keep this drawing open and marked unsaved.</p>
            </div>
            <footer>
              <button autoFocus disabled={saving} onClick={onCancel}>Cancel</button>
              <button disabled={saving} className="danger-subtle" onClick={onDiscard}>{pending.confirmLabel}</button>
              <button disabled={saving} className="primary" onClick={onSave}>{saving ? "Saving…" : "Save and continue"}</button>
            </footer>
          </motion.section>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

type LayerDialogState = { readonly mode: "create" } | { readonly mode: "delete"; readonly layerId: string };

function LayerDialog({ state, onClose }: { readonly state: LayerDialogState | null; readonly onClose: () => void }) {
  const document = useSyncExternalStore(
    (onStoreChange) => documentModel.subscribe(() => onStoreChange()),
    () => documentModel.getDocument(),
    () => documentModel.getDocument(),
  );
  const [name, setName] = useState("Layer 1");
  const [color, setColor] = useState(vectoraRenderColors.operation.cut);
  const [targetLayerId, setTargetLayerId] = useState("");

  useEffect(() => {
    if (state?.mode === "create") {
      setName(`Layer ${document.layers.length + 1}`);
      setColor(vectoraRenderColors.operation.cut);
    } else if (state?.mode === "delete") {
      setTargetLayerId(document.layers.find((layer) => layer.id !== state.layerId)?.id ?? "");
    }
  }, [document.layers, state]);

  if (!state) return null;
  const layer = state.mode === "delete"
    ? document.layers.find((candidate) => candidate.id === state.layerId)
    : null;
  const contained = layer
    ? [...document.entities.values()].filter((entity) => entity.layerId === layer.id)
    : [];

  const createLayer = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const token = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    try {
      executeCommand(new AddLayerCommand({
        id: `layer-${token}`,
        name: trimmed,
        intent: "cut",
        color,
        visible: true,
        locked: false,
        order: Math.max(-1, ...document.layers.map((candidate) => candidate.order)) + 1,
      }));
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The layer could not be created.");
    }
  };

  const deleteLayer = (migrate: boolean) => {
    if (!layer) return;
    try {
      executeCommand(new DeleteLayerCommand(
        layer.id,
        migrate ? { kind: "migrate", targetLayerId } : { kind: "delete-contents" },
      ));
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The layer could not be deleted.");
    }
  };

  return (
    <motion.div className="phase-modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={onClose}>
      <motion.section className="phase-modal surface layer-dialog" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()} onPointerDown={stopPointer}>
        <header>
          <div><span className="eyebrow">Document layers</span><h2>{state.mode === "create" ? "Add layer" : "Delete layer"}</h2></div>
          <Tooltip content="Close panel" placement="left"><button className="panel-close" onClick={onClose} aria-label="Close panel"><X size={20} /></button></Tooltip>
        </header>
        {state.mode === "create" ? (
          <div className="layer-dialog-fields">
            <label><span>Name</span><input autoFocus value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") createLayer(); }} /></label>
            <label><span>Colour</span><input type="color" value={color} onChange={(event) => setColor(event.target.value)} /></label>
          </div>
        ) : (
          <div className="layer-delete-content">
            <p><strong>{layer?.name ?? "This layer"}</strong> contains {contained.length} {contained.length === 1 ? "object" : "objects"}.</p>
            {contained.length > 0 && (
              <label><span>Move objects to</span><select value={targetLayerId} onChange={(event) => setTargetLayerId(event.target.value)}>{document.layers.filter((candidate) => candidate.id !== layer?.id).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select></label>
            )}
          </div>
        )}
        <footer>
          <button onClick={onClose}>Cancel</button>
          {state.mode === "create" ? (
            <button className="primary" disabled={!name.trim()} onClick={createLayer}>Create layer</button>
          ) : contained.length > 0 ? (
            <>
              <button className="danger-subtle" onClick={() => deleteLayer(false)}>Delete objects and layer</button>
              <button className="primary" disabled={!targetLayerId} onClick={() => deleteLayer(true)}>Move objects and delete</button>
            </>
          ) : (
            <button className="danger" onClick={() => deleteLayer(false)}>Delete layer</button>
          )}
        </footer>
      </motion.section>
    </motion.div>
  );
}

function HelpModal({ open, onClose }: { readonly open: boolean; readonly onClose: () => void }) {
  const angleSnapDeg = useVectorStore((state) => getAngleSnapDegrees(state.preferences.drafting));
  return <AnimatePresence>{open && (
    <motion.div className="phase-modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={onClose}>
      <motion.section className="phase-modal help-modal surface" role="dialog" aria-modal="true" aria-label="Vectora help" onMouseDown={(event) => event.stopPropagation()} onPointerDown={stopPointer}>
        <header><div><span className="eyebrow">Vectora help</span><h2>Quick reference</h2></div><Tooltip content="Close panel" placement="left"><button className="panel-close" onClick={onClose} aria-label="Close panel"><X size={20} /></button></Tooltip></header>
        <div className="panel-rule" />
        <div className="help-columns">
          <section className="help-section" aria-labelledby="help-navigation-title">
            <h3 id="help-navigation-title">Navigation and editing</h3>
            <div className="help-list">
              <div><kbd>V</kbd><span>Select, marquee, move, resize and rotate</span></div>
              <div><kbd>N</kbd><span>Edit shape, line and polyline nodes or Bézier handles</span></div>
              <div><kbd>{primaryShortcut("C")}</kbd><span>Copy selected objects</span></div>
              <div><kbd>{primaryShortcut("V")}</kbd><span>Paste copied objects with a small offset</span></div>
              <div><kbd>Delete / Backspace</kbd><span>Delete the selected objects</span></div>
              <div><kbd>⇧</kbd><span>Constrain corner scale or snap rotation to {angleSnapDeg}°</span></div>
              <div><kbd>2×</kbd><span>Double-click a polyline to edit anchors and Bézier handles</span></div>
              <div><kbd>Space</kbd><span>Hold and drag to pan; middle-drag also pans</span></div>
              <div><kbd>H</kbd><span>Return to the home view</span></div>
            </div>
          </section>
          <section className="help-section" aria-labelledby="help-tools-title">
            <h3 id="help-tools-title">Tools and workspace</h3>
            <div className="help-list">
              <div><kbd>L</kbd><span>Draw a line by dragging or two clicks</span></div>
              <div><kbd>P</kbd><span>Click polyline vertices; Enter, Escape or double-click to finish</span></div>
              <div><kbd>B</kbd><span>Drag a freehand path without snapping; release to finish, Escape to cancel</span></div>
              <div><kbd>R · C · E · Y · A</kbd><span>Rectangle, circle, ellipse, polygon and arc tools</span></div>
              <div><kbd>F</kbd><span>Text tool</span></div>
              <div><kbd>X</kbd><span>Hover an edge in red, then click to erase that segment</span></div>
              <div><kbd>G</kbd><span>Apply the selected fill color inside a closed shape</span></div>
              <div><kbd>D</kbd><span>Pick two snap points, then place an aligned dimension</span></div>
              <div><kbd>⇧ M</kbd><span>Measure distance, deltas and angle without editing</span></div>
              <div><kbd>{primaryShortcut("K")}</kbd><span>Find every tool and workspace action</span></div>
              <div><kbd>{primaryShortcut(",")}</kbd><span>Open Preferences</span></div>
              <div><kbd>{primaryShortcut("L")}</kbd><span>Toggle the Layers panel</span></div>
              <div><kbd>{primaryShortcut("N")} · {primaryShortcut("O")}</kbd><span>New document · Open document</span></div>
              <div><kbd>{primaryShortcut("S")} · {primaryShortcut("S", true)}</kbd><span>Save · Save as</span></div>
              <div><kbd>{primaryShortcut("E")} · {primaryShortcut("E", true)}</kbd><span>Export SVG · Export DXF</span></div>
              <div><kbd>{primaryShortcut("Z")}</kbd><span>Undo</span></div>
              <div><kbd>{primaryShortcut("Z", true)}</kbd><span>Redo</span></div>
              {!isMacPlatform() && <div><kbd>Ctrl+Y</kbd><span>Redo (Windows alternative)</span></div>}
              <div><kbd>Esc</kbd><span>Close open menus, dialogs and flyouts</span></div>
            </div>
          </section>
        </div>
        <footer className="help-footer">
          <span className="help-note"><i /> App shortcuts work outside text fields. Browser-reserved shortcuts stay with your browser.</span>
          <button className="primary" onClick={onClose}>Close</button>
        </footer>
      </motion.section>
    </motion.div>
  )}</AnimatePresence>;
}

export function VectoraWorkspace() {
  const { canvasRef, canvasProps, coordinateRef, setGeneratorPreview, inlineTextEditor } = useCanvasEngine();
  const activeTool = useVectorStore((state) => state.activeTool);
  const setActiveTool = useVectorStore((state) => state.setActiveTool);
  const setCommandPaletteOpen = useVectorStore((state) => state.setCommandPaletteOpen);
  const commandPaletteOpen = useVectorStore((state) => state.commandPaletteOpen);
  const setFileMenuOpen = useVectorStore((state) => state.setFileMenuOpen);
  const setSelectMenuOpen = useVectorStore((state) => state.setSelectMenuOpen);
  const setLineMenuOpen = useVectorStore((state) => state.setLineMenuOpen);
  const setShapeMenuOpen = useVectorStore((state) => state.setShapeMenuOpen);
  const togglePanel = useVectorStore((state) => state.togglePanel);
  const resetViewport = useVectorStore((state) => state.resetViewport);
  const temporaryPanActive = useVectorStore((state) => state.temporaryPanActive);
  const canvasPanning = useVectorStore((state) => state.canvasPanning);
  const preferencesOpen = useVectorStore((state) => state.preferencesOpen);
  const layersOpen = useVectorStore((state) => state.layersOpen);
  const propertiesOpen = useVectorStore((state) => state.propertiesOpen);
  const themeMode = useVectorStore((state) => state.preferences.canvas.themeMode);
  const cursorStyle = useVectorStore((state) => state.preferences.canvas.cursorStyle);
  const previousToolRef = useRef<ToolId | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [generatorsOpen, setGeneratorsOpen] = useState(false);
  const [camOpen, setCamOpen] = useState(false);
  const [rasterOpen, setRasterOpen] = useState(false);
  const [nestingOpen, setNestingOpen] = useState(false);
  const [vectorizerFile, setVectorizerFile] = useState<File | null>(null);
  const [threePreviewOpen, setThreePreviewOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [layerDialog, setLayerDialog] = useState<LayerDialogState | null>(null);
  const [pendingDocumentAction, setPendingDocumentAction] = useState<PendingDocumentAction | null>(null);
  const [savingBeforeAction, setSavingBeforeAction] = useState(false);
  useObjectClipboard(Boolean(commandPaletteOpen || preferencesOpen || generatorsOpen || nestingOpen
    || vectorizerFile || threePreviewOpen || helpOpen || layerDialog || pendingDocumentAction));

  useEffect(() => {
    if (!camOpen) return;
    togglePanel("layers", false);
    togglePanel("properties", false);
  }, [camOpen, togglePanel]);

  useEffect(() => {
    if (layersOpen || propertiesOpen) setCamOpen(false);
  }, [layersOpen, propertiesOpen]);

  useEffect(() => {
    const blocksSpacePan = (target: EventTarget | null): boolean => {
      if (!(target instanceof Element)) return false;
      if (target.closest("input, textarea, button, select")) return true;
      const editable = target.closest("[contenteditable]");
      return editable !== null && editable.getAttribute("contenteditable") !== "false";
    };
    const releaseTemporaryPan = () => {
      const state = useVectorStore.getState();
      if (!state.temporaryPanActive && previousToolRef.current === null) return;
      state.setTemporaryPanActive(false);
      const previousTool = previousToolRef.current;
      previousToolRef.current = null;
      if (previousTool && state.activeTool !== previousTool) state.setActiveTool(previousTool);
    };
    const onSpaceDown = (event: globalThis.KeyboardEvent) => {
      if (event.code !== "Space" || blocksSpacePan(event.target)) return;
      event.preventDefault();
      const state = useVectorStore.getState();
      if (event.repeat || state.temporaryPanActive) return;
      previousToolRef.current = state.activeTool;
      state.setTemporaryPanActive(true);
    };
    const onSpaceUp = (event: globalThis.KeyboardEvent) => {
      if (event.code !== "Space") return;
      releaseTemporaryPan();
    };
    window.addEventListener("keydown", onSpaceDown);
    window.addEventListener("keyup", onSpaceUp);
    window.addEventListener("blur", releaseTemporaryPan);
    return () => {
      window.removeEventListener("keydown", onSpaceDown);
      window.removeEventListener("keyup", onSpaceUp);
      window.removeEventListener("blur", releaseTemporaryPan);
      releaseTemporaryPan();
    };
  }, []);

  const requestDocumentAction = useCallback((action: PendingDocumentAction) => {
    if (filePersistence.getSnapshot().dirty) setPendingDocumentAction(action);
    else {
      const revision = filePersistence.getContentRevision();
      const beforeReplace = () => {
        if (filePersistence.getContentRevision() !== revision) {
          throw new Error("The drawing changed before the document action completed. Try again.");
        }
      };
      void (async () => action.run(beforeReplace))().catch((error: unknown) => {
        toast.error(error instanceof Error ? error.message : "The document action could not be completed.");
      });
    }
  }, []);

  const saveDocument = useCallback((saveAs = false) => {
    void filePersistence.save(saveAs).then((result) => {
      if (result.status === "download-started") {
        toast.info("Download started, but its completion cannot be confirmed. This drawing remains unsaved; check the downloaded file before closing this tab.", 8_000);
      }
    }).catch((error: unknown) => {
      toast.error(error instanceof Error ? error.message : "The Vectora document could not be saved.");
    });
  }, []);

  const newDocument = useCallback(() => {
    requestDocumentAction({
      title: "Start a new document?",
      description: "Unsaved changes to the current drawing will be discarded.",
      confirmLabel: "Discard and create",
      run: (beforeReplace) => {
        beforeReplace?.();
        const abandonedId = documentModel.getDocument().id;
        documentModel.resetDocument(useVectorStore.getState().preferences.drafting.defaultUnits);
        history.clear();
        filePersistence.markClean();
        useVectorStore.getState().setActiveTool("select");
        void recoveryController.abandon(abandonedId).catch(() => { /* Recovery service reports storage failures. */ });
      },
    });
  }, [requestDocumentAction]);

  const handleWorkspaceFile = useCallback((file: File, handle: VectoraFileHandle | null) => {
    if (isRasterFile(file)) {
      void importRasterImage(file).then(() => { setRasterOpen(true); useVectorStore.getState().setActiveTool("select"); })
        .catch((error: unknown) => toast.error(error instanceof Error ? error.message : "The bitmap could not be imported."));
      return;
    }
    requestDocumentAction({
      title: `Open ${file.name}?`,
      description: "Opening a document replaces the current drawing and clears its undo history.",
      confirmLabel: "Discard and open",
      run: async (beforeReplace) => {
        const abandonedId = documentModel.getDocument().id;
        if (await importCadFile(file, handle, beforeReplace)) void recoveryController.abandon(abandonedId).catch(() => { /* Recovery service reports storage failures. */ });
      },
    });
  }, [requestDocumentAction]);

  const openDocument = useCallback(() => {
    void chooseCadFile(handleWorkspaceFile);
  }, [handleWorkspaceFile]);

  const openVectorizer = useCallback(() => {
    void chooseCadFile((file) => {
      if (isRasterFile(file)) setVectorizerFile(file);
      else toast.error("Choose a PNG, JPEG, or WebP image to trace.");
    });
  }, []);

  const discardAndContinue = useCallback(() => {
    const pending = pendingDocumentAction;
    setPendingDocumentAction(null);
    if (pending) {
      const revision = filePersistence.getContentRevision();
      const beforeReplace = () => {
        if (filePersistence.getContentRevision() !== revision) {
          throw new Error("The drawing changed before the document action completed. Try again.");
        }
      };
      void (async () => pending.run(beforeReplace))().catch((error: unknown) => {
        toast.error(error instanceof Error ? error.message : "The document action could not be completed.");
      });
    }
  }, [pendingDocumentAction]);

  const saveAndContinue = useCallback(() => {
    const pending = pendingDocumentAction;
    if (!pending) return;
    setSavingBeforeAction(true);
    void filePersistence.save(false).then(async (result) => {
      if (result.status === "cancelled") return;
      if (result.status === "download-started") {
        toast.info("Download started, but its completion cannot be confirmed. Your drawing stays open and unsaved; check the downloaded file before continuing.", 8_000);
        return;
      }
      const beforeReplace = () => {
        if (!filePersistence.canContinueAfterSave(result)) {
          throw new Error("The drawing changed while saving. Save again.");
        }
      };
      beforeReplace();
      await pending.run(beforeReplace);
      setPendingDocumentAction(null);
    }).catch((error: unknown) => {
      toast.error(error instanceof Error ? error.message : "The Vectora document could not be saved.");
    }).finally(() => setSavingBeforeAction(false));
  }, [pendingDocumentAction]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const typing = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable;
      const commandKey = event.metaKey || event.ctrlKey;
      if (!typing && commandKey && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (!typing && event.ctrlKey && event.key.toLowerCase() === "y") {
        event.preventDefault();
        redo();
        return;
      }
      if (!typing && commandKey && event.key.toLowerCase() === "n") {
        event.preventDefault();
        newDocument();
        return;
      }
      if (!typing && commandKey && event.key.toLowerCase() === "s") {
        event.preventDefault();
        saveDocument(event.shiftKey);
        return;
      }
      if (!typing && commandKey && event.key.toLowerCase() === "o") {
        event.preventDefault();
        openDocument();
        return;
      }
      if (!typing && commandKey && event.key.toLowerCase() === "e") {
        event.preventDefault();
        exportCurrentDocument(event.shiftKey ? "dxf" : "svg");
        return;
      }
      if (!typing && commandKey && event.key.toLowerCase() === "l") {
        event.preventDefault();
        togglePanel("layers");
        return;
      }
      if (!typing && (event.key === "Delete" || event.key === "Backspace")) {
        const selection = [...documentModel.getDocument().selection];
        if (selection.length === 0) return;
        event.preventDefault();
        const command = new DeleteEntityCommand(selection);
        if (!command.isEmpty) {
          executeCommand(command);
        } else if (command.blockedCount > 0) {
          toast.info("Locked entities cannot be deleted.");
        }
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandPaletteOpen(!useVectorStore.getState().commandPaletteOpen);
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key === ",") {
        event.preventDefault();
        togglePanel("preferences", true);
        return;
      }
      if (event.key === "Escape") {
        if (pendingDocumentAction) {
          setPendingDocumentAction(null);
          return;
        }
        setGeneratorsOpen(false);
        setCamOpen(false);
        setRasterOpen(false);
        setNestingOpen(false);
        setVectorizerFile(null);
        setThreePreviewOpen(false);
        setHelpOpen(false);
        setLayerDialog(null);
        setCommandPaletteOpen(false);
        setFileMenuOpen(false);
        setSelectMenuOpen(false);
        setLineMenuOpen(false);
        setShapeMenuOpen(false);
        return;
      }
      if (typing || commandPaletteOpen || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "?") {
        setHelpOpen(true);
        return;
      }
      if (event.key.toLowerCase() === "h") {
        event.preventDefault();
        resetViewport();
        return;
      }
      if (!typing && !event.metaKey && !event.ctrlKey && !event.altKey && event.shiftKey && event.key.toLowerCase() === "m") {
        event.preventDefault();
        setActiveTool("measure");
        return;
      }
      const shortcutMap: Record<string, ToolId> = {
        v: "select", n: "node-edit", l: "line", p: "pen", b: "freehand", x: "erase", r: "rectangle",
        c: "circle", e: "ellipse", y: "polygon", a: "arc", f: "text", d: "dimension", g: "fill",
      };
      const tool = shortcutMap[event.key.toLowerCase()];
      if (tool) setActiveTool(tool);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [commandPaletteOpen, newDocument, openDocument, pendingDocumentAction, resetViewport, saveDocument, setActiveTool, setCommandPaletteOpen, setFileMenuOpen, setLineMenuOpen, setSelectMenuOpen, setShapeMenuOpen, togglePanel]);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!filePersistence.getSnapshot().dirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  return (
    <main
      className={`workspace theme-${themeMode} cursor-${cursorStyle} tool-${activeTool}${temporaryPanActive ? " is-space-panning" : ""}${canvasPanning ? " is-canvas-panning" : ""}`}
      onDragEnter={(event) => {
        if ([...event.dataTransfer.items].some((item) => item.kind === "file")) setDragActive(true);
      }}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragActive(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragActive(false);
        const file = event.dataTransfer.files[0];
        if (file) handleWorkspaceFile(file, null);
      }}
      onPointerDown={() => {
        setFileMenuOpen(false);
        setSelectMenuOpen(false);
        setLineMenuOpen(false);
        setShapeMenuOpen(false);
      }}
    >
      <canvas ref={canvasRef} className="cad-canvas" aria-label="Vectora drawing canvas" {...canvasProps} />
      {inlineTextEditor && (
        <input
          className="canvas-text-editor"
          type="text"
          aria-label="Text on canvas"
          autoFocus
          autoComplete="off"
          spellCheck
          placeholder="Type text"
          value={inlineTextEditor.value}
          style={{
            left: inlineTextEditor.left,
            top: inlineTextEditor.top,
            fontSize: inlineTextEditor.fontSize,
            width: Math.min(560, Math.max(128, (inlineTextEditor.value.length + 2) * inlineTextEditor.fontSize * 0.62)),
          }}
          onPointerDown={(event) => event.stopPropagation()}
          onChange={(event) => inlineTextEditor.onChange(event.target.value)}
          onBlur={inlineTextEditor.onCommit}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.nativeEvent.isComposing) {
              event.preventDefault();
              event.stopPropagation();
              inlineTextEditor.onCommit();
            } else if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              inlineTextEditor.onCancel();
            }
          }}
        />
      )}
      <AnimatePresence>
        {dragActive && (
          <motion.div
            className="file-drop-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{ pointerEvents: "none" }}
          >
            <Download size={28} />
            <strong>Drop to open</strong>
            <span>.vectora, SVG, DXF, PNG, JPEG or WebP</span>
          </motion.div>
        )}
      </AnimatePresence>
      <TopBar
        camOpen={camOpen}
        rasterOpen={rasterOpen}
        vectorizerOpen={vectorizerFile !== null}
        onOpenRaster={() => setRasterOpen((value) => !value)}
        onOpenVectorizer={openVectorizer}
        preview3dOpen={threePreviewOpen}
        onOpenCam={() => setCamOpen((value) => !value)}
        onOpenThreePreview={() => setThreePreviewOpen((value) => !value)}
        onOpenFile={openDocument}
        onOpenPreferences={() => togglePanel("preferences")}
        onFindTool={() => setCommandPaletteOpen(true)}
        onOpenHelp={() => setHelpOpen(true)}
        onNew={newDocument}
        onSave={() => saveDocument(false)}
        onSaveAs={() => saveDocument(true)}
      />
      <ToolDock onOpenGenerators={() => setGeneratorsOpen(true)} />
      <UtilityDock />
      <PreferencesModal open={preferencesOpen} onClose={() => togglePanel("preferences", false)} />
      <LayersPanel
        onCreateLayer={() => setLayerDialog({ mode: "create" })}
        onDeleteLayer={(layerId) => setLayerDialog({ mode: "delete", layerId })}
      />
      <SelectionActions onNest={() => setNestingOpen(true)} />
      {camOpen && <CamPanel open onClose={() => setCamOpen(false)} onOpenRaster={() => setRasterOpen(true)} />}
      <AnimatePresence>{propertiesOpen && <PropertyInspector />}</AnimatePresence>
      <Telemetry coordinateRef={coordinateRef} />
      <RasterPanel open={rasterOpen} onClose={() => setRasterOpen(false)}
        onOpenCam={() => { setRasterOpen(false); setCamOpen(true); }} />
      <CommandPalette
        onOpenGenerators={() => setGeneratorsOpen(true)}
        onOpenCam={() => setCamOpen(true)}
        onOpenRaster={() => setRasterOpen(true)}
        onOpenVectorizer={openVectorizer}
        onOpenThreePreview={() => setThreePreviewOpen(true)}
        onNest={() => setNestingOpen(true)}
        onOpenHelp={() => setHelpOpen(true)}
      />
      <GeneratorModal
        open={generatorsOpen}
        onClose={() => setGeneratorsOpen(false)}
        setPreview={setGeneratorPreview}
      />
      <NestingModal open={nestingOpen} onClose={() => setNestingOpen(false)} />
      <VectorizerModal file={vectorizerFile} onClose={() => setVectorizerFile(null)} />
      {threePreviewOpen && (
        <Suspense fallback={<div className="three-preview-backdrop"><div className="three-preview-loading surface"><Box size={24} /><span>Loading 3D preview…</span></div></div>}>
          <ThreePreviewModal open onClose={() => setThreePreviewOpen(false)} />
        </Suspense>
      )}
      <HelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />
      <AnimatePresence>
        {layerDialog && <LayerDialog state={layerDialog} onClose={() => setLayerDialog(null)} />}
      </AnimatePresence>
      <UnsavedChangesModal
        pending={pendingDocumentAction}
        saving={savingBeforeAction}
        onCancel={() => setPendingDocumentAction(null)}
        onDiscard={discardAndContinue}
        onSave={saveAndContinue}
      />
      <RecoveryDialog />
      <ToastViewport />
    </main>
  );
}

function NodeEditIcon({ size = 24, ...props }: SVGProps<SVGSVGElement> & { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M4 17C7 6 17 6 20 17" />
      <path d="M7 12h10" opacity=".65" />
      <circle cx="7" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="17" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <rect x="2.5" y="15.5" width="3" height="3" fill="currentColor" stroke="none" />
      <rect x="18.5" y="15.5" width="3" height="3" fill="currentColor" stroke="none" />
    </svg>
  );
}

function PenLineIcon({ size = 24, ...props }: SVGProps<SVGSVGElement> & { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}><path d="M3 17l4-5 4 3 7-9"/><circle cx="3" cy="17" r="1" fill="currentColor" stroke="none"/><circle cx="11" cy="15" r="1" fill="currentColor" stroke="none"/><circle cx="18" cy="6" r="1" fill="currentColor" stroke="none"/></svg>;
}

function DimensionIcon({ size = 24, ...props }: SVGProps<SVGSVGElement> & { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...props}><path d="M4 5v14M20 5v14M4 12h16"/><path d="m7 9-3 3 3 3M17 9l3 3-3 3"/></svg>;
}

function RadialDimensionIcon({ size = 24, ...props }: SVGProps<SVGSVGElement> & { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...props}><circle cx="11" cy="13" r="7"/><path d="m11 13 7-7M15 6h3v3"/><circle cx="11" cy="13" r="1" fill="currentColor" stroke="none"/></svg>;
}

function LeaderIcon({ size = 24, ...props }: SVGProps<SVGSVGElement> & { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...props}><path d="m4 18 7-7h9M4 18l2-5 3 3-5 2Z"/><path d="M14 7h6M14 4h6"/></svg>;
}

function MeasureIcon({ size = 24, ...props }: SVGProps<SVGSVGElement> & { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...props}><path d="M4 17 17 4l3 3L7 20 4 17Z"/><path d="m9 12 3 3M12 9l2 2M6 15l2 2"/></svg>;
}

function RasterVectorIcon({ size = 24, ...props }: SVGProps<SVGSVGElement> & { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <rect x="2.5" y="4" width="3.5" height="3.5" rx="0.55" fill="currentColor" stroke="none" opacity="0.7" />
      <rect x="2.5" y="9.5" width="3.5" height="3.5" rx="0.55" fill="currentColor" stroke="none" opacity="0.88" />
      <rect x="8" y="9.5" width="3.5" height="3.5" rx="0.55" fill="currentColor" stroke="none" opacity="0.7" />
      <path d="M8 6h4.25" />
      <path d="m10.5 4.25 1.75 1.75-1.75 1.75" />
      <path d="M13.75 19c.55-5.25 3.1-8.65 7.75-13" />
      <circle cx="13.75" cy="19" r="1.25" fill="white" />
      <circle cx="17.15" cy="11.65" r="1" fill="white" />
      <circle cx="21.5" cy="6" r="1.25" fill="white" />
    </svg>
  );
}

function ArcIcon({ size = 24, ...props }: SVGProps<SVGSVGElement> & { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" {...props}><path d="M4 18A10 10 0 0 1 19 6"/><path d="M4 18h4M19 6v4"/></svg>;
}

import { drawRasterImage } from "../renderer/RasterOverlay";
import { imageCorners } from "../cam/rasterCamEngine";
import { useCamCalibrationStore } from "../store/useCamCalibrationStore";
import { useCallback, useEffect, useRef, useState } from "react";
import { useMachineStore } from "../store/useMachineStore";
import {
  toolpathSimulator,
  type MotionSegment,
  type SimulatorHoldingTabMarker,
} from "../cam/ToolpathSimulator";
import {
  createTextEntity,
  useCreationStateMachine,
  type CanvasInteractionRenderState,
} from "../canvas/useCreationStateMachine";
import { useNodeEditStateMachine } from "../canvas/useNodeEditStateMachine";
import { useEraserStateMachine, type SegmentErasePreview } from "../canvas/useEraserStateMachine";
import { useFillTool } from "../canvas/useFillTool";
import { calculateMeasurement, useMeasureTool, type MeasureRenderState } from "../canvas/useMeasureTool";
import { calculateEntityBounds, documentModel, type DocumentChange } from "../document/DocumentModel";
import { AddEntityCommand, executeCommand } from "../document/History";
import type { CadDocument, DimensionEntity, DocumentUnits, Entity, Layer, LeaderEntity, TextEntity } from "../document/types";
import { formatDimensionText, getDimensionGeometry } from "../geometry/annotations";
import { getWorldGridSpacing, resolveDraftingSnap, SNAP_INDICATOR_SPEC, snapWorldPointToGrid, type SnapResult } from "../geometry/Snapping";
import { getPolylineSegment, tracePolyline } from "../geometry/bezier";
import { drawIsometricGrid } from "../renderer/IsometricGrid";
import { drawLeadMarkers } from "../renderer/LeadOverlay";
import { pathCache } from "../renderer/PathCache";
import { drawTransformOverlay, getSelectionBounds } from "../renderer/TransformOverlay";
import { useVectorStore, type GridStyle, type Point, type ThemeMode, type ToolId, type Viewport } from "../store/useVectorStore";
import { vectoraRenderColors, vectoraRenderOpacity } from "../design/vectoraRenderColors";

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 4;
let inlineTextSequence = 0;

interface InlineTextDraft {
  readonly entity: TextEntity;
  readonly left: number;
  readonly baseline: number;
  readonly fontSize: number;
  readonly value: string;
}

function drawMachinePosition(context: CanvasRenderingContext2D, width: number, height: number, viewport: Viewport): void {
  const machine = useMachineStore.getState();
  const transform = machine.jobTransform;
  const document = documentModel.getDocument();
  if (!machine.showPositionMarker || machine.connectionStatus !== "connected" || !machine.workPositionKnown || !transform
    || transform.documentId !== document.id || transform.documentVersion !== document.version) return;
  const x = (machine.workPosition.x - transform.offsetX) / transform.mmPerUnit;
  const y = (machine.workPosition.y - transform.offsetY) / transform.mmPerUnit;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  const screenX = width / 2 + viewport.x + x * viewport.zoom;
  const screenY = height / 2 + viewport.y - y * viewport.zoom;
  context.save();
  context.translate(screenX, screenY);
  context.strokeStyle = vectoraRenderColors.machine.position;
  context.fillStyle = vectoraRenderColors.machine.position;
  context.lineWidth = 2;
  context.setLineDash([]);
  context.beginPath();
  context.arc(0, 0, 8, 0, Math.PI * 2);
  context.moveTo(-13, 0); context.lineTo(13, 0);
  context.moveTo(0, -13); context.lineTo(0, 13);
  context.stroke();
  context.font = "11px monospace";
  context.fillText("LIVE HEAD", 16, -10);
  context.restore();
}

function drawGrid(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  viewport: Viewport,
  gridSize: number,
  gridStyle: GridStyle,
  gridVisible: boolean,
  themeMode: ThemeMode,
) {
  const colors = CANVAS_THEME_COLORS[themeMode];
  context.fillStyle = colors.background;
  context.fillRect(0, 0, width, height);
  if (!gridVisible) return;

  const minorStep = gridSize * viewport.zoom;
  if (!Number.isFinite(minorStep) || minorStep <= 0) return;
  // Avoid pathological loops for invalid/extremely dense imported settings.
  // We never substitute a coarser lattice because that would desynchronise snap.
  if (minorStep < 0.5) return;
  const columnCount = Math.ceil(width / minorStep) + 1;
  const rowCount = Math.ceil(height / minorStep) + 1;
  if (gridStyle === "dots" && columnCount * rowCount > 200_000) return;
  if (gridStyle !== "dots" && columnCount + rowCount > 20_000) return;
  const majorStep = minorStep * 5;
  const originX = width / 2 + viewport.x;
  const originY = height / 2 + viewport.y;

  if (gridStyle === "dots") {
    drawGridDots(context, width, height, originX, originY, minorStep, 0.9, colors.minorGridDot);
    drawGridDots(context, width, height, originX, originY, majorStep, 1.4, colors.majorGridDot);
    return;
  }
  if (gridStyle === "isometric") {
    drawIsometricGrid(context, width, height, originX, originY, minorStep, colors.minorGrid);
    drawIsometricGrid(context, width, height, originX, originY, majorStep, colors.majorGrid);
    return;
  }
  drawGridLines(context, width, height, originX, originY, minorStep, colors.minorGrid);
  drawGridLines(context, width, height, originX, originY, majorStep, colors.majorGrid);
}

function drawWorkArea(
  context: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  viewport: Viewport,
  document: Readonly<CadDocument>,
  themeMode: ThemeMode,
): void {
  const workArea = document.workArea;
  if (!workArea?.enabled) return;
  const left = canvasWidth / 2 + viewport.x;
  const bottom = canvasHeight / 2 + viewport.y;
  const width = workArea.width * viewport.zoom;
  const height = workArea.height * viewport.zoom;
  const top = bottom - height;
  if (![left, bottom, width, height, top].every(Number.isFinite) || width <= 0 || height <= 0) return;
  const colors = CANVAS_THEME_COLORS[themeMode];

  context.save();
  context.beginPath();
  context.rect(0, 0, canvasWidth, canvasHeight);
  context.rect(left, top, width, height);
  context.fillStyle = colors.workAreaOutside;
  context.fill("evenodd");
  context.strokeStyle = colors.workAreaBorder;
  context.lineWidth = 2;
  context.setLineDash([]);
  context.strokeRect(left, top, width, height);

  if (width >= 96 && height >= 32 && top >= -28 && top <= canvasHeight - 20 && left < canvasWidth && left + width > 0) {
    const format = (value: number) => Number(value.toFixed(4)).toString();
    const label = `${format(workArea.width)} × ${format(workArea.height)} ${document.units}`;
    context.font = "500 10px monospace";
    const labelWidth = Math.ceil(context.measureText(label).width) + 14;
    const labelX = Math.max(6, Math.min(canvasWidth - labelWidth - 6, left + 8));
    const labelY = Math.max(6, Math.min(canvasHeight - 24, top + 8));
    context.fillStyle = colors.workAreaLabelBackground;
    context.fillRect(labelX, labelY, labelWidth, 20);
    context.fillStyle = colors.workAreaLabelText;
    context.textBaseline = "middle";
    context.fillText(label, labelX + 7, labelY + 10);
  }
  context.restore();
}

const CANVAS_THEME_COLORS: Readonly<Record<ThemeMode, {
  readonly background: string;
  readonly minorGrid: string;
  readonly majorGrid: string;
  readonly minorGridDot: string;
  readonly majorGridDot: string;
  readonly crosshair: string;
  readonly badgeBackground: string;
  readonly badgeBorder: string;
  readonly badgeText: string;
  readonly workAreaOutside: string;
  readonly workAreaBorder: string;
  readonly workAreaLabelBackground: string;
  readonly workAreaLabelText: string;
}>> = Object.freeze({
  "light-glass": Object.freeze({
    background: "#f8fafc",
    minorGrid: "rgba(138, 158, 182, 0.13)",
    majorGrid: "rgba(111, 138, 170, 0.18)",
    minorGridDot: "rgba(89, 111, 139, 0.42)",
    majorGridDot: "rgba(54, 82, 118, 0.62)",
    crosshair: "rgba(37, 99, 235, 0.42)",
    badgeBackground: "rgba(255, 255, 255, 0.94)",
    badgeBorder: "rgba(86, 106, 132, 0.2)",
    badgeText: "#536278",
    workAreaOutside: "rgba(74, 91, 116, 0.08)",
    workAreaBorder: "rgba(37, 99, 235, 0.78)",
    workAreaLabelBackground: "rgba(255, 255, 255, 0.94)",
    workAreaLabelText: "#38547a",
  }),
  "dark-cad": Object.freeze({
    background: "#09111c",
    minorGrid: "rgba(109, 139, 173, 0.12)",
    majorGrid: "rgba(117, 158, 205, 0.24)",
    minorGridDot: "rgba(139, 179, 224, 0.46)",
    majorGridDot: "rgba(164, 205, 252, 0.72)",
    crosshair: "rgba(80, 157, 255, 0.62)",
    badgeBackground: "rgba(13, 24, 38, 0.94)",
    badgeBorder: "rgba(113, 153, 199, 0.35)",
    badgeText: "#c4d4e8",
    workAreaOutside: "rgba(0, 0, 0, 0.28)",
    workAreaBorder: "rgba(80, 157, 255, 0.9)",
    workAreaLabelBackground: "rgba(13, 24, 38, 0.94)",
    workAreaLabelText: "#d9e8fb",
  }),
  "high-contrast": Object.freeze({
    background: "#ffffff",
    minorGrid: "rgba(0, 0, 0, 0.16)",
    majorGrid: "rgba(0, 0, 0, 0.38)",
    minorGridDot: "rgba(0, 0, 0, 0.58)",
    majorGridDot: "rgba(0, 0, 0, 0.86)",
    crosshair: "rgba(0, 64, 255, 0.88)",
    badgeBackground: "#000000",
    badgeBorder: "#ffffff",
    badgeText: "#ffffff",
    workAreaOutside: "rgba(0, 0, 0, 0.1)",
    workAreaBorder: "#000000",
    workAreaLabelBackground: "#000000",
    workAreaLabelText: "#ffffff",
  }),
});

function drawGridLines(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  originX: number,
  originY: number,
  step: number,
  color: string,
): void {
  context.beginPath();
  const offsetX = ((originX % step) + step) % step;
  const offsetY = ((originY % step) + step) % step;
  for (let x = offsetX; x <= width; x += step) {
    context.moveTo(x, 0);
    context.lineTo(x, height);
  }
  for (let y = offsetY; y <= height; y += step) {
    context.moveTo(0, y);
    context.lineTo(width, y);
  }
  context.strokeStyle = color;
  context.lineWidth = 1;
  context.stroke();
}

function drawGridDots(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  originX: number,
  originY: number,
  step: number,
  radius: number,
  color: string,
): void {
  const offsetX = ((originX % step) + step) % step;
  const offsetY = ((originY % step) + step) % step;
  context.beginPath();
  for (let x = offsetX; x <= width; x += step) {
    for (let y = offsetY; y <= height; y += step) {
      context.moveTo(x + radius, y);
      context.arc(x, y, radius, 0, Math.PI * 2);
    }
  }
  context.fillStyle = color;
  context.fill();
}



function setVisibleWorldBounds(
  width: number,
  height: number,
  viewport: Viewport,
  target: { minX: number; minY: number; maxX: number; maxY: number },
): void {
  const originX = width / 2 + viewport.x;
  const originY = height / 2 + viewport.y;
  target.minX = -originX / viewport.zoom;
  target.minY = (originY - height) / viewport.zoom;
  target.maxX = (width - originX) / viewport.zoom;
  target.maxY = originY / viewport.zoom;
}

const viewportBoundsScratch = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
const renderCandidates: Entity[] = [];
const renderedSelectedEntities: Entity[] = [];
const renderedAnnotations: Array<DimensionEntity | LeaderEntity> = [];
const renderedTextEntities: TextEntity[] = [];
const dimensionTextCache = new WeakMap<DimensionEntity, { readonly text: string; readonly angle: number }>();
const textFontCache = new WeakMap<TextEntity, { readonly zoom: number; readonly font: string }>();
const selectedOverlayEntities: Entity[] = [];
const dashScratch: number[] = [];
const dashPairScratch = [0, 0];
const emptyDash: number[] = [];

function setDashPair(context: CanvasRenderingContext2D, dash: number, gap: number): void {
  dashPairScratch[0] = dash;
  dashPairScratch[1] = gap;
  context.setLineDash(dashPairScratch);
}

function applyEntityStyle(
  context: CanvasRenderingContext2D,
  entity: Entity,
  layer: Layer | undefined,
  zoom: number,
): void {
  context.strokeStyle = entity.style.strokeColor ?? layer?.color ?? "#64748b";
  context.lineWidth = Math.max(0.5, entity.style.strokeWidth) / zoom;
  dashScratch.length = entity.style.dashArray.length;
  for (let index = 0; index < entity.style.dashArray.length; index += 1) {
    dashScratch[index] = (entity.style.dashArray[index] ?? 0) / zoom;
  }
  context.setLineDash(dashScratch);
  context.lineJoin = "round";
  context.lineCap = "round";
}

/** Traces the small mutable interaction overlay without allocating a Path2D. */
function traceEntity(context: CanvasRenderingContext2D, entity: Entity): void {
  context.beginPath();
  switch (entity.type) {
    case "image": {
      const corners = imageCorners(entity);
      context.moveTo(corners[0]!.x, corners[0]!.y);
      for (const p of corners.slice(1)) context.lineTo(p.x, p.y);
      context.closePath(); break;
    }
    case "line":
      context.moveTo(entity.start.x, entity.start.y);
      context.lineTo(entity.end.x, entity.end.y);
      break;
    case "polyline": {
      tracePolyline(context, entity.points, entity.closed, entity.segments);
      break;
    }
    case "rectangle": {
      const radius = Math.min(
        Math.max(0, entity.cornerRadius),
        Math.min(Math.abs(entity.width), Math.abs(entity.height)) / 2,
      );
      if (radius > 0) context.roundRect(entity.origin.x, entity.origin.y, entity.width, entity.height, radius);
      else context.rect(entity.origin.x, entity.origin.y, entity.width, entity.height);
      break;
    }
    case "circle":
      context.arc(entity.center.x, entity.center.y, entity.radius, 0, Math.PI * 2);
      break;
    case "arc":
      context.arc(entity.center.x, entity.center.y, entity.radius, entity.startAngle, entity.endAngle, entity.counterClockwise);
      break;
    case "ellipse":
      context.ellipse(entity.cx, entity.cy, entity.rx, entity.ry, entity.rotation, 0, Math.PI * 2);
      context.closePath();
      break;
    case "polygon":
      for (let index = 0; index < entity.sides; index += 1) {
        const angle = entity.rotation + (index * Math.PI * 2) / entity.sides;
        const x = entity.cx + Math.cos(angle) * entity.radius;
        const y = entity.cy + Math.sin(angle) * entity.radius;
        if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
      }
      context.closePath();
      break;
    case "quadrant": {
      const start = (entity.quadrantIndex - 1) * Math.PI / 2;
      context.moveTo(entity.cx, entity.cy);
      context.lineTo(entity.cx + Math.cos(start) * entity.radius, entity.cy + Math.sin(start) * entity.radius);
      context.arc(entity.cx, entity.cy, entity.radius, start, start + Math.PI / 2);
      context.closePath();
      break;
    }
    case "semicircle":
      context.moveTo(entity.cx, entity.cy);
      context.lineTo(entity.cx + Math.cos(entity.startAngle) * entity.radius, entity.cy + Math.sin(entity.startAngle) * entity.radius);
      context.arc(entity.cx, entity.cy, entity.radius, entity.startAngle, entity.startAngle + Math.PI);
      context.closePath();
      break;
    case "segment":
      context.moveTo(entity.cx, entity.cy);
      context.lineTo(entity.cx + Math.cos(entity.startAngle) * entity.radius, entity.cy + Math.sin(entity.startAngle) * entity.radius);
      context.arc(entity.cx, entity.cy, entity.radius, entity.startAngle, entity.endAngle);
      context.closePath();
      break;
    case "star":
      for (let index = 0; index < entity.points * 2; index += 1) {
        const radius = index % 2 === 0 ? entity.outerRadius : entity.innerRadius;
        const angle = entity.rotation + (index * Math.PI) / entity.points;
        const x = entity.cx + Math.cos(angle) * radius;
        const y = entity.cy + Math.sin(angle) * radius;
        if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
      }
      context.closePath();
      break;
    case "cloud": {
      const first = entity.points[0];
      if (!first) break;
      let cx = 0;
      let cy = 0;
      for (const point of entity.points) { cx += point.x; cy += point.y; }
      cx /= entity.points.length;
      cy /= entity.points.length;
      context.moveTo(first.x, first.y);
      for (let index = 0; index < entity.points.length; index += 1) {
        const start = entity.points[index]!;
        const end = entity.points[(index + 1) % entity.points.length]!;
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const length = Math.hypot(dx, dy) || 1;
        const midX = (start.x + end.x) / 2;
        const midY = (start.y + end.y) / 2;
        let nx = -dy / length;
        let ny = dx / length;
        if (nx * (midX - cx) + ny * (midY - cy) < 0) { nx = -nx; ny = -ny; }
        const bulge = Math.min(entity.arcRadius, length / 2);
        context.quadraticCurveTo(midX + nx * bulge, midY + ny * bulge, end.x, end.y);
      }
      context.closePath();
      break;
    }
    case "text":
      break;
    case "dimension": {
      const geometry = getDimensionGeometry(entity);
      if (geometry.extensionStart) {
        context.moveTo(geometry.extensionStart[0].x, geometry.extensionStart[0].y);
        context.lineTo(geometry.extensionStart[1].x, geometry.extensionStart[1].y);
      }
      if (geometry.extensionEnd) {
        context.moveTo(geometry.extensionEnd[0].x, geometry.extensionEnd[0].y);
        context.lineTo(geometry.extensionEnd[1].x, geometry.extensionEnd[1].y);
      }
      context.moveTo(geometry.dimensionStart.x, geometry.dimensionStart.y);
      context.lineTo(geometry.dimensionEnd.x, geometry.dimensionEnd.y);
      for (const triangle of geometry.arrowheads) {
        context.moveTo(triangle[0].x, triangle[0].y);
        context.lineTo(triangle[1].x, triangle[1].y);
        context.lineTo(triangle[2].x, triangle[2].y);
        context.closePath();
      }
      break;
    }
    case "leader": {
      context.moveTo(entity.arrowPoint.x, entity.arrowPoint.y);
      context.lineTo(entity.elbowPoint.x, entity.elbowPoint.y);
      context.lineTo(entity.textPosition.x, entity.textPosition.y);
      const dx = entity.elbowPoint.x - entity.arrowPoint.x;
      const dy = entity.elbowPoint.y - entity.arrowPoint.y;
      const length = Math.hypot(dx, dy) || 1;
      const ux = dx / length;
      const uy = dy / length;
      const nx = -uy;
      const ny = ux;
      context.moveTo(entity.arrowPoint.x, entity.arrowPoint.y);
      context.lineTo(entity.arrowPoint.x + ux * 4 + nx * 1.52, entity.arrowPoint.y + uy * 4 + ny * 1.52);
      context.lineTo(entity.arrowPoint.x + ux * 4 - nx * 1.52, entity.arrowPoint.y + uy * 4 - ny * 1.52);
      context.closePath();
      break;
    }
  }
}

function drawSegmentErasePreview(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  viewport: Viewport,
  preview: SegmentErasePreview,
): void {
  context.save();
  context.translate(width / 2 + viewport.x, height / 2 + viewport.y);
  context.scale(viewport.zoom, -viewport.zoom);
  context.strokeStyle = vectoraRenderColors.ui.danger;
  context.lineWidth = 4 / viewport.zoom;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.setLineDash([]);
  context.beginPath();
  if (preview.source.type === "line" || preview.source.type === "arc") {
    traceEntity(context, preview.source);
  } else if (preview.editable) {
    const start = preview.editable.points[preview.segmentIndex];
    const end = preview.editable.points[(preview.segmentIndex + 1) % preview.editable.points.length];
    if (start && end) {
      const segment = getPolylineSegment(preview.editable.segments, preview.segmentIndex);
      context.beginPath();
      context.moveTo(start.x, start.y);
      if (segment.type === "quadratic") {
        context.quadraticCurveTo(segment.cp1.x, segment.cp1.y, end.x, end.y);
      } else if (segment.type === "cubic") {
        context.bezierCurveTo(segment.cp1.x, segment.cp1.y, segment.cp2.x, segment.cp2.y, end.x, end.y);
      } else {
        context.lineTo(end.x, end.y);
      }
    }
  }
  context.stroke();
  context.restore();
}

function drawLiveText(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  viewport: Viewport,
  entity: TextEntity,
  colorOverride?: string,
): void {
  const x = width / 2 + viewport.x + entity.x * viewport.zoom;
  const y = height / 2 + viewport.y - entity.y * viewport.zoom;
  const layer = documentModel.getLayer(entity.layerId);
  let font = textFontCache.get(entity);
  if (!font || font.zoom !== viewport.zoom) {
    font = {
      zoom: viewport.zoom,
      font: `400 ${Math.max(1, entity.fontSize * viewport.zoom)}px ${JSON.stringify(entity.fontFamily)}, sans-serif`,
    };
    textFontCache.set(entity, font);
  }
  context.save();
  context.font = font.font;
  context.textBaseline = "alphabetic";
  context.textAlign = "left";
  context.fillStyle = colorOverride ?? entity.style.fillColor ?? entity.style.strokeColor ?? layer?.color ?? "#475569";
  context.translate(x, y);
  context.scale(entity.flipHorizontal ? -1 : 1, entity.flipVertical ? -1 : 1);
  context.fillText(entity.text, 0, 0);
  context.restore();
}

function drawAnnotationText(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  viewport: Viewport,
  entity: DimensionEntity | LeaderEntity,
  themeMode: ThemeMode,
): void {
  const point = entity.textPosition;
  const x = width / 2 + viewport.x + point.x * viewport.zoom;
  const y = height / 2 + viewport.y - point.y * viewport.zoom;
  const layer = documentModel.getLayer(entity.layerId);
  const color = entity.style.strokeColor ?? layer?.color ?? "#475569";
  let text = entity.type === "dimension" ? "" : entity.text;
  let angle = 0;
  if (entity.type === "dimension") {
    let cached = dimensionTextCache.get(entity);
    if (!cached) {
      cached = { text: formatDimensionText(entity), angle: -getDimensionGeometry(entity).textAngle };
      dimensionTextCache.set(entity, cached);
    }
    text = cached.text;
    angle = cached.angle;
  }
  const fontSize = entity.type === "dimension"
    ? Math.max(10, Math.min(28, entity.arrowSize * 2.7 * viewport.zoom))
    : Math.max(10, Math.min(24, 11 * viewport.zoom));
  context.save();
  context.translate(Math.round(x) + 0.5, Math.round(y) + 0.5);
  context.rotate(angle);
  context.font = `600 ${fontSize}px "JetBrains Mono Variable", monospace`;
  context.textBaseline = "middle";
  context.textAlign = entity.type === "dimension" ? "center" : "left";
  context.lineWidth = 3;
  context.strokeStyle = themeMode === "dark-cad" ? "rgba(9, 17, 28, 0.94)" : "rgba(248, 250, 252, 0.94)";
  context.fillStyle = color;
  context.strokeText(text, entity.type === "leader" ? 5 : 0, 0);
  context.fillText(text, entity.type === "leader" ? 5 : 0, 0);
  context.restore();
}

function drawEntities(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  viewport: Viewport,
  transformPreview: readonly Entity[] | null,
  nodeEditEntityId: string | null,
  themeMode: ThemeMode,
): void {
  const document = documentModel.getDocument();
  const selection = document.selection;
  const maxPadding = 12 / viewport.zoom;
  setVisibleWorldBounds(width, height, viewport, viewportBoundsScratch);
  viewportBoundsScratch.minX -= maxPadding;
  viewportBoundsScratch.minY -= maxPadding;
  viewportBoundsScratch.maxX += maxPadding;
  viewportBoundsScratch.maxY += maxPadding;
  const visibleEntities = documentModel.queryVisibleEntities(viewportBoundsScratch, renderCandidates);
  renderedSelectedEntities.length = 0;
  renderedAnnotations.length = 0;
  renderedTextEntities.length = 0;

  context.save();
  context.translate(width / 2 + viewport.x, height / 2 + viewport.y);
  context.scale(viewport.zoom, -viewport.zoom);

  for (const entity of visibleEntities) {
    if (transformPreview && selection.has(entity.id)) continue;
    if (entity.id === nodeEditEntityId) continue;
    if (entity.type === "image") {
      const snapshot = documentModel.getDocument();
      const calibration = Number(useCamCalibrationStore.getState().inputsByDocument[snapshot.id]);
      const factor = snapshot.units === "in" ? 25.4 : snapshot.units === "px" ? (calibration > 0 ? 1 / calibration : 0) : 1;
      drawRasterImage(context, entity, factor);
    }
    if (entity.type === "text") renderedTextEntities.push(entity);
    const path = pathCache.peek(entity);
    if (!path) continue;
    applyEntityStyle(context, entity, documentModel.getLayer(entity.layerId), viewport.zoom);

    if (entity.style.fillColor) {
      context.fillStyle = entity.style.fillColor;
      context.fill(path, "evenodd");
    }
    if (entity.type === "dimension" || entity.type === "leader") {
      context.fillStyle = entity.style.strokeColor ?? documentModel.getLayer(entity.layerId)?.color ?? "#64748b";
      context.fill(path);
      renderedAnnotations.push(entity);
    }
    if (entity.style.strokeWidth > 0) context.stroke(path);
    if (selection.has(entity.id)) renderedSelectedEntities.push(entity);
  }

  // Selection is a separate pass so highlights remain visible above all entities.
  context.strokeStyle = vectoraRenderColors.ui.selection;
  context.lineWidth = 2 / viewport.zoom;
  context.setLineDash(emptyDash);
  context.lineJoin = "round";
  context.lineCap = "round";
  for (const entity of renderedSelectedEntities) {
    const path = pathCache.peek(entity);
    if (!path) continue;
    context.stroke(path);
    // Keep an explicit line color visible inside the selection highlight so
    // the Properties color picker gives immediate feedback on thin paths.
    if (entity.style.strokeColor && entity.style.strokeWidth > 0) {
      context.save();
      applyEntityStyle(context, entity, documentModel.getLayer(entity.layerId), viewport.zoom);
      context.stroke(path);
      context.restore();
    }
  }

  context.restore();
  for (const entity of renderedTextEntities) {
    drawLiveText(context, width, height, viewport, entity);
  }
  for (const annotation of renderedAnnotations) {
    drawAnnotationText(context, width, height, viewport, annotation, themeMode);
  }
}

interface ToolpathPathBatch {
  readonly plannedRapid: Path2D;
  readonly plannedCuts: ReadonlyMap<string, Path2D>;
  completedRapid: Path2D;
  completedCuts: Map<string, Path2D>;
  completedThrough: number;
}

const toolpathPathCache = new WeakMap<readonly MotionSegment[], ToolpathPathBatch>();

interface HoldingTabPathBatch {
  readonly gaps: Path2D;
}

const holdingTabPathCache = new WeakMap<readonly SimulatorHoldingTabMarker[], HoldingTabPathBatch>();

function getHoldingTabPathBatch(markers: readonly SimulatorHoldingTabMarker[]): HoldingTabPathBatch {
  const cached = holdingTabPathCache.get(markers);
  if (cached) return cached;
  const gaps = new Path2D();
  for (const marker of markers) {
    const first = marker.points[0];
    if (!first) continue;
    gaps.moveTo(first.x, first.y);
    for (let index = 1; index < marker.points.length; index += 1) {
      const point = marker.points[index]!;
      gaps.lineTo(point.x, point.y);
    }
  }
  const created = Object.freeze({ gaps });
  holdingTabPathCache.set(markers, created);
  return created;
}

function appendMotionSegment(
  path: Path2D,
  segment: MotionSegment,
  end: { readonly x: number; readonly y: number } = segment.end,
): void {
  path.moveTo(segment.start.x, segment.start.y);
  path.lineTo(end.x, end.y);
}

function buildToolpathBatch(segments: readonly MotionSegment[]): ToolpathPathBatch {
  const plannedRapid = new Path2D();
  const plannedCuts = new Map<string, Path2D>();
  for (const segment of segments) {
    // The image power map already displays raster detail at the exact pixel pitch.
    // Constant-width scan strokes would fill white cells and obscure dithering.
    if (segment.role === "raster-off" || segment.role === "raster-burn") continue;
    if (segment.kind === "rapid") appendMotionSegment(plannedRapid, segment);
    else {
      let path = plannedCuts.get(segment.color);
      if (!path) {
        path = new Path2D();
        plannedCuts.set(segment.color, path);
      }
      appendMotionSegment(path, segment);
    }
  }
  return {
    plannedRapid,
    plannedCuts,
    completedRapid: new Path2D(),
    completedCuts: new Map(),
    completedThrough: -1,
  };
}

function getToolpathBatch(segments: readonly MotionSegment[]): ToolpathPathBatch {
  const cached = toolpathPathCache.get(segments);
  if (cached) return cached;
  const created = buildToolpathBatch(segments);
  toolpathPathCache.set(segments, created);
  return created;
}

function prepareToolpathFrame(): void {
  const segments = toolpathSimulator.getSegments();
  if (segments.length > 0) {
    const batch = getToolpathBatch(segments);
    const snapshot = toolpathSimulator.getSnapshot();
    const segment = snapshot.currentSegmentIndex >= 0 ? segments[snapshot.currentSegmentIndex] : undefined;
    const fraction = segment && segment.duration > 1e-9
      ? Math.max(0, Math.min(1, (snapshot.currentTime - segment.startTime) / segment.duration))
      : 0;
    const completedThrough = Math.max(-1, segment && fraction >= 1
      ? snapshot.currentSegmentIndex
      : snapshot.currentSegmentIndex - 1);
    updateCompletedPaths(batch, segments, completedThrough);
  }
  const tabMarkers = toolpathSimulator.getHoldingTabMarkers();
  if (tabMarkers.length > 0) getHoldingTabPathBatch(tabMarkers);
}

function updateCompletedPaths(
  batch: ToolpathPathBatch,
  segments: readonly MotionSegment[],
  completedThrough: number,
): void {
  if (completedThrough < batch.completedThrough) {
    batch.completedRapid = new Path2D();
    batch.completedCuts = new Map();
    batch.completedThrough = -1;
  }
  for (let index = batch.completedThrough + 1; index <= completedThrough; index += 1) {
    const segment = segments[index];
    if (!segment) break;
    if (segment.role === "raster-off" || segment.role === "raster-burn") { batch.completedThrough = index; continue; }
    if (segment.kind === "rapid") appendMotionSegment(batch.completedRapid, segment);
    else {
      let path = batch.completedCuts.get(segment.color);
      if (!path) {
        path = new Path2D();
        batch.completedCuts.set(segment.color, path);
      }
      appendMotionSegment(path, segment);
    }
    batch.completedThrough = index;
  }
}

function drawToolpathOverlay(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  viewport: Viewport,
): void {
  const segments = toolpathSimulator.getSegments();
  if (segments.length === 0) return;
  const snapshot = toolpathSimulator.getSnapshot();
  const batch = toolpathPathCache.get(segments);
  if (!batch) return;
  const currentSegment = snapshot.currentSegmentIndex >= 0
    ? segments[snapshot.currentSegmentIndex]
    : undefined;
  const currentFraction = currentSegment && currentSegment.duration > 1e-9
    ? Math.max(0, Math.min(1, (snapshot.currentTime - currentSegment.startTime) / currentSegment.duration))
    : 0;
  context.save();
  context.translate(width / 2 + viewport.x, height / 2 + viewport.y);
  context.scale(viewport.zoom, -viewport.zoom);
  context.lineCap = "round";
  context.lineJoin = "round";

  // Planned paths are prebatched and cached by immutable motion-array identity.
  context.globalAlpha = vectoraRenderOpacity.plannedToolpath;
  context.strokeStyle = vectoraRenderColors.toolpath.rapid;
  context.lineWidth = 1 / viewport.zoom;
  setDashPair(context, 6 / viewport.zoom, 5 / viewport.zoom);
  context.stroke(batch.plannedRapid);
  context.globalAlpha = vectoraRenderOpacity.plannedToolpath;
  context.lineWidth = 2 / viewport.zoom;
  context.setLineDash(emptyDash);
  for (const [color, path] of batch.plannedCuts) {
    context.strokeStyle = color;
    context.stroke(path);
  }

  // Completed paths are incrementally cached; only the active segment changes per frame.
  context.globalAlpha = vectoraRenderOpacity.completedRapid;
  context.strokeStyle = vectoraRenderColors.toolpath.rapid;
  context.lineWidth = 1.25 / viewport.zoom;
  setDashPair(context, 6 / viewport.zoom, 4 / viewport.zoom);
  context.stroke(batch.completedRapid);
  context.globalAlpha = vectoraRenderOpacity.completedToolpath;
  context.lineWidth = 2.35 / viewport.zoom;
  context.setLineDash(emptyDash);
  for (const [color, path] of batch.completedCuts) {
    context.strokeStyle = color;
    context.stroke(path);
  }
  if (currentSegment && currentFraction > 0 && currentFraction < 1) {
    const activeX = currentSegment.start.x + (currentSegment.end.x - currentSegment.start.x) * currentFraction;
    const activeY = currentSegment.start.y + (currentSegment.end.y - currentSegment.start.y) * currentFraction;
    context.globalAlpha = currentSegment.kind === "rapid" ? vectoraRenderOpacity.completedRapid : vectoraRenderOpacity.completedToolpath;
    context.strokeStyle = currentSegment.color;
    context.lineWidth = (currentSegment.kind === "rapid" ? 1.25 : 2.35) / viewport.zoom;
    if (currentSegment.kind === "rapid") setDashPair(context, 6 / viewport.zoom, 4 / viewport.zoom);
    else context.setLineDash(emptyDash);
    context.beginPath();
    context.moveTo(currentSegment.start.x, currentSegment.start.y);
    context.lineTo(activeX, activeY);
    context.stroke();
  }

  drawLeadMarkers(context, toolpathSimulator.getLeadMarkers(), viewport.zoom);
  const tabMarkers = toolpathSimulator.getHoldingTabMarkers();
  const tabBatch = holdingTabPathCache.get(tabMarkers);
  if (toolpathSimulator.getShowHoldingTabs() && tabMarkers.length > 0 && tabBatch) {
    // A pale halo clears the cut color before the safety-orange laser-off gap.
    context.globalAlpha = 1;
    context.setLineDash(emptyDash);
    context.strokeStyle = vectoraRenderColors.ui.surface;
    context.lineWidth = 8 / viewport.zoom;
    context.stroke(tabBatch.gaps);
    context.strokeStyle = vectoraRenderColors.toolpath.holdingTab;
    context.lineWidth = 5 / viewport.zoom;
    context.stroke(tabBatch.gaps);
    context.fillStyle = vectoraRenderColors.toolpath.holdingTab;
    context.strokeStyle = vectoraRenderColors.ui.surface;
    context.lineWidth = 1.5 / viewport.zoom;
    context.beginPath();
    for (const marker of tabMarkers) {
      context.moveTo(marker.center.x + 3.5 / viewport.zoom, marker.center.y);
      context.arc(marker.center.x, marker.center.y, 3.5 / viewport.zoom, 0, Math.PI * 2);
    }
    context.fill();
    context.stroke();
  }
  context.restore();

  if (snapshot.currentPoint) {
    const x = width / 2 + viewport.x + snapshot.currentPoint.x * viewport.zoom;
    const y = height / 2 + viewport.y - snapshot.currentPoint.y * viewport.zoom;
    context.save();
    context.translate(x, y);
    context.globalAlpha = 1;
    context.setLineDash(emptyDash);
    if (snapshot.headStyle === "spindle") {
      context.strokeStyle = vectoraRenderColors.toolpath.head;
      context.lineWidth = 2;
      context.beginPath();
      context.arc(0, 0, 7, 0, Math.PI * 2);
      context.moveTo(-11, 0);
      context.lineTo(11, 0);
      context.moveTo(0, -11);
      context.lineTo(0, 11);
      context.stroke();
    } else {
      context.fillStyle = "rgb(180 35 24 / 18%)";
      context.beginPath();
      context.arc(0, 0, 9, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = vectoraRenderColors.toolpath.head;
      context.strokeStyle = vectoraRenderColors.ui.surface;
      context.lineWidth = 2;
      context.beginPath();
      context.arc(0, 0, 4.5, 0, Math.PI * 2);
      context.fill();
      context.stroke();
    }
    context.restore();
  }
}

function prepareChangedEntityPaths(document: Readonly<CadDocument>, change: DocumentChange): void {
  switch (change.type) {
    case "document-replaced":
      pathCache.prepareAll(document.entities.values());
      break;
    case "entity-added":
    case "entity-updated": {
      const entity = document.entities.get(change.entityId);
      if (entity) pathCache.prepare(entity);
      break;
    }
    case "entities-updated":
      for (const id of change.entityIds) {
        const entity = document.entities.get(id);
        if (entity) pathCache.prepare(entity);
      }
      break;
    case "entity-set-replaced":
      for (const id of change.addedIds) {
        const entity = document.entities.get(id);
        if (entity) pathCache.prepare(entity);
      }
      break;
    case "entity-removed":
    case "layer-added":
    case "layer-updated":
    case "layer-removed":
    case "active-layer-changed":
    case "work-area-changed":
    case "selection-changed":
      break;
  }
}

function drawInteractionOverlays(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  viewport: Viewport,
  interaction: CanvasInteractionRenderState,
  themeMode: ThemeMode,
  activeTool: ToolId,
): void {
  if (interaction.previewEntity || interaction.generatorPreview.length > 0) {
    context.save();
    context.translate(width / 2 + viewport.x, height / 2 + viewport.y);
    context.scale(viewport.zoom, -viewport.zoom);
    context.lineWidth = 1.5 / viewport.zoom;
    setDashPair(context, 6 / viewport.zoom, 4 / viewport.zoom);
    if (interaction.previewEntity) {
      const previewEntity = interaction.previewEntity;
      context.fillStyle = vectoraRenderColors.ui.selectionFill;
      context.strokeStyle = vectoraRenderColors.ui.selection;
      if (activeTool === "freehand") context.setLineDash([]);
      traceEntity(context, previewEntity);
      if (
        previewEntity.type === "rectangle" || previewEntity.type === "circle" ||
        previewEntity.type === "ellipse" || previewEntity.type === "polygon" ||
        previewEntity.type === "quadrant" || previewEntity.type === "semicircle" ||
        previewEntity.type === "segment" || previewEntity.type === "star" ||
        previewEntity.type === "cloud" ||
        (previewEntity.type === "polyline" && previewEntity.closed)
      ) context.fill("evenodd");
      if (previewEntity.type === "dimension" || previewEntity.type === "leader") context.fill();
      context.stroke();
      if (activeTool === "freehand") setDashPair(context, 6 / viewport.zoom, 4 / viewport.zoom);
    }
    for (const previewEntity of interaction.generatorPreview) {
      const path = pathCache.peek(previewEntity);
      if (!path) continue;
      context.fillStyle = vectoraRenderColors.ui.selectionFill;
      context.strokeStyle = vectoraRenderColors.ui.selection;
      if (
        previewEntity.type === "rectangle" ||
        previewEntity.type === "circle" ||
        (previewEntity.type === "polyline" && previewEntity.closed)
      ) context.fill(path, "evenodd");
      context.stroke(path);
    }
    context.restore();
    if (interaction.previewEntity?.type === "dimension" || interaction.previewEntity?.type === "leader") {
      drawAnnotationText(context, width, height, viewport, interaction.previewEntity, themeMode);
    }
  }

  if (interaction.transformPreview) {
    context.save();
    context.translate(width / 2 + viewport.x, height / 2 + viewport.y);
    context.scale(viewport.zoom, -viewport.zoom);
    context.strokeStyle = vectoraRenderColors.ui.selection;
    context.lineWidth = 2 / viewport.zoom;
    context.setLineDash(emptyDash);
    for (const entity of interaction.transformPreview) {
      traceEntity(context, entity);
      if (entity.style.fillColor) {
        context.fillStyle = entity.style.fillColor;
        context.fill("evenodd");
      }
      if (entity.type === "dimension" || entity.type === "leader") {
        context.fillStyle = vectoraRenderColors.ui.selection;
        context.fill();
      }
      context.stroke();
    }
    context.restore();
    for (const entity of interaction.transformPreview) {
      if (entity.type === "text") {
        drawLiveText(context, width, height, viewport, entity, vectoraRenderColors.ui.selection);
      } else if (entity.type === "dimension" || entity.type === "leader") {
        drawAnnotationText(context, width, height, viewport, entity, themeMode);
      }
    }
  }

  if (interaction.erasePreview) {
    drawSegmentErasePreview(context, width, height, viewport, interaction.erasePreview);
  }

  if (interaction.nodeEdit) {
    const nodeEdit = interaction.nodeEdit;
    const first = nodeEdit.points[0];
    if (first) {
      context.save();
      context.translate(width / 2 + viewport.x, height / 2 + viewport.y);
      context.scale(viewport.zoom, -viewport.zoom);
      context.strokeStyle = vectoraRenderColors.ui.selection;
      context.lineWidth = 2 / viewport.zoom;
      context.setLineDash(emptyDash);
      context.lineJoin = "round";
      context.beginPath();
      tracePolyline(context, nodeEdit.points, nodeEdit.closed, nodeEdit.segments);
      context.stroke();
      context.restore();

      context.save();
      context.strokeStyle = vectoraRenderColors.ui.selectionGuide;
      context.lineWidth = 1;
      context.setLineDash([]);
      for (const handle of nodeEdit.handles) {
        const anchor = nodeEdit.points[handle.anchorIndex];
        if (!anchor) continue;
        const anchorX = width / 2 + viewport.x + anchor.x * viewport.zoom;
        const anchorY = height / 2 + viewport.y - anchor.y * viewport.zoom;
        const handleX = width / 2 + viewport.x + handle.point.x * viewport.zoom;
        const handleY = height / 2 + viewport.y - handle.point.y * viewport.zoom;
        context.beginPath();
        context.moveTo(anchorX, anchorY);
        context.lineTo(handleX, handleY);
        context.stroke();
      }
      for (const handle of nodeEdit.handles) {
        const x = width / 2 + viewport.x + handle.point.x * viewport.zoom;
        const y = height / 2 + viewport.y - handle.point.y * viewport.zoom;
        const selected = nodeEdit.selectedHandle?.segmentIndex === handle.segmentIndex &&
          nodeEdit.selectedHandle.control === handle.control;
        context.beginPath();
        context.arc(x, y, 3.25, 0, Math.PI * 2);
        context.fillStyle = selected ? vectoraRenderColors.ui.selection : vectoraRenderColors.ui.surface;
        context.strokeStyle = selected ? vectoraRenderColors.ui.surface : vectoraRenderColors.ui.selection;
        context.fill();
        context.stroke();
      }
      context.lineWidth = 1.5;
      for (let index = 0; index < nodeEdit.points.length; index += 1) {
        const point = nodeEdit.points[index];
        if (!point) continue;
        const x = width / 2 + viewport.x + point.x * viewport.zoom;
        const y = height / 2 + viewport.y - point.y * viewport.zoom;
        const selected = index === nodeEdit.selectedVertex;
        const nodeType = nodeEdit.nodeTypes[index] ?? "corner";
        context.beginPath();
        if (nodeType === "smooth") {
          context.arc(x, y, 4, 0, Math.PI * 2);
        } else if (nodeType === "symmetric") {
          context.moveTo(x, y - 5);
          context.lineTo(x + 5, y);
          context.lineTo(x, y + 5);
          context.lineTo(x - 5, y);
          context.closePath();
        } else {
          context.rect(Math.round(x - 4) + 0.5, Math.round(y - 4) + 0.5, 8, 8);
        }
        context.fillStyle = selected ? vectoraRenderColors.ui.selection : vectoraRenderColors.ui.surface;
        context.strokeStyle = selected ? vectoraRenderColors.ui.surface : vectoraRenderColors.ui.selection;
        context.fill();
        context.stroke();
      }
      context.restore();
    }
  }

  if (interaction.marquee) {
    const startX = width / 2 + viewport.x + interaction.marquee.start.x * viewport.zoom;
    const startY = height / 2 + viewport.y - interaction.marquee.start.y * viewport.zoom;
    const endX = width / 2 + viewport.x + interaction.marquee.current.x * viewport.zoom;
    const endY = height / 2 + viewport.y - interaction.marquee.current.y * viewport.zoom;
    const left = Math.min(startX, endX);
    const top = Math.min(startY, endY);
    const boxWidth = Math.abs(endX - startX);
    const boxHeight = Math.abs(endY - startY);
    context.save();
    context.fillStyle = vectoraRenderColors.ui.selectionFill;
    context.strokeStyle = vectoraRenderColors.ui.selection;
    context.lineWidth = 1;
    setDashPair(context, 5, 4);
    context.fillRect(left, top, boxWidth, boxHeight);
    context.strokeRect(Math.round(left) + 0.5, Math.round(top) + 0.5, boxWidth, boxHeight);
    context.restore();
  }

  const document = documentModel.getDocument();
  selectedOverlayEntities.length = 0;
  if (interaction.transformPreview) {
    for (const entity of interaction.transformPreview) selectedOverlayEntities.push(entity);
  } else {
    for (const id of document.selection) {
      const entity = document.entities.get(id);
      if (entity?.visible && documentModel.getLayer(entity.layerId)?.visible) {
        selectedOverlayEntities.push(entity);
      }
    }
  }
  const selectionBounds = interaction.nodeEdit || activeTool !== "select"
    ? null
    : getSelectionBounds(selectedOverlayEntities);
  if (selectionBounds) {
    drawTransformOverlay(context, width, height, viewport, selectionBounds);
  }

  if (!interaction.nodeEdit && activeTool === "select" && document.selection.size > 1) {
    const primaryId = document.selection.values().next().value as string | undefined;
    const primaryEntity = primaryId
      ? selectedOverlayEntities.find((entity) => entity.id === primaryId)
      : undefined;
    if (primaryEntity) {
      const selectedInZOrder = documentModel.getEntitiesInZOrder()
        .filter((entity) => document.selection.has(entity.id));
      const primaryNumber = Math.max(1, selectedInZOrder.findIndex((entity) => entity.id === primaryId) + 1);
      drawPrimarySubjectIndicator(context, width, height, viewport, primaryEntity, primaryNumber);
    }
  }

  if (interaction.activeSnap) {
    drawSnapIndicator(context, width, height, viewport, interaction.activeSnap);
  }

  if (interaction.measure) drawMeasureOverlay(context, width, height, viewport, interaction.measure, themeMode);
}

function drawMeasureOverlay(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  viewport: Viewport,
  measure: MeasureRenderState,
  themeMode: ThemeMode,
): void {
  const startX = width / 2 + viewport.x + measure.start.x * viewport.zoom;
  const startY = height / 2 + viewport.y - measure.start.y * viewport.zoom;
  const endX = width / 2 + viewport.x + measure.end.x * viewport.zoom;
  const endY = height / 2 + viewport.y - measure.end.y * viewport.zoom;
  const measurement = calculateMeasurement(measure.start, measure.end);
  const units = documentModel.getDocument().units;
  const precision = useVectorStore.getState().preferences.drafting.decimalPrecision;
  const colors = CANVAS_THEME_COLORS[themeMode];
  context.save();
  context.strokeStyle = "#0f9f6e";
  context.fillStyle = "rgba(16, 185, 129, 0.10)";
  context.lineWidth = 1.5;
  setDashPair(context, 6, 4);
  context.beginPath();
  context.moveTo(startX, startY);
  context.lineTo(endX, endY);
  context.stroke();
  context.setLineDash(emptyDash);
  context.beginPath();
  context.arc(startX, startY, 4, 0, Math.PI * 2);
  context.fillStyle = "#ffffff";
  context.fill();
  context.stroke();
  context.beginPath();
  context.arc(endX, endY, 4, 0, Math.PI * 2);
  context.fill();
  context.stroke();
  const panelX = Math.min(width - 178, Math.max(8, endX + 13));
  const panelY = Math.min(height - 70, Math.max(8, endY - 35));
  context.fillStyle = colors.badgeBackground;
  context.strokeStyle = "rgba(15, 159, 110, 0.35)";
  context.beginPath();
  context.roundRect(panelX, panelY, 170, 62, 10);
  context.fill();
  context.stroke();
  context.fillStyle = colors.badgeText;
  context.font = '600 10px "JetBrains Mono Variable", monospace';
  context.textAlign = "left";
  context.textBaseline = "middle";
  context.fillText(`L ${measurement.distance.toFixed(precision)} ${units}`, panelX + 11, panelY + 13);
  context.fillText(`ΔX ${measurement.deltaX.toFixed(precision)}  ΔY ${measurement.deltaY.toFixed(precision)}`, panelX + 11, panelY + 31);
  context.fillText(`θ ${measurement.angleDegrees.toFixed(Math.max(1, precision))}°`, panelX + 11, panelY + 49);
  context.restore();
}

function drawPrimarySubjectIndicator(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  viewport: Viewport,
  entity: Entity,
  primaryNumber: number,
): void {
  context.save();
  context.translate(width / 2 + viewport.x, height / 2 + viewport.y);
  context.scale(viewport.zoom, -viewport.zoom);
  context.strokeStyle = vectoraRenderColors.ui.selection;
  context.lineWidth = 3 / viewport.zoom;
  setDashPair(context, 7 / viewport.zoom, 3 / viewport.zoom);
  traceEntity(context, entity);
  context.stroke();
  context.restore();

  const label = `${primaryNumber}  PRIMARY SUBJECT`;
  context.save();
  context.font = '600 10px "JetBrains Mono Variable", monospace';
  const labelWidth = Math.ceil(context.measureText(label).width) + 18;
  const labelHeight = 24;
  const rawX = width / 2 + viewport.x + entity.bbox.minX * viewport.zoom;
  const rawY = height / 2 + viewport.y - entity.bbox.maxY * viewport.zoom - labelHeight - 7;
  const x = Math.min(width - labelWidth - 8, Math.max(8, rawX));
  const y = Math.min(height - labelHeight - 8, Math.max(8, rawY));
  context.fillStyle = vectoraRenderColors.ui.selectionLabel;
  context.beginPath();
  context.roundRect(Math.round(x), Math.round(y), labelWidth, labelHeight, 7);
  context.fill();
  context.fillStyle = vectoraRenderColors.ui.surface;
  context.textBaseline = "middle";
  context.fillText(label, Math.round(x) + 9, Math.round(y) + labelHeight / 2);
  context.restore();
}

function drawSnapIndicator(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  viewport: Viewport,
  snapResult: SnapResult,
): void {
  const x = width / 2 + viewport.x + snapResult.point.x * viewport.zoom;
  const y = height / 2 + viewport.y - snapResult.point.y * viewport.zoom;
  const spec = SNAP_INDICATOR_SPEC[snapResult.type];
  const half = spec.sizePx / 2;

  context.save();
  context.translate(Math.round(x) + 0.5, Math.round(y) + 0.5);
  context.strokeStyle = spec.color;
  context.fillStyle = spec.fill;
  context.lineWidth = spec.lineWidthPx;
  context.setLineDash(emptyDash);
  context.beginPath();
  switch (snapResult.type) {
    case "endpoint":
      context.rect(-half, -half, spec.sizePx, spec.sizePx);
      break;
    case "midpoint":
      context.moveTo(0, -half);
      context.lineTo(half, half);
      context.lineTo(-half, half);
      context.closePath();
      break;
    case "center":
      context.arc(0, 0, half, 0, Math.PI * 2);
      break;
    case "intersection":
      context.moveTo(0, -half);
      context.lineTo(half, 0);
      context.lineTo(0, half);
      context.lineTo(-half, 0);
      context.closePath();
      break;
  }
  context.fill();
  context.stroke();
  context.restore();
}

function drawCadCrosshair(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  point: { readonly x: number; readonly y: number },
  themeMode: ThemeMode,
): void {
  context.save();
  context.setLineDash(emptyDash);
  context.strokeStyle = CANVAS_THEME_COLORS[themeMode].crosshair;
  context.lineWidth = themeMode === "high-contrast" ? 1.5 : 1;
  context.beginPath();
  context.moveTo(0, Math.round(point.y) + 0.5);
  context.lineTo(width, Math.round(point.y) + 0.5);
  context.moveTo(Math.round(point.x) + 0.5, 0);
  context.lineTo(Math.round(point.x) + 0.5, height);
  context.stroke();
  context.beginPath();
  context.arc(point.x, point.y, 5, 0, Math.PI * 2);
  context.stroke();
  context.restore();
}

interface FrameStats {
  lastTimestamp: number;
  frameTimeMs: number;
  fps: number;
}

function updateFrameStats(stats: FrameStats, timestamp: number): void {
  if (stats.lastTimestamp > 0) {
    const elapsed = Math.min(250, Math.max(0.01, timestamp - stats.lastTimestamp));
    stats.frameTimeMs = stats.frameTimeMs === 0 ? elapsed : stats.frameTimeMs * 0.88 + elapsed * 0.12;
    stats.fps = 1_000 / stats.frameTimeMs;
  }
  stats.lastTimestamp = timestamp;
}

function drawFpsBadge(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  stats: FrameStats,
  themeMode: ThemeMode,
): void {
  const colors = CANVAS_THEME_COLORS[themeMode];
  const badgeWidth = 132;
  const badgeHeight = 36;
  const x = width - badgeWidth - 18;
  const y = height - badgeHeight - 82;
  context.save();
  context.fillStyle = colors.badgeBackground;
  context.strokeStyle = colors.badgeBorder;
  context.lineWidth = 1;
  context.beginPath();
  context.roundRect(x, y, badgeWidth, badgeHeight, 10);
  context.fill();
  context.stroke();
  context.fillStyle = colors.badgeText;
  context.font = '600 10px "JetBrains Mono Variable", monospace';
  context.textBaseline = "middle";
  context.textAlign = "left";
  context.fillText(`${Math.round(stats.fps)} FPS`, x + 11, y + badgeHeight / 2);
  context.textAlign = "right";
  context.globalAlpha = 0.72;
  context.fillText(`${stats.frameTimeMs.toFixed(1)} ms`, x + badgeWidth - 11, y + badgeHeight / 2);
  context.restore();
}

export function useCanvasEngine() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const coordinateRef = useRef<HTMLSpanElement>(null);
  const contextRef = useRef<CanvasRenderingContext2D | null>(null);
  const frameRef = useRef<number | null>(null);
  const metricsRef = useRef({ left: 0, top: 0, width: 0, height: 0, dpr: 1 });
  const viewportRef = useRef<Viewport>(useVectorStore.getState().viewport);
  const livePanViewportRef = useRef({ x: 0, y: 0, zoom: 1 });
  const coordinateValueRef = useRef<{ x: number; y: number; units: DocumentUnits; precision: number }>({
    x: Number.NaN,
    y: Number.NaN,
    units: documentModel.getDocument().units,
    precision: -1,
  });
  const pointerPositionRef = useRef({ x: 0, y: 0, visible: false });
  const frameStatsRef = useRef<FrameStats>({ lastTimestamp: 0, frameTimeMs: 1000 / 60, fps: 60 });
  const repeatDrawRef = useRef<() => void>(() => undefined);
  const panRef = useRef<{ pointerId: number; start: Point; viewport: Viewport } | null>(null);
  const inlineTextDraftRef = useRef<InlineTextDraft | null>(null);
  const [inlineTextDraft, setInlineTextDraft] = useState<InlineTextDraft | null>(null);
  const interactionRef = useRef<CanvasInteractionRenderState>({
    previewEntity: null,
    generatorPreview: [],
    transformPreview: null,
    marquee: null,
    activeSnap: null,
    nodeEdit: null,
    measure: null,
    erasePreview: null,
  });

  const screenToWorld = useCallback((clientX: number, clientY: number) => {
    const metrics = metricsRef.current;
    const viewport = viewportRef.current;
    return {
      x: (clientX - metrics.left - metrics.width / 2 - viewport.x) / viewport.zoom,
      y: -(clientY - metrics.top - metrics.height / 2 - viewport.y) / viewport.zoom,
    };
  }, []);

  const finishInlineText = useCallback((commit: boolean) => {
    const draft = inlineTextDraftRef.current;
    if (!draft) return;
    inlineTextDraftRef.current = null;
    setInlineTextDraft(null);
    if (!commit || draft.value.trim().length === 0) return;
    const entity = { ...draft.entity, text: draft.value };
    executeCommand(new AddEntityCommand({ ...entity, bbox: calculateEntityBounds(entity) }));
  }, []);

  const beginInlineText = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    finishInlineText(true);
    const raw = screenToWorld(event.clientX, event.clientY);
    const origin = resolveDraftingSnap({
      cursor: raw,
      zoom: viewportRef.current.zoom,
    }).point;
    inlineTextSequence += 1;
    const id = globalThis.crypto?.randomUUID?.() ?? `text-${Date.now().toString(36)}-${inlineTextSequence}`;
    const entity = createTextEntity(id, origin, undefined, "");
    if (!entity) return;
    const metrics = metricsRef.current;
    const fontSize = Math.max(14, entity.fontSize * viewportRef.current.zoom);
    const draft: InlineTextDraft = {
      entity,
      left: event.clientX - metrics.left,
      baseline: event.clientY - metrics.top,
      fontSize,
      value: "",
    };
    inlineTextDraftRef.current = draft;
    setInlineTextDraft(draft);
    interactionRef.current.activeSnap = null;
    event.preventDefault();
  }, [finishInlineText, screenToWorld]);

  const updateInlineText = useCallback((value: string) => {
    const draft = inlineTextDraftRef.current;
    if (!draft) return;
    const next = { ...draft, value };
    inlineTextDraftRef.current = next;
    setInlineTextDraft(next);
  }, []);

  const updateCoordinates = useCallback((pointX: number, pointY: number) => {
    const precision = useVectorStore.getState().preferences.drafting.decimalPrecision;
    const units = documentModel.getDocument().units;
    const x = Number(pointX.toFixed(precision));
    const y = Number(pointY.toFixed(precision));
    const previous = coordinateValueRef.current;
    const previousX = Number(previous.x.toFixed(precision));
    const previousY = Number(previous.y.toFixed(precision));
    // Retain unrounded coordinates so increasing display precision later does
    // not permanently lose digits from the most recent pointer position.
    previous.x = pointX;
    previous.y = pointY;
    if (x === previousX && y === previousY && units === previous.units && precision === previous.precision) return;
    previous.units = units;
    previous.precision = precision;
    if (coordinateRef.current) {
      coordinateRef.current.textContent = `x ${x.toFixed(precision)} ${units} · y ${y.toFixed(precision)} ${units}`;
    }
  }, []);

  const scheduleDraw = useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame((timestamp) => {
      frameRef.current = null;
      const context = contextRef.current;
      if (!context) return;
      const metrics = metricsRef.current;
      const viewport = viewportRef.current;
      const state = useVectorStore.getState();
      const drafting = state.preferences.drafting;
      const { gridStyle, gridVisible } = drafting;
      const gridSize = getWorldGridSpacing();
      const { cursorStyle, showFpsOverlay, themeMode } = state.preferences.canvas;
      context.setTransform(metrics.dpr, 0, 0, metrics.dpr, 0, 0);
      drawGrid(context, metrics.width, metrics.height, viewport, gridSize, gridStyle, gridVisible, themeMode);
      drawWorkArea(context, metrics.width, metrics.height, viewport, documentModel.getDocument(), themeMode);
      drawEntities(
        context,
        metrics.width,
        metrics.height,
        viewport,
        interactionRef.current.transformPreview,
        interactionRef.current.nodeEdit?.entityId ?? null,
        themeMode,
      );
      drawToolpathOverlay(context, metrics.width, metrics.height, viewport);
      drawMachinePosition(context, metrics.width, metrics.height, viewport);
      drawInteractionOverlays(
        context,
        metrics.width,
        metrics.height,
        viewport,
        interactionRef.current,
        themeMode,
        state.activeTool,
      );
      if (cursorStyle === "crosshair" && pointerPositionRef.current.visible && !state.temporaryPanActive) {
        drawCadCrosshair(context, metrics.width, metrics.height, pointerPositionRef.current, themeMode);
      }
      if (showFpsOverlay) {
        updateFrameStats(frameStatsRef.current, timestamp);
        drawFpsBadge(context, metrics.width, metrics.height, frameStatsRef.current, themeMode);
        repeatDrawRef.current();
      } else {
        frameStatsRef.current.lastTimestamp = 0;
      }
    });
  }, []);
  repeatDrawRef.current = scheduleDraw;

  const interactionHandlers = useCreationStateMachine({
    screenToWorld,
    requestRender: scheduleDraw,
    renderStateRef: interactionRef,
  });
  const nodeEditHandlers = useNodeEditStateMachine({
    screenToWorld,
    requestRender: scheduleDraw,
    renderStateRef: interactionRef,
  });
  const eraserHandlers = useEraserStateMachine({
    screenToWorld,
    requestRender: scheduleDraw,
    renderStateRef: interactionRef,
  });
  const measureHandlers = useMeasureTool({
    screenToWorld,
    requestRender: scheduleDraw,
    renderStateRef: interactionRef,
  });
  const fillHandlers = useFillTool({ screenToWorld, requestRender: scheduleDraw });

  const setGeneratorPreview = useCallback((entities: readonly Entity[]) => {
    pathCache.prepareAll(entities);
    interactionRef.current.generatorPreview = entities;
    scheduleDraw();
  }, [scheduleDraw]);

  useEffect(() => {
    const unsubscribe = useVectorStore.subscribe((state, previous) => {
      const viewportChanged =
        state.viewport.x !== previous.viewport.x ||
        state.viewport.y !== previous.viewport.y ||
        state.viewport.zoom !== previous.viewport.zoom;
      if (viewportChanged) viewportRef.current = state.viewport;
      if (state.temporaryPanActive !== previous.temporaryPanActive) {
        interactionRef.current.activeSnap = null;
      }
      if (state.preferences.drafting !== previous.preferences.drafting) {
        interactionRef.current.activeSnap = null;
        const coordinates = coordinateValueRef.current;
        if (Number.isFinite(coordinates.x) && Number.isFinite(coordinates.y)) {
          updateCoordinates(coordinates.x, coordinates.y);
        }
      }
      if (
        viewportChanged ||
        state.preferences.drafting !== previous.preferences.drafting ||
        state.preferences.canvas !== previous.preferences.canvas ||
        state.temporaryPanActive !== previous.temporaryPanActive
      ) scheduleDraw();
    });
    pathCache.prepareAll(documentModel.getDocument().entities.values());
    const unsubscribeDocument = documentModel.subscribe((document, change) => {
      prepareChangedEntityPaths(document, change);
      const coordinates = coordinateValueRef.current;
      if (Number.isFinite(coordinates.x) && Number.isFinite(coordinates.y)) {
        updateCoordinates(coordinates.x, coordinates.y);
      }
      scheduleDraw();
    });
    prepareToolpathFrame();
    const unsubscribeSimulator = toolpathSimulator.subscribe(() => {
      prepareToolpathFrame();
      scheduleDraw();
    });
    const unsubscribeMachine = useMachineStore.subscribe(scheduleDraw);
    const unsubscribeCalibration = useCamCalibrationStore.subscribe(scheduleDraw);
    const resizeCanvas = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const pixelWidth = Math.max(1, Math.round(rect.width * dpr));
      const pixelHeight = Math.max(1, Math.round(rect.height * dpr));
      const metrics = metricsRef.current;
      metrics.left = rect.left;
      metrics.top = rect.top;
      metrics.width = rect.width;
      metrics.height = rect.height;
      metrics.dpr = dpr;
      if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
      if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
      contextRef.current = canvas.getContext("2d", { alpha: false });
      scheduleDraw();
    };
    const resizeObserver = new ResizeObserver(resizeCanvas);
    if (canvasRef.current) {
      resizeObserver.observe(canvasRef.current);
    }
    return () => {
      unsubscribe();
      unsubscribeDocument();
      unsubscribeSimulator();
      unsubscribeMachine();
      unsubscribeCalibration();
      resizeObserver.disconnect();
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      useVectorStore.getState().setCanvasPanning(false);
    };
  }, [scheduleDraw, updateCoordinates]);

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const state = useVectorStore.getState();
    const metrics = metricsRef.current;
    pointerPositionRef.current.x = event.clientX - metrics.left;
    pointerPositionRef.current.y = event.clientY - metrics.top;
    pointerPositionRef.current.visible = true;
    const point = screenToWorld(event.clientX, event.clientY);
    const drafting = state.preferences.drafting;
    const { snapToGrid } = drafting;
    const gridSize = getWorldGridSpacing();
    const telemetry = snapToGrid && state.activeTool !== "freehand" ? snapWorldPointToGrid(point, gridSize, drafting.gridStyle) : point;
    const telemetryX = telemetry.x;
    const telemetryY = telemetry.y;

    if (panRef.current?.pointerId === event.pointerId) {
      const { start, viewport } = panRef.current;
      const liveViewport = livePanViewportRef.current;
      liveViewport.x = viewport.x + event.clientX - start.x;
      liveViewport.y = viewport.y + event.clientY - start.y;
      liveViewport.zoom = viewport.zoom;
      viewportRef.current = liveViewport;
      updateCoordinates(telemetryX, telemetryY);
      scheduleDraw();
      return;
    }
    if (state.temporaryPanActive) {
      updateCoordinates(telemetryX, telemetryY);
      return;
    }
    if (!measureHandlers.onPointerMove(event) && !nodeEditHandlers.onPointerMove(event) && !eraserHandlers.onPointerMove(event)) {
      interactionHandlers.onPointerMove(event);
    }
    const activeSnap = interactionRef.current.activeSnap;
    updateCoordinates(activeSnap?.point.x ?? telemetryX, activeSnap?.point.y ?? telemetryY);
    if (state.preferences.canvas.cursorStyle === "crosshair") scheduleDraw();
  }, [eraserHandlers, interactionHandlers, measureHandlers, nodeEditHandlers, scheduleDraw, screenToWorld, updateCoordinates]);

  const onPointerEnter = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const metrics = metricsRef.current;
    pointerPositionRef.current.x = event.clientX - metrics.left;
    pointerPositionRef.current.y = event.clientY - metrics.top;
    pointerPositionRef.current.visible = true;
    if (useVectorStore.getState().preferences.canvas.cursorStyle === "crosshair") scheduleDraw();
  }, [scheduleDraw]);

  const onPointerLeave = useCallback(() => {
    pointerPositionRef.current.visible = false;
    eraserHandlers.onPointerLeave();
    if (useVectorStore.getState().preferences.canvas.cursorStyle === "crosshair") scheduleDraw();
  }, [eraserHandlers, scheduleDraw]);

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const state = useVectorStore.getState();
    if (event.button === 1 || (event.button === 0 && state.temporaryPanActive)) {
      event.currentTarget.setPointerCapture(event.pointerId);
      panRef.current = {
        pointerId: event.pointerId,
        start: { x: event.clientX, y: event.clientY },
        viewport: viewportRef.current,
      };
      interactionRef.current.activeSnap = null;
      state.setCanvasPanning(true);
      event.preventDefault();
      return;
    }
    if (event.button === 0 && state.activeTool === "text") {
      beginInlineText(event);
      return;
    }
    if (fillHandlers.onPointerDown(event)) return;
    if (measureHandlers.onPointerDown(event)) return;
    if (nodeEditHandlers.onPointerDown(event)) return;
    if (eraserHandlers.onPointerDown(event)) return;
    interactionHandlers.onPointerDown(event);
  }, [beginInlineText, eraserHandlers, fillHandlers, interactionHandlers, measureHandlers, nodeEditHandlers]);

  const onPointerUp = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    if (panRef.current?.pointerId === event.pointerId) {
      panRef.current = null;
      const state = useVectorStore.getState();
      state.setViewport({ ...viewportRef.current });
      state.setCanvasPanning(false);
      return;
    }
    if (!fillHandlers.onPointerUp() && !measureHandlers.onPointerUp(event) && !nodeEditHandlers.onPointerUp(event) && !eraserHandlers.onPointerUp(event)) {
      interactionHandlers.onPointerUp(event);
    }
  }, [eraserHandlers, fillHandlers, interactionHandlers, measureHandlers, nodeEditHandlers]);

  const onPointerCancel = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    if (panRef.current?.pointerId === event.pointerId) {
      panRef.current = null;
      const state = useVectorStore.getState();
      state.setViewport({ ...viewportRef.current });
      state.setCanvasPanning(false);
      return;
    }
    if (!fillHandlers.onPointerCancel() && !measureHandlers.onPointerCancel(event) && !nodeEditHandlers.onPointerCancel(event) && !eraserHandlers.onPointerCancel(event)) {
      interactionHandlers.onPointerCancel(event);
    }
  }, [eraserHandlers, fillHandlers, interactionHandlers, measureHandlers, nodeEditHandlers]);

  const onDoubleClick = useCallback((event: React.MouseEvent<HTMLCanvasElement>) => {
    if (useVectorStore.getState().temporaryPanActive) return;
    if (nodeEditHandlers.onDoubleClick(event)) interactionHandlers.cancelInteraction();
  }, [interactionHandlers, nodeEditHandlers]);

  const onWheel = useCallback((event: React.WheelEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    const metrics = metricsRef.current;
    const state = useVectorStore.getState();
    const current = viewportRef.current;
    const factor = Math.exp(-event.deltaY * 0.0012);
    const nextZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, current.zoom * factor));
    const cursorX = event.clientX - metrics.left - metrics.width / 2;
    const cursorY = event.clientY - metrics.top - metrics.height / 2;
    const worldX = (cursorX - current.x) / current.zoom;
    const worldY = (cursorY - current.y) / current.zoom;
    const viewport = {
      zoom: nextZoom,
      x: cursorX - worldX * nextZoom,
      y: cursorY - worldY * nextZoom,
    };
    viewportRef.current = viewport;
    state.setViewport(viewport);
  }, []);

  return {
    canvasRef,
    coordinateRef,
    setGeneratorPreview,
    inlineTextEditor: inlineTextDraft ? {
      value: inlineTextDraft.value,
      left: inlineTextDraft.left,
      top: inlineTextDraft.baseline - inlineTextDraft.fontSize * 0.82,
      fontSize: inlineTextDraft.fontSize,
      onChange: updateInlineText,
      onCommit: () => finishInlineText(true),
      onCancel: () => finishInlineText(false),
    } : null,
    canvasProps: {
      onPointerMove,
      onPointerEnter,
      onPointerLeave,
      onPointerDown,
      onPointerUp,
      onPointerCancel,
      onLostPointerCapture: (event: React.PointerEvent<HTMLCanvasElement>) => {
        if (useVectorStore.getState().activeTool === "freehand") interactionHandlers.onPointerCancel(event);
      },
      onDoubleClick,
      onWheel,
    },
  };
}

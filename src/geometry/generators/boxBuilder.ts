import type { BoxPanelName, Point2D, PolylineEntity } from "../../document/types";
import {
  assertPoint,
  assertPositive,
  boundsFromPoints,
  generatorBase,
  type GeneratorEntityOptions,
} from "./common";

export interface BoxBuilderOptions extends GeneratorEntityOptions {
  readonly width: number;
  readonly depth: number;
  readonly height: number;
  readonly materialThickness: number;
  readonly fingerWidth: number;
  readonly origin?: Point2D;
  readonly panelGap?: number;
  readonly design?: FlatpackBoxDesign;
  readonly dividerCount?: number;
}

export type FlatpackBoxDesign = "closed" | "open-top" | "divider-tray";

export interface BoxPanel {
  readonly name: BoxPanelName;
  readonly entity: PolylineEntity;
}

type EdgeDefinition = {
  readonly start: Point2D;
  readonly end: Point2D;
  readonly outward: Point2D;
  readonly phase: boolean | null;
};

function appendFingerEdge(
  points: Point2D[],
  edge: EdgeDefinition,
  thickness: number,
  targetFingerWidth: number,
): void {
  const dx = edge.end.x - edge.start.x;
  const dy = edge.end.y - edge.start.y;
  const length = Math.hypot(dx, dy);
  let divisions = Math.max(3, Math.round(length / targetFingerWidth));
  if (divisions % 2 === 0) divisions += 1;
  const ux = dx / length;
  const uy = dy / length;
  if (edge.phase === null) {
    points.push(edge.end);
    return;
  }
  const step = length / divisions;
  for (let division = 0; division < divisions; division += 1) {
    const tab = (division % 2 === 0) === edge.phase;
    const startDistance = division * step;
    const endDistance = (division + 1) * step;
    const baselineStart = {
      x: edge.start.x + ux * startDistance,
      y: edge.start.y + uy * startDistance,
    };
    const baselineEnd = {
      x: edge.start.x + ux * endDistance,
      y: edge.start.y + uy * endDistance,
    };
    if (tab) {
      points.push({
        x: baselineStart.x + edge.outward.x * thickness,
        y: baselineStart.y + edge.outward.y * thickness,
      });
      points.push({
        x: baselineEnd.x + edge.outward.x * thickness,
        y: baselineEnd.y + edge.outward.y * thickness,
      });
    }
    points.push(baselineEnd);
  }
}

function panelOutline(
  origin: Point2D,
  width: number,
  height: number,
  thickness: number,
  fingerWidth: number,
  phases: readonly [boolean | null, boolean | null, boolean | null, boolean | null],
): readonly Point2D[] {
  const bottomLeft = origin;
  const bottomRight = { x: origin.x + width, y: origin.y };
  const topRight = { x: origin.x + width, y: origin.y + height };
  const topLeft = { x: origin.x, y: origin.y + height };
  const points: Point2D[] = [bottomLeft];
  const edges: readonly EdgeDefinition[] = [
    { start: bottomLeft, end: bottomRight, outward: { x: 0, y: -1 }, phase: phases[0] },
    { start: bottomRight, end: topRight, outward: { x: 1, y: 0 }, phase: phases[1] },
    { start: topRight, end: topLeft, outward: { x: 0, y: 1 }, phase: phases[2] },
    { start: topLeft, end: bottomLeft, outward: { x: -1, y: 0 }, phase: phases[3] },
  ];
  for (const edge of edges) appendFingerEdge(points, edge, thickness, fingerWidth);
  if (points.length > 1) points.pop();
  return points;
}

export function generateFlatpackBoxPanels(options: BoxBuilderOptions): readonly BoxPanel[] {
  assertPositive(options.width, "Box width");
  assertPositive(options.depth, "Box depth");
  assertPositive(options.height, "Box height");
  assertPositive(options.materialThickness, "Material thickness");
  assertPositive(options.fingerWidth, "Finger width");
  const smallestDimension = Math.min(options.width, options.depth, options.height);
  if (options.materialThickness * 2 >= smallestDimension) {
    throw new RangeError("Material thickness must be less than half the smallest box dimension.");
  }
  const origin = options.origin ?? { x: 0, y: 0 };
  assertPoint(origin, "Box layout origin");
  const gap = options.panelGap ?? Math.max(options.fingerWidth, options.materialThickness * 3);
  assertPositive(gap, "Panel gap");
  if (gap < options.materialThickness * 2) {
    throw new RangeError("Panel gap must be at least twice the material thickness so finger joints do not overlap.");
  }
  const design = options.design ?? "closed";
  const assemblyId = globalThis.crypto?.randomUUID?.() ?? `box-${Date.now().toString(36)}`;

  const specifications: readonly {
    name: BoxPanelName;
    width: number;
    height: number;
    x: number;
    y: number;
    phases: readonly [boolean | null, boolean | null, boolean | null, boolean | null];
  }[] = [
    { name: "front", width: options.width, height: options.height, x: 0, y: 0, phases: [true, true, true, true] },
    { name: "back", width: options.width, height: options.height, x: options.width + gap, y: 0, phases: [true, false, true, false] },
    { name: "left", width: options.depth, height: options.height, x: options.width * 2 + gap * 2, y: 0, phases: [false, true, false, true] },
    { name: "right", width: options.depth, height: options.height, x: options.width * 2 + options.depth + gap * 3, y: 0, phases: [false, false, false, false] },
    { name: "top", width: options.width, height: options.depth, x: 0, y: options.height + gap, phases: [false, true, false, true] },
    { name: "bottom", width: options.width, height: options.depth, x: options.width + gap, y: options.height + gap, phases: [true, false, true, false] },
  ];

  const included = design === "closed" ? specifications : specifications.filter((panel) => panel.name !== "top");
  return included.map((panel, index) => {
    const panelOrigin = { x: origin.x + panel.x, y: origin.y + panel.y };
    const points = panelOutline(
      panelOrigin,
      panel.width,
      panel.height,
      options.materialThickness,
      options.fingerWidth,
      panel.phases,
    );
    const entity: PolylineEntity = {
      ...generatorBase(`box-${panel.name}`, index, options),
      name: `Box ${panel.name[0]!.toUpperCase()}${panel.name.slice(1)} Panel`,
      type: "polyline",
      points,
      closed: true,
      bbox: boundsFromPoints(points),
      metadata: {
        kind: "box-panel",
        assemblyId,
        panel: panel.name,
        width: options.width,
        depth: options.depth,
        height: options.height,
        materialThickness: options.materialThickness,
      },
    };
    return Object.freeze({ name: panel.name, entity });
  });
}

export function generateFlatpackBox(options: BoxBuilderOptions): readonly PolylineEntity[] {
  const panels = generateFlatpackBoxPanels(options).map((panel) => panel.entity);
  if ((options.design ?? "closed") !== "divider-tray") return panels;
  const dividerCount = options.dividerCount ?? 1;
  if (!Number.isInteger(dividerCount) || dividerCount < 1 || dividerCount > 12) {
    throw new RangeError("Divider count must be an integer between 1 and 12.");
  }
  const origin = options.origin ?? { x: 0, y: 0 };
  const gap = options.panelGap ?? Math.max(options.fingerWidth, options.materialThickness * 3);
  const dividerHeight = options.height - options.materialThickness;
  assertPositive(dividerHeight, "Divider height");
  const dividerRowY = origin.y + options.height + options.depth + gap * 2;
  const bottomOrigin = { x: origin.x + options.width + gap, y: origin.y + options.height + gap };
  const generated: PolylineEntity[] = [...panels];
  for (let divider = 0; divider < dividerCount; divider += 1) {
    const dividerOrigin = { x: origin.x + divider * (options.depth + gap), y: dividerRowY };
    const dividerPoints = panelOutline(
      dividerOrigin,
      options.depth,
      dividerHeight,
      options.materialThickness,
      options.fingerWidth,
      [true, null, null, null],
    );
    generated.push({
      ...generatorBase("box-divider", divider, options),
      name: `Box Divider ${divider + 1}`,
      type: "polyline",
      points: dividerPoints,
      closed: true,
      bbox: boundsFromPoints(dividerPoints),
    });

    let divisions = Math.max(3, Math.round(options.depth / options.fingerWidth));
    if (divisions % 2 === 0) divisions += 1;
    const step = options.depth / divisions;
    const slotCenterX = bottomOrigin.x + (options.width * (divider + 1)) / (dividerCount + 1);
    for (let division = 0; division < divisions; division += 2) {
      const inset = Math.min(options.materialThickness, step * 0.12);
      const minY = bottomOrigin.y + division * step + inset;
      const maxY = bottomOrigin.y + (division + 1) * step - inset;
      const halfThickness = options.materialThickness / 2;
      const slotPoints: readonly Point2D[] = [
        { x: slotCenterX - halfThickness, y: minY },
        { x: slotCenterX + halfThickness, y: minY },
        { x: slotCenterX + halfThickness, y: maxY },
        { x: slotCenterX - halfThickness, y: maxY },
      ];
      generated.push({
        ...generatorBase("box-divider-slot", divider * divisions + division, options),
        name: `Divider ${divider + 1} Bottom Slot ${division / 2 + 1}`,
        type: "polyline",
        points: slotPoints,
        closed: true,
        bbox: boundsFromPoints(slotPoints),
      });
    }
  }
  return Object.freeze(generated);
}

export function getFlatpackBoxLayoutSize(options: BoxBuilderOptions): { readonly width: number; readonly height: number } {
  const gap = options.panelGap ?? Math.max(options.fingerWidth, options.materialThickness * 3);
  const firstRowWidth = options.width * 2 + options.depth * 2 + gap * 3;
  const secondRowWidth = options.width * 2 + gap;
  if ((options.design ?? "closed") !== "divider-tray") {
    return { width: Math.max(firstRowWidth, secondRowWidth), height: options.height + gap + options.depth };
  }
  const dividerCount = options.dividerCount ?? 1;
  const dividerRowWidth = dividerCount * options.depth + Math.max(0, dividerCount - 1) * gap;
  return {
    width: Math.max(firstRowWidth, secondRowWidth, dividerRowWidth),
    height: options.height + options.depth + gap * 2 + options.height - options.materialThickness,
  };
}

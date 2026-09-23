import type { CircleEntity, Entity, Point2D, RectangleEntity } from "../../document/types";
import { assertPoint, assertPositive, generatorBase, type GeneratorEntityOptions } from "./common";

export type MountingHoleLayout = "none" | "two" | "four";

export interface MountingPlateOptions extends GeneratorEntityOptions {
  readonly width: number;
  readonly height: number;
  readonly cornerRadius?: number;
  readonly center?: Point2D;
  readonly mountingHoleLayout?: MountingHoleLayout;
  readonly mountingHoleDiameter?: number;
  readonly holeInset?: number;
  readonly centerHoleDiameter?: number;
}

function nonNegative(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${name} must be a finite number of zero or greater.`);
}

/** Generate a rounded plate profile and its optional mounting/centre cutouts. */
export function generateMountingPlate(options: MountingPlateOptions): readonly Entity[] {
  assertPositive(options.width, "Plate width");
  assertPositive(options.height, "Plate height");
  const center = options.center ?? { x: 0, y: 0 };
  assertPoint(center, "Plate center");
  const cornerRadius = options.cornerRadius ?? 0;
  const layout = options.mountingHoleLayout ?? "four";
  const holeDiameter = options.mountingHoleDiameter ?? 4;
  const holeInset = options.holeInset ?? 8;
  const centerHoleDiameter = options.centerHoleDiameter ?? 0;
  nonNegative(cornerRadius, "Corner radius");
  nonNegative(holeDiameter, "Mounting-hole diameter");
  nonNegative(holeInset, "Hole inset");
  nonNegative(centerHoleDiameter, "Centre-hole diameter");
  if (cornerRadius > Math.min(options.width, options.height) / 2) {
    throw new RangeError("Corner radius must not exceed half the shortest plate side.");
  }
  const needsMountingHoles = layout !== "none";
  if (needsMountingHoles && holeDiameter <= 0) throw new RangeError("Mounting-hole diameter must be greater than zero.");
  const holeRadius = holeDiameter / 2;
  if (needsMountingHoles && (
    holeInset - holeRadius <= 0 ||
    holeInset + holeRadius >= Math.min(options.width, options.height) / 2
  )) {
    throw new RangeError("Mounting holes and their inset must fit within the plate edges.");
  }
  if (centerHoleDiameter >= Math.min(options.width, options.height)) {
    throw new RangeError("The centre hole must fit inside the plate.");
  }

  const compoundId = `mounting-plate-${globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36)}`;
  const origin = { x: center.x - options.width / 2, y: center.y - options.height / 2 };
  const plate: RectangleEntity = {
    ...generatorBase("mounting-plate", 0, options),
    name: "Mounting Plate",
    type: "rectangle",
    origin,
    width: options.width,
    height: options.height,
    cornerRadius,
    bbox: { minX: origin.x, minY: origin.y, maxX: origin.x + options.width, maxY: origin.y + options.height },
    compoundId,
  };
  const entities: Entity[] = [plate];
  const addHole = (name: string, holeCenter: Point2D, radius: number, index: number) => {
    const hole: CircleEntity = {
      ...generatorBase("mounting-hole", index, options),
      name,
      type: "circle",
      center: holeCenter,
      radius,
      bbox: {
        minX: holeCenter.x - radius,
        minY: holeCenter.y - radius,
        maxX: holeCenter.x + radius,
        maxY: holeCenter.y + radius,
      },
      compoundId,
    };
    entities.push(hole);
  };
  if (centerHoleDiameter > 0) addHole("Plate Centre Hole", center, centerHoleDiameter / 2, 0);
  if (needsMountingHoles) {
    const x = options.width / 2 - holeInset;
    const y = options.height / 2 - holeInset;
    const positions = layout === "two"
      ? [{ x: center.x - x, y: center.y }, { x: center.x + x, y: center.y }]
      : [
          { x: center.x - x, y: center.y - y }, { x: center.x + x, y: center.y - y },
          { x: center.x + x, y: center.y + y }, { x: center.x - x, y: center.y + y },
        ];
    positions.forEach((position, index) => addHole(`Mounting Hole ${index + 1}`, position, holeRadius, index + 1));
  }
  return Object.freeze(entities);
}

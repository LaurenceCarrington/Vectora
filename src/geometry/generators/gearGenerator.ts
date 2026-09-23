import type { CircleEntity, Entity, Point2D, PolylineEntity } from "../../document/types";
import {
  assertPoint,
  assertPositive,
  boundsFromPoints,
  generatorBase,
  type GeneratorEntityOptions,
} from "./common";

export interface GearGeneratorOptions extends GeneratorEntityOptions {
  readonly toothCount: number;
  readonly module?: number;
  readonly pitchDiameter?: number;
  readonly pressureAngle?: number;
  readonly center?: Point2D;
  readonly samplesPerFlank?: number;
}

export interface GearGeometry {
  readonly entity: PolylineEntity;
  readonly module: number;
  readonly pitchDiameter: number;
  readonly baseDiameter: number;
  readonly outsideDiameter: number;
  readonly rootDiameter: number;
}

export interface GearWithHolesOptions extends GearGeneratorOptions {
  /** Zero omits the centre bore. */
  readonly boreDiameter?: number;
  /** Zero omits the equally spaced bolt-hole pattern. */
  readonly boltHoleCount?: number;
  readonly boltHoleDiameter?: number;
  readonly boltCircleDiameter?: number;
}

function involute(parameter: number): number {
  return parameter - Math.atan(parameter);
}

function polar(center: Point2D, radius: number, angle: number): Point2D {
  return {
    x: center.x + radius * Math.cos(angle),
    y: center.y + radius * Math.sin(angle),
  };
}

function appendArc(
  points: Point2D[],
  center: Point2D,
  radius: number,
  startAngle: number,
  endAngle: number,
  segments: number,
  includeStart: boolean,
): void {
  for (let index = includeStart ? 0 : 1; index <= segments; index += 1) {
    const progress = index / segments;
    points.push(polar(center, radius, startAngle + (endAngle - startAngle) * progress));
  }
}

export function generateGearGeometry(options: GearGeneratorOptions): GearGeometry {
  if (!Number.isInteger(options.toothCount) || options.toothCount < 6 || options.toothCount > 1_000) {
    throw new RangeError("Tooth count must be an integer between 6 and 1,000.");
  }
  if (options.module === undefined && options.pitchDiameter === undefined) {
    throw new TypeError("A gear module or pitch diameter is required.");
  }
  const moduleValue = options.module ?? (options.pitchDiameter! / options.toothCount);
  assertPositive(moduleValue, "Gear module");
  if (options.pitchDiameter !== undefined) assertPositive(options.pitchDiameter, "Pitch diameter");
  if (
    options.module !== undefined &&
    options.pitchDiameter !== undefined &&
    Math.abs(options.pitchDiameter - moduleValue * options.toothCount) > 1e-7
  ) {
    throw new RangeError("Pitch diameter must equal module multiplied by tooth count.");
  }
  const pressureAngleDegrees = options.pressureAngle ?? 20;
  if (!Number.isFinite(pressureAngleDegrees) || pressureAngleDegrees <= 0 || pressureAngleDegrees >= 45) {
    throw new RangeError("Pressure angle must be between 0 and 45 degrees.");
  }
  const samplesPerFlank = options.samplesPerFlank ?? 8;
  if (!Number.isInteger(samplesPerFlank) || samplesPerFlank < 3 || samplesPerFlank > 64) {
    throw new RangeError("Samples per involute flank must be an integer between 3 and 64.");
  }
  const center = options.center ?? { x: 0, y: 0 };
  assertPoint(center, "Gear center");

  const pressureAngle = (pressureAngleDegrees * Math.PI) / 180;
  const pitchRadius = (moduleValue * options.toothCount) / 2;
  const baseRadius = pitchRadius * Math.cos(pressureAngle);
  const outsideRadius = pitchRadius + moduleValue;
  const rootRadius = Math.max(moduleValue * 0.05, pitchRadius - 1.25 * moduleValue);
  const flankStartRadius = Math.max(rootRadius, baseRadius);
  const toothAngle = (Math.PI * 2) / options.toothCount;
  const halfToothAtPitch = Math.PI / (2 * options.toothCount);
  const pitchInvolute = involute(Math.tan(pressureAngle));
  const halfWidthAtBase = halfToothAtPitch + pitchInvolute;
  const flankParameterAtStart = Math.sqrt(Math.max(0, (flankStartRadius * flankStartRadius) / (baseRadius * baseRadius) - 1));
  const halfWidthAtStart = halfWidthAtBase - involute(flankParameterAtStart);
  const flankParameterAtOutside = Math.sqrt((outsideRadius * outsideRadius) / (baseRadius * baseRadius) - 1);
  const halfWidthAtOutside = halfWidthAtBase - involute(flankParameterAtOutside);
  if (halfWidthAtOutside <= 0) {
    throw new RangeError("The selected tooth count, module, and pressure angle create an invalid pointed tooth profile.");
  }

  const points: Point2D[] = [];
  const rootArcSamples = 2;
  const tipArcSamples = 3;
  for (let tooth = 0; tooth < options.toothCount; tooth += 1) {
    const toothCenter = tooth * toothAngle;
    const valleyStart = toothCenter - toothAngle / 2;
    const leftStart = toothCenter - halfWidthAtStart;
    appendArc(points, center, rootRadius, valleyStart, leftStart, rootArcSamples, tooth === 0);
    if (flankStartRadius > rootRadius + 1e-9) points.push(polar(center, flankStartRadius, leftStart));
    for (let sample = 1; sample <= samplesPerFlank; sample += 1) {
      const progress = sample / samplesPerFlank;
      const radius = flankStartRadius + (outsideRadius - flankStartRadius) * progress;
      const parameter = Math.sqrt(Math.max(0, (radius * radius) / (baseRadius * baseRadius) - 1));
      const halfWidth = halfWidthAtBase - involute(parameter);
      points.push(polar(center, radius, toothCenter - halfWidth));
    }
    appendArc(
      points,
      center,
      outsideRadius,
      toothCenter - halfWidthAtOutside,
      toothCenter + halfWidthAtOutside,
      tipArcSamples,
      false,
    );
    for (let sample = samplesPerFlank - 1; sample >= 0; sample -= 1) {
      const progress = sample / samplesPerFlank;
      const radius = flankStartRadius + (outsideRadius - flankStartRadius) * progress;
      const parameter = Math.sqrt(Math.max(0, (radius * radius) / (baseRadius * baseRadius) - 1));
      const halfWidth = halfWidthAtBase - involute(parameter);
      points.push(polar(center, radius, toothCenter + halfWidth));
    }
    if (flankStartRadius > rootRadius + 1e-9) points.push(polar(center, rootRadius, toothCenter + halfWidthAtStart));
    appendArc(points, center, rootRadius, toothCenter + halfWidthAtStart, toothCenter + toothAngle / 2, rootArcSamples, false);
  }

  const entity: PolylineEntity = {
    ...generatorBase("gear", 0, options),
    name: "Involute Gear",
    type: "polyline",
    points,
    closed: true,
    bbox: boundsFromPoints(points),
  };
  return Object.freeze({
    entity,
    module: moduleValue,
    pitchDiameter: pitchRadius * 2,
    baseDiameter: baseRadius * 2,
    outsideDiameter: outsideRadius * 2,
    rootDiameter: rootRadius * 2,
  });
}

export function generateGear(options: GearGeneratorOptions): PolylineEntity {
  return generateGearGeometry(options).entity;
}

function assertNonNegative(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${name} must be a finite number of zero or greater.`);
}

/** Generate one involute outline plus optional internal cut contours. */
export function generateGearWithHoles(options: GearWithHolesOptions): readonly Entity[] {
  const geometry = generateGearGeometry(options);
  const center = options.center ?? { x: 0, y: 0 };
  const boreDiameter = options.boreDiameter ?? 0;
  const boltHoleCount = options.boltHoleCount ?? 0;
  const boltHoleDiameter = options.boltHoleDiameter ?? 0;
  const boltCircleDiameter = options.boltCircleDiameter ?? 0;
  assertNonNegative(boreDiameter, "Bore diameter");
  assertNonNegative(boltHoleDiameter, "Bolt-hole diameter");
  assertNonNegative(boltCircleDiameter, "Bolt-circle diameter");
  if (!Number.isInteger(boltHoleCount) || boltHoleCount < 0 || boltHoleCount > 64) {
    throw new RangeError("Bolt-hole count must be an integer between 0 and 64.");
  }

  const rootRadius = geometry.rootDiameter / 2;
  const boreRadius = boreDiameter / 2;
  if (boreRadius >= rootRadius) throw new RangeError("The centre bore must fit inside the gear root diameter.");
  if (boltHoleCount > 0) {
    if (boltHoleDiameter <= 0 || boltCircleDiameter <= 0) {
      throw new RangeError("Bolt-hole and bolt-circle diameters are required when bolt holes are enabled.");
    }
    const orbitRadius = boltCircleDiameter / 2;
    const holeRadius = boltHoleDiameter / 2;
    if (orbitRadius + holeRadius >= rootRadius) {
      throw new RangeError("The bolt-hole pattern must fit inside the gear root diameter.");
    }
    if (boreRadius > 0 && orbitRadius - holeRadius <= boreRadius) {
      throw new RangeError("The bolt holes must not overlap the centre bore.");
    }
  }

  const compoundId = `gear-profile-${geometry.entity.id}`;
  const entities: Entity[] = [{ ...geometry.entity, compoundId }];
  const circle = (name: string, radius: number, circleCenter: Point2D, index: number): CircleEntity => ({
    ...generatorBase("gear-hole", index, options),
    name,
    type: "circle",
    center: circleCenter,
    radius,
    bbox: {
      minX: circleCenter.x - radius,
      minY: circleCenter.y - radius,
      maxX: circleCenter.x + radius,
      maxY: circleCenter.y + radius,
    },
    compoundId,
  });
  if (boreRadius > 0) entities.push(circle("Gear Centre Bore", boreRadius, center, 0));
  for (let index = 0; index < boltHoleCount; index += 1) {
    const angle = -Math.PI / 2 + (index / boltHoleCount) * Math.PI * 2;
    const orbitRadius = boltCircleDiameter / 2;
    entities.push(circle(`Gear Bolt Hole ${index + 1}`, boltHoleDiameter / 2, {
      x: center.x + Math.cos(angle) * orbitRadius,
      y: center.y + Math.sin(angle) * orbitRadius,
    }, index + 1));
  }
  return Object.freeze(entities);
}

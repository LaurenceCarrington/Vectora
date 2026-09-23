import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ToolpathSimulator, type MotionSegment } from "../src/cam/ToolpathSimulator";
import {
  compileGcode,
  DEFAULT_GRBL_LASER_PROFILE,
  validatePreflight,
  type GcodeCompileOptions,
  type MachineProfile,
} from "../src/cam/gcodeCompiler";
import type { HoldingTabOptions } from "../src/cam/holdingTabs";
import { optimizeToolpaths, type OptimizedManufacturingPlan } from "../src/cam/optimizer";
import type { ManufacturingPlan, ManufacturingToolpath } from "../src/cam/processModel";
import { FACTORY_TOOLS } from "../src/cam/toolStore";
import { prepareGcode } from "../src/cam/webSerialController";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

const laserTool = FACTORY_TOOLS.find((tool) => tool.type === "laser");
const millingTool = FACTORY_TOOLS.find((tool) => tool.id === "factory-endmill-1-8");
assert(laserTool, "Factory laser tool is unavailable.");
assert(millingTool, "Factory 1/8-inch end mill is unavailable.");

function commonToolpath(overrides: Partial<ManufacturingToolpath> & Pick<ManufacturingToolpath, "id" | "points">): ManufacturingToolpath {
  return {
    id: overrides.id,
    sourceEntityId: `${overrides.id}-entity`,
    sourceLayerId: "dry-run-layer",
    processId: overrides.processId ?? overrides.id,
    processType: overrides.processType ?? "vector-engrave",
    sourceIntent: overrides.sourceIntent ?? "engrave",
    points: overrides.points,
    closed: overrides.closed ?? false,
    profileKind: overrides.profileKind ?? "open",
    offsetDirection: overrides.offsetDirection ?? "on-line",
    nestingDepth: overrides.nestingDepth ?? 0,
    parentEntityId: overrides.parentEntityId ?? null,
    feedRate: overrides.feedRate ?? 1_200,
    power: overrides.power ?? 300,
    passes: overrides.passes ?? 1,
    color: overrides.color ?? "#000000",
    ...overrides,
  };
}

const laserPlan: ManufacturingPlan = {
  documentId: "offline-laser-dry-run",
  documentVersion: 1,
  units: "mm",
  processes: [],
  profiles: [],
  toolpaths: [
    commonToolpath({
      id: "laser-vector-engrave",
      tool: laserTool,
      points: [{ x: 20, y: 20 }, { x: 80, y: 20 }, { x: 80, y: 30 }],
      feedRate: 1_200,
      power: 250,
    }),
    commonToolpath({
      id: "laser-raster",
      tool: laserTool,
      processType: "raster-engrave",
      sourceIntent: "raster",
      points: [{ x: 10, y: 40 }, { x: 55, y: 40 }, { x: 55, y: 40.2 }, { x: 10, y: 40.2 }],
      feedRate: 3_000,
      power: 1_000,
      raster: {
        interval: 0.2,
        maxPower: 1_000,
        lines: [
          {
            start: { x: 10, y: 40 },
            runs: [
              { end: { x: 15, y: 40 }, power: 0 },
              { end: { x: 35, y: 40 }, power: 600 },
              { end: { x: 55, y: 40 }, power: 0 },
            ],
          },
          {
            start: { x: 55, y: 40.2 },
            runs: [
              { end: { x: 50, y: 40.2 }, power: 0 },
              { end: { x: 30, y: 40.2 }, power: 800 },
              { end: { x: 10, y: 40.2 }, power: 0 },
            ],
          },
        ],
      },
    }),
    commonToolpath({
      id: "laser-vector-cut",
      tool: laserTool,
      processType: "vector-cut",
      sourceIntent: "cut",
      points: [{ x: 10, y: 10 }, { x: 110, y: 10 }, { x: 110, y: 80 }, { x: 10, y: 80 }],
      closed: true,
      profileKind: "outer",
      offsetDirection: "outside",
      feedRate: 600,
      power: 800,
      cutKerfWidth: 1.5,
    }),
  ],
};

const millingPlan: ManufacturingPlan = {
  documentId: "offline-milling-dry-run",
  documentVersion: 1,
  units: "mm",
  processes: [],
  profiles: [],
  toolpaths: [
    commonToolpath({
      id: "milling-profile",
      tool: millingTool,
      spindleRPM: 12_000,
      depth: 3,
      stepdown: 1,
      processType: "vector-cut",
      sourceIntent: "cut",
      points: [{ x: 20, y: 20 }, { x: 100, y: 20 }, { x: 100, y: 70 }, { x: 20, y: 70 }],
      closed: true,
      profileKind: "outer",
      offsetDirection: "outside",
      feedRate: 600,
      power: 1_000,
      passes: 3,
      cutKerfWidth: millingTool.diameter,
    }),
  ],
};

const laserProfile: MachineProfile = {
  ...DEFAULT_GRBL_LASER_PROFILE,
  name: "Offline GRBL laser simulator",
  originAlignment: "document",
  bedWidth: 300,
  bedHeight: 200,
  returnToOrigin: true,
};

const millingProfile: MachineProfile = {
  ...DEFAULT_GRBL_LASER_PROFILE,
  name: "Offline GRBL spindle simulator",
  mode: "spindle",
  originAlignment: "document",
  bedWidth: 300,
  bedHeight: 200,
  safeZ: 5,
  stockSurfaceZ: 0,
  workZ: -3,
  plungeRate: 200,
  rapidFeedRate: 3_000,
  returnToOrigin: true,
};

interface ControllerSummary {
  readonly commands: number;
  readonly rapidMoves: number;
  readonly feedMoves: number;
  readonly poweredMoves: number;
  readonly toolStarts: number;
  readonly toolStops: number;
  readonly bounds: { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number };
  readonly zRange: { readonly min: number; readonly max: number } | null;
  readonly feeds: readonly number[];
  readonly powers: readonly number[];
  readonly finalPosition: { readonly x: number; readonly y: number; readonly z: number };
  readonly finalToolState: "off";
}

function virtualController(gcode: string, profile: MachineProfile): ControllerSummary {
  const stream = prepareGcode(gcode);
  const allowedG = new Set([0, 1, 2, 3, 17, 20, 21, 90, 94, 91.1]);
  const allowedM = new Set([3, 4, 5]);
  const feeds = new Set<number>();
  const powers = new Set<number>();
  let x = 0;
  let y = 0;
  let z = 0;
  let minX = 0;
  let minY = 0;
  let maxX = 0;
  let maxY = 0;
  let minZ = Infinity;
  let maxZ = -Infinity;
  let absolute = false;
  let units: "mm" | "in" | null = null;
  let toolOn = false;
  let power = 0;
  let rapidMoves = 0;
  let feedMoves = 0;
  let poweredMoves = 0;
  let toolStarts = 0;
  let toolStops = 0;

  for (const [index, raw] of gcode.split(/\r?\n/).entries()) {
    const line = raw.replace(/;.*$/, "").trim().toUpperCase();
    if (!line) continue;
    const words = [...line.matchAll(/([A-Z])([-+]?\d*\.?\d+)/g)].map((match) => ({ letter: match[1]!, value: Number(match[2]) }));
    const residue = line.replace(/([A-Z])([-+]?\d*\.?\d+)/g, "").replace(/\s/g, "");
    assert(words.length > 0 && residue === "", `Virtual controller rejected syntax on line ${index + 1}: ${line}`);
    assert(words.every((word) => Number.isFinite(word.value)), `Non-finite word on line ${index + 1}.`);
    const word = (letter: string) => words.find((candidate) => candidate.letter === letter)?.value;
    const gCodes = words.filter((candidate) => candidate.letter === "G").map((candidate) => candidate.value);
    const mCodes = words.filter((candidate) => candidate.letter === "M").map((candidate) => candidate.value);
    assert(gCodes.every((code) => allowedG.has(code)), `Unsupported G-code on line ${index + 1}: ${line}`);
    assert(mCodes.every((code) => allowedM.has(code)), `Unsupported M-code on line ${index + 1}: ${line}`);
    assert(words.every(({ letter }) => "GMXYZIJFS".includes(letter)), `Unsupported word on line ${index + 1}: ${line}`);

    if (gCodes.includes(20)) units = "in";
    if (gCodes.includes(21)) units = "mm";
    if (gCodes.includes(90)) absolute = true;
    if (mCodes.includes(3) || mCodes.includes(4)) {
      toolOn = true;
      toolStarts += 1;
    }
    if (mCodes.includes(5)) {
      toolOn = false;
      power = 0;
      toolStops += 1;
    }
    const nextPower = word("S");
    if (nextPower !== undefined) {
      const maximum = profile.mode === "spindle" ? 1_000_000 : profile.maxPower;
      assert(nextPower >= 0 && nextPower <= maximum,
        `Power or RPM exceeds the configured limit on line ${index + 1}.`);
      power = nextPower;
      powers.add(power);
    }
    const feed = word("F");
    if (feed !== undefined) {
      assert(feed > 0, `Non-positive feed on line ${index + 1}.`);
      feeds.add(feed);
    }

    const motion = gCodes.find((code) => code === 0 || code === 1 || code === 2 || code === 3);
    if (motion === undefined) continue;
    assert(absolute, `Motion occurred before G90 on line ${index + 1}.`);
    const nextX = word("X") ?? x;
    const nextY = word("Y") ?? y;
    const nextZ = word("Z") ?? z;
    const xyChanged = nextX !== x || nextY !== y;
    const zChanged = nextZ !== z;
    assert(nextX >= 0 && nextX <= profile.bedWidth && nextY >= 0 && nextY <= profile.bedHeight,
      `Move exceeds the ${profile.bedWidth} x ${profile.bedHeight} bed on line ${index + 1}.`);
    if (profile.mode === "laser") {
      assert(!zChanged, `Laser program unexpectedly moved Z on line ${index + 1}.`);
      assert(!(motion === 0 && toolOn && power > 0), `Powered laser rapid on line ${index + 1}.`);
    } else {
      const stockZ = profile.stockSurfaceZ ?? 0;
      assert(!(motion === 0 && xyChanged && nextZ < profile.safeZ), `Milling rapid crossed XY below safe Z on line ${index + 1}.`);
      assert(!(motion !== 0 && (xyChanged || nextZ < stockZ) && nextZ <= stockZ && (!toolOn || power <= 0)),
        `Milling feed entered stock with the spindle off on line ${index + 1}.`);
    }
    if (motion === 0) rapidMoves += 1;
    else {
      feedMoves += 1;
      if (toolOn && power > 0) poweredMoves += 1;
    }
    x = nextX;
    y = nextY;
    z = nextZ;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    if (word("Z") !== undefined) {
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    }
  }

  assert(units === profile.units, `Program units ${units ?? "unset"} do not match profile units ${profile.units}.`);
  assert(!toolOn && power === 0, "Program ended with laser/spindle power enabled.");
  assert(x === profile.origin.x && y === profile.origin.y, "Program did not return to the configured origin.");
  if (profile.mode === "spindle") assert(z >= profile.safeZ, "Milling program ended below safe Z.");
  return {
    commands: stream.length,
    rapidMoves,
    feedMoves,
    poweredMoves,
    toolStarts,
    toolStops,
    bounds: { minX, minY, maxX, maxY },
    zRange: Number.isFinite(minZ) ? { min: minZ, max: maxZ } : null,
    feeds: [...feeds].sort((left, right) => left - right),
    powers: [...powers].sort((left, right) => left - right),
    finalPosition: { x, y, z },
    finalToolState: "off",
  };
}

function simulatorSummary(plan: OptimizedManufacturingPlan, profile: MachineProfile, options: GcodeCompileOptions = {}) {
  const simulator = new ToolpathSimulator();
  simulator.setPlan(plan, {
    machineProfile: profile,
    ...(options.holdingTabs ? { holdingTabs: options.holdingTabs } : {}),
  });
  const segments = simulator.getSegments();
  assert(segments.length > 0, "Simulator produced no motion segments.");
  simulator.seek(1);
  const snapshot = simulator.getSnapshot();
  assert(snapshot.status === "complete" && snapshot.progress === 1, "Simulator did not complete the virtual traversal.");
  const distance = (selected: readonly MotionSegment[]) => selected.reduce((total, segment) => total + segment.distance, 0);
  const roleCounts = Object.fromEntries([...new Set(segments.flatMap((segment) => segment.role ? [segment.role] : []))]
    .map((role) => [role, segments.filter((segment) => segment.role === role).length]));
  const result = {
    segments: segments.length,
    rapidSegments: segments.filter((segment) => segment.kind === "rapid").length,
    cutSegments: segments.filter((segment) => segment.kind === "cut").length,
    rapidDistance: distance(segments.filter((segment) => segment.kind === "rapid")),
    cutDistance: distance(segments.filter((segment) => segment.kind === "cut")),
    durationSeconds: snapshot.duration,
    roleCounts,
  };
  simulator.dispose();
  return result;
}

function runProgram(
  name: "laser" | "milling",
  sourcePlan: ManufacturingPlan,
  profile: MachineProfile,
  options: GcodeCompileOptions = {},
) {
  const plan = optimizeToolpaths(sourcePlan);
  const preflight = validatePreflight(plan, profile, options);
  assert(!preflight.hasCriticalErrors, `${name} preflight failed: ${preflight.errors.map((error) => error.message).join("; ")}`);
  const gcode = compileGcode(plan, profile, options);
  const controller = virtualController(gcode, profile);
  const simulation = simulatorSummary(plan, profile, options);
  return { plan, gcode, controller, simulation };
}

const holdingTabs: HoldingTabOptions = { tabWidth: 3, tabCount: 4 };
const laser = runProgram("laser", laserPlan, laserProfile, { holdingTabs });
const milling = runProgram("milling", millingPlan, millingProfile);

assert(laser.gcode.includes("GRBL laser mode $32=1 required"), "Laser output omitted its GRBL laser-mode requirement.");
assert(laser.gcode.includes("Holding tabs"), "Laser output omitted holding tabs.");
assert(!/\bZ[-+\d.]+/.test(laser.gcode), "Laser output contains unexpected Z motion.");
assert(milling.gcode.includes("M3 S12000"), "Milling output omitted the configured spindle speed.");
for (const depth of [-1, -2, -3]) assert(milling.gcode.includes(`G1 Z${depth} F200`), `Milling output omitted depth ${depth} mm.`);

const report = {
  schemaVersion: 2,
  validationScope: "offline-only",
  releaseStatus: "hardware-validation-pending",
  hardwareConnection: "not attempted",
  controller: "strict offline GRBL subset parser",
  offlineChecks: "pass",
  hardwareChecks: "not run",
  laser: {
    profile: laserProfile.name,
    preflight: "pass",
    toolpaths: laser.plan.toolpaths.length,
    sequence: laser.plan.toolpaths.map((toolpath) => toolpath.id),
    controller: laser.controller,
    simulator: laser.simulation,
  },
  milling: {
    profile: millingProfile.name,
    preflight: "pass",
    toolpaths: milling.plan.toolpaths.length,
    sequence: milling.plan.toolpaths.map((toolpath) => toolpath.id),
    depthPassesMm: [-1, -2, -3],
    controller: milling.controller,
    simulator: milling.simulation,
  },
};

const outputDirectory = resolve("artifacts/machine-dry-run");
mkdirSync(outputDirectory, { recursive: true });
writeFileSync(resolve(outputDirectory, "laser.gcode"), laser.gcode, "utf8");
writeFileSync(resolve(outputDirectory, "milling.gcode"), milling.gcode, "utf8");
writeFileSync(resolve(outputDirectory, "summary.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
writeFileSync(resolve(outputDirectory, "README.md"), `# Offline machine dry-run\n\n` +
  `Generated without requesting or opening a serial port. Both programs passed CAM preflight, serial sanitization, strict virtual-controller replay, and complete toolpath simulation.\n\n` +
  `- Laser: ${laser.controller.commands} commands, ${laser.simulation.segments} simulated segments, ${laser.simulation.durationSeconds.toFixed(2)} s estimated XY motion.\n` +
  `- Milling: ${milling.controller.commands} commands, ${milling.simulation.segments} simulated XY segments, ${milling.simulation.durationSeconds.toFixed(2)} s estimated XY motion.\n` +
  `- Hardware connection: not attempted.\n` +
  `- Offline result: PASS.\n` +
  `- Hardware release status: PENDING. This report does not validate controller compatibility, physical interlocks, motion accuracy, or cutting results. See [real-world validation](../../REAL_WORLD_VALIDATION.md).\n`, "utf8");

console.log(`Offline machine dry-run PASS\n${JSON.stringify(report, null, 2)}`);

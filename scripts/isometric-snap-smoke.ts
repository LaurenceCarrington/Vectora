import type { LineEntity, Point2D } from "../src/document/types";
import { documentModel } from "../src/document/DocumentModel";
import { useVectorStore } from "../src/store/useVectorStore";
import {
  getAngleSnapDegrees, getWorldGridSpacing, isGridSnapEnabled, resolveDraftingSnap,
  snapWorldDeltaToGrid, snapWorldPointToAngle, snapWorldPointToGrid,
} from "../src/geometry/Snapping";
import { drawIsometricGrid } from "../src/renderer/IsometricGrid";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function close(actual: number, expected: number, message: string, tolerance = 1e-8): void {
  assert(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} != ${expected}`);
}
function pointClose(actual: Point2D, expected: Point2D, message: string): void {
  close(actual.x, expected.x, `${message} X`);
  close(actual.y, expected.y, `${message} Y`);
}
function onLattice(point: Point2D, spacing: number): void {
  // Independently evaluate the perpendicular distances to all three rendered
  // line families, rather than checking against the snapping implementation.
  for (const coordinate of [point.x / spacing,
    (-point.x / 2 + Math.sqrt(3) * point.y / 2) / spacing,
    (point.x / 2 + Math.sqrt(3) * point.y / 2) / spacing]) {
    close(coordinate, Math.round(coordinate), "Vertex misses a line family");
  }
}

const originalPreferences = useVectorStore.getState().preferences;
const update = useVectorStore.getState().updateDraftingPreferences;
try {
  update({ gridStyle: "isometric", gridSize: 10, defaultUnits: documentModel.getDocument().units,
    snapToGrid: true, angleSnapDeg: 15 });
  assert(getAngleSnapDegrees() === 30, "Isometric angle increment is not 30°");

  for (const spacing of [0.1, 10, 25.4, 137]) {
    const h = spacing / Math.sqrt(3);
    for (let i = -6; i <= 6; i += 1) {
      for (let j = -6; j <= 6; j += 1) {
        const expected = { x: i * spacing, y: (2 * j + i) * h };
        for (const [dx, dy] of [[0, 0], [0.19, -0.21], [-0.23, 0.17]]) {
          const cursor = { x: expected.x + dx * spacing, y: expected.y + dy * spacing };
          const result = snapWorldPointToGrid(cursor, spacing);
          pointClose(result, expected, "Nearby vertex");
          onLattice(result, spacing);
          pointClose(snapWorldPointToGrid(result, spacing), result, "Idempotence");
        }
      }
    }
    // Sample full cells, including regions where independently rounded oblique
    // coordinates choose the wrong vertex. Compare to exhaustive enumeration.
    for (let n = 0; n < 400; n += 1) {
      const cursor = { x: (Math.sin(n * 12.9898) * 4.3) * spacing,
        y: (Math.cos(n * 7.233) * 4.7) * spacing };
      let minimum = Infinity;
      for (let i = -8; i <= 8; i += 1) {
        for (let j = -10; j <= 10; j += 1) {
          minimum = Math.min(minimum, Math.hypot(cursor.x - i * spacing, cursor.y - (2 * j + i) * h));
        }
      }
      const result = snapWorldPointToGrid(cursor, spacing);
      close(Math.hypot(result.x - cursor.x, result.y - cursor.y), minimum, "Euclidean nearest vertex");
    }
    const tied = { x: spacing / 2, y: h / 2 };
    const tieResult = snapWorldPointToGrid(tied, spacing);
    onLattice(tieResult, spacing);
    close(Math.hypot(tieResult.x - tied.x, tieResult.y - tied.y), Math.hypot(tied.x, tied.y), "Equidistant boundary");
  }
  const zero = snapWorldPointToGrid({ x: -0.01, y: -0.01 });
  assert(!Object.is(zero.x, -0) && !Object.is(zero.y, -0), "Negative zero leaked");
  // An even column has rows at 2h intervals, not at every h.
  const staggered = snapWorldPointToGrid({ x: 0.01, y: 10 / Math.sqrt(3) });
  onLattice(staggered, 10);
  assert(Math.abs(staggered.y - 10 / Math.sqrt(3)) > 1, "Invalid rectangular row accepted");

  const anchor = { x: -20, y: 20 / Math.sqrt(3) };
  const delta = snapWorldDeltaToGrid({ x: 9.1, y: 5.1 });
  onLattice({ x: anchor.x + delta.x, y: anchor.y + delta.y }, 10);
  for (const gridEnabled of [true, false]) {
    update({ snapToGrid: gridEnabled });
    for (let degrees = -180; degrees <= 180; degrees += 30) {
      const angle = (degrees + 4) * Math.PI / 180;
      const cursor = { x: anchor.x + Math.cos(angle) * 73, y: anchor.y + Math.sin(angle) * 73 };
      const result = resolveDraftingSnap({ cursor, angleOrigin: anchor, zoom: 1, entities: [] });
      const expectedAngle = degrees * Math.PI / 180;
      const dx = result.point.x - anchor.x;
      const dy = result.point.y - anchor.y;
      close(dx * Math.sin(expectedAngle) - dy * Math.cos(expectedAngle), 0, "Constrained ray");
      assert(dx * Math.cos(expectedAngle) + dy * Math.sin(expectedAngle) > 0, "Ray reversed");
      if (gridEnabled) onLattice(result.point, 10);
      else close(Math.hypot(dx, dy), 73, "Free angle snap changed radius");
    }
  }
  update({ snapToGrid: true });
  onLattice(snapWorldPointToAngle({ x: 23, y: 17 }, { x: 1, y: 2 }), 10);

  const line = (start: Point2D): LineEntity => ({
    id: "snap-fixture", type: "line", layerId: "layer", intent: "construction",
    visible: true, locked: false,
    style: { strokeColor: null, strokeWidth: 1, fillColor: null, dashArray: [] },
    start, end: { x: start.x + 40, y: start.y },
    bbox: { minX: start.x, minY: start.y - 0.01, maxX: start.x + 40, maxY: start.y + 0.01 },
  });
  for (const start of [{ x: 10, y: 10 / Math.sqrt(3) }, { x: 10, y: 10 }]) {
    const result = resolveDraftingSnap({ cursor: start, zoom: 1, entities: [line(start)], enabledTypes: ["endpoint"] });
    onLattice(result.point, 10);
    assert((result.snap !== null) === (start.y !== 10), "Grid/OSNAP compatibility uses wrong lattice");
  }

  // Capture actual renderer paths. Every snap must lie on one line from each
  // family after the world-to-screen Y flip, pan, zoom and backing-store scale.
  for (const zoom of [0.2, 1.75, 4]) {
    for (const dpr of [1, 2, 3]) {
      const lines: [Point2D, Point2D][] = [];
      let start = { x: 0, y: 0 };
      const context = {
        beginPath() {}, stroke() {},
        moveTo(x: number, y: number) { start = { x: x * dpr, y: y * dpr }; },
        lineTo(x: number, y: number) { lines.push([start, { x: x * dpr, y: y * dpr }]); },
      } as unknown as CanvasRenderingContext2D;
      const originX = 600.5 + 37.25;
      const originY = 400.5 - 18.5;
      for (const multiple of [1, 5]) {
        lines.length = 0;
        drawIsometricGrid(context, 1201, 801, originX, originY, 10 * zoom * multiple, "black");
        const vertex = snapWorldPointToGrid({ x: 18, y: -23 }, 10 * multiple);
        const screen = { x: (originX + vertex.x * zoom) * dpr, y: (originY - vertex.y * zoom) * dpr };
        const matches = lines.filter(([a, b]) => Math.abs((b.x - a.x) * (screen.y - a.y)
          - (b.y - a.y) * (screen.x - a.x)) / Math.hypot(b.x - a.x, b.y - a.y) < 1e-8);
        assert(matches.length === 3, "Snap misses actual rendered minor/major intersection");
      }
    }
  }

  // A heavily panned canvas puts the grid's world origin far outside the
  // viewport. Lines that cross the viewport must still reach it at high zoom.
  for (const angle of [Math.PI / 2, Math.PI / 6, Math.PI * 5 / 6]) {
    const width = 1201;
    const height = 801;
    const centre = { x: width / 2, y: height / 2 };
    const direction = { x: Math.cos(angle), y: Math.sin(angle) };
    const origin = { x: centre.x - direction.x * 10_000, y: centre.y - direction.y * 10_000 };
    const lines: [Point2D, Point2D][] = [];
    let start = { x: 0, y: 0 };
    const context = {
      beginPath() {}, stroke() {},
      moveTo(x: number, y: number) { start = { x, y }; },
      lineTo(x: number, y: number) { lines.push([start, { x, y }]); },
    } as unknown as CanvasRenderingContext2D;
    drawIsometricGrid(context, width, height, origin.x, origin.y, 40, "black");
    const covered = lines.some(([a, b]) => {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const length = Math.hypot(dx, dy);
      if (Math.abs(dx / length - direction.x) > 1e-10 || Math.abs(dy / length - direction.y) > 1e-10) return false;
      const cross = Math.abs(dx * (centre.y - a.y) - dy * (centre.x - a.x)) / length;
      const projection = (centre.x - a.x) * dx + (centre.y - a.y) * dy;
      return cross < 1e-8 && projection >= 0 && projection <= length * length;
    });
    assert(covered, `High-zoom ${Math.round(angle * 180 / Math.PI)}° grid family stops before the viewport`);
  }

  update({ gridSize: 10 / 25.4, defaultUnits: "in" });
  close(getWorldGridSpacing(), 10, "Unit conversion");
  pointClose(snapWorldPointToGrid({ x: 10.1, y: 5.6 }), { x: 10, y: 10 / Math.sqrt(3) }, "Converted lattice");
  for (const gridStyle of ["lines", "dots", "isometric"] as const) {
    update({ gridStyle });
    const cursor = { x: 14.9, y: -15.1 };
    const result = resolveDraftingSnap({ cursor, zoom: 1, entities: [] });
    if (gridStyle === "isometric") onLattice(result.point, 10);
    else pointClose(result.point, { x: 10, y: -20 }, "Live style change");
    assert(getAngleSnapDegrees() === (gridStyle === "isometric" ? 30 : 15), "Angle preference not restored");
  }
  update({ gridStyle: "lines", gridVisible: false, snapToGrid: true });
  assert(isGridSnapEnabled(), "Hiding the grid disabled snapping");
  pointClose(resolveDraftingSnap({ cursor: { x: 14.9, y: -15.1 }, zoom: 1, entities: [] }).point,
    { x: 10, y: -20 }, "Hidden grid snap");
  pointClose(snapWorldDeltaToGrid({ x: 14.9, y: -15.1 }), { x: 10, y: -20 }, "Hidden grid move snap");
  update({ gridStyle: "isometric" });
  onLattice(resolveDraftingSnap({ cursor: { x: 14.9, y: -15.1 }, zoom: 1, entities: [] }).point, 10);
  update({ snapToGrid: false });
  assert(!isGridSnapEnabled(), "Snap toggle did not disable snapping while the grid was hidden");
  pointClose(resolveDraftingSnap({ cursor: { x: 14.9, y: -15.1 }, zoom: 1, entities: [] }).point,
    { x: 14.9, y: -15.1 }, "Hidden grid with snap off");
  for (const spacing of [0, -1, NaN, Infinity]) {
    let rejected = false;
    try { snapWorldPointToGrid({ x: 1, y: 2 }, spacing); } catch { rejected = true; }
    assert(rejected, "Invalid grid spacing accepted");
  }
  console.log("Isometric snapping: nearest vertices, staggered rows, all 30° rays, OSNAP, movement, live styles, units and rendered pan/zoom/DPR alignment passed.");
} finally {
  useVectorStore.setState({ preferences: originalPreferences });
}

import type { SimulatorLeadMarker } from "../cam/ToolpathSimulator";
import { vectoraRenderColors } from "../design/vectoraRenderColors";

/** Context is already in world coordinates; marker sizes stay fixed on screen. */
export function drawLeadMarkers(context: CanvasRenderingContext2D, markers: readonly SimulatorLeadMarker[], zoom: number): void {
  context.save();
  context.globalAlpha = 1;
  context.setLineDash([]);
  context.lineWidth = 1.5 / zoom;
  for (const marker of markers) {
    const first = marker.points[0], end = marker.points.at(-1), previous = marker.points.at(-2);
    if (!first || !end || !previous) continue;
    const entry = marker.role === "lead-in";
    context.fillStyle = entry ? vectoraRenderColors.toolpath.leadIn : vectoraRenderColors.toolpath.leadOut;
    context.strokeStyle = vectoraRenderColors.ui.surface;
    context.beginPath();
    if (entry) {
      context.arc(first.x, first.y, 4 / zoom, 0, Math.PI * 2);
    } else {
      const length = Math.hypot(end.x - previous.x, end.y - previous.y);
      if (length <= 1e-9) continue;
      const dx = (end.x - previous.x) / length, dy = (end.y - previous.y) / length;
      context.moveTo(end.x, end.y);
      context.lineTo(end.x - dx * 9 / zoom - dy * 4 / zoom, end.y - dy * 9 / zoom + dx * 4 / zoom);
      context.lineTo(end.x - dx * 9 / zoom + dy * 4 / zoom, end.y - dy * 9 / zoom - dx * 4 / zoom);
      context.closePath();
    }
    context.fill();
    context.stroke();
  }
  context.restore();
}

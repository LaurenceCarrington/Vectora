import { ISOMETRIC_GRID_ANGLES } from "../geometry/GridGeometry";

function drawParallelGridFamily(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  originX: number,
  originY: number,
  step: number,
  angle: number,
): void {
  const directionX = Math.cos(angle);
  const directionY = Math.sin(angle);
  const normalX = -directionY;
  const normalY = directionX;
  const topLeft = -originX * normalX - originY * normalY;
  const topRight = (width - originX) * normalX - originY * normalY;
  const bottomLeft = -originX * normalX + (height - originY) * normalY;
  const bottomRight = (width - originX) * normalX + (height - originY) * normalY;
  const first = Math.floor(Math.min(topLeft, topRight, bottomLeft, bottomRight) / step) - 1;
  const last = Math.ceil(Math.max(topLeft, topRight, bottomLeft, bottomRight) / step) + 1;
  // Project the viewport onto the line direction as well as its normal. A
  // symmetric viewport-sized extent only works while the grid origin remains
  // near the canvas; after a large pan it leaves the visible diagonal lines as
  // short, disconnected segments. Directional bounds cover the viewport no
  // matter how far its world origin has moved.
  const alongTopLeft = -originX * directionX - originY * directionY;
  const alongTopRight = (width - originX) * directionX - originY * directionY;
  const alongBottomLeft = -originX * directionX + (height - originY) * directionY;
  const alongBottomRight = (width - originX) * directionX + (height - originY) * directionY;
  const firstAlong = Math.min(alongTopLeft, alongTopRight, alongBottomLeft, alongBottomRight) - step * 2;
  const lastAlong = Math.max(alongTopLeft, alongTopRight, alongBottomLeft, alongBottomRight) + step * 2;
  for (let index = first; index <= last; index += 1) {
    const distance = index * step;
    const centerX = originX + normalX * distance;
    const centerY = originY + normalY * distance;
    context.moveTo(centerX + directionX * firstAlong, centerY + directionY * firstAlong);
    context.lineTo(centerX + directionX * lastAlong, centerY + directionY * lastAlong);
  }
}

export function drawIsometricGrid(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  originX: number,
  originY: number,
  step: number,
  color: string,
): void {
  context.beginPath();
  for (const angle of ISOMETRIC_GRID_ANGLES) {
    drawParallelGridFamily(context, width, height, originX, originY, step, angle);
  }
  context.strokeStyle = color;
  context.lineWidth = 1;
  context.stroke();
}

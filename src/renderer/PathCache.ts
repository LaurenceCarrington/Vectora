import { imageCorners } from "../cam/rasterCamEngine";
import type { Entity } from "../document/types";
import { getDimensionGeometry } from "../geometry/annotations";
import { tracePolyline } from "../geometry/bezier";

/**
 * Native paths are keyed by immutable entity objects. DocumentModel replaces an
 * entity object on every geometry mutation, so stale paths become unreachable
 * and are reclaimed automatically by the WeakMap.
 */
export class PathCache {
  private cache = new WeakMap<Entity, Path2D>();

  /** Build once at document/preview mutation time, never from the RAF renderer. */
  prepare(entity: Entity): Path2D {
    const cached = this.cache.get(entity);
    if (cached) return cached;
    const path = this.build(entity);
    this.cache.set(entity, path);
    return path;
  }

  prepareAll(entities: Iterable<Entity>): void {
    for (const entity of entities) this.prepare(entity);
  }

  /** Read-only render-loop lookup. A miss indicates a broken preparation boundary. */
  peek(entity: Entity): Path2D | undefined {
    return this.cache.get(entity);
  }

  /** Compatibility alias for code outside the render loop. */
  get(entity: Entity): Path2D {
    return this.prepare(entity);
  }

  clear(): void {
    this.cache = new WeakMap<Entity, Path2D>();
  }

  private build(entity: Entity): Path2D {
    const path = new Path2D();
    switch (entity.type) {
      case "image": {
        const corners = imageCorners(entity);
        path.moveTo(corners[0]!.x, corners[0]!.y);
        for (const p of corners.slice(1)) path.lineTo(p.x, p.y);
        path.closePath();
        break;
      }
      case "line":
        path.moveTo(entity.start.x, entity.start.y);
        path.lineTo(entity.end.x, entity.end.y);
        break;
      case "polyline": {
        tracePolyline(path, entity.points, entity.closed, entity.segments);
        break;
      }
      case "rectangle": {
        const maxRadius = Math.min(Math.abs(entity.width), Math.abs(entity.height)) / 2;
        const radius = Math.min(Math.max(0, entity.cornerRadius), maxRadius);
        if (radius > 0) {
          path.roundRect(
            entity.origin.x,
            entity.origin.y,
            entity.width,
            entity.height,
            radius,
          );
        } else {
          path.rect(entity.origin.x, entity.origin.y, entity.width, entity.height);
        }
        break;
      }
      case "circle":
        path.arc(entity.center.x, entity.center.y, entity.radius, 0, Math.PI * 2);
        break;
      case "arc":
        path.arc(
          entity.center.x,
          entity.center.y,
          entity.radius,
          entity.startAngle,
          entity.endAngle,
          entity.counterClockwise,
        );
        break;
      case "ellipse":
        path.ellipse(entity.cx, entity.cy, entity.rx, entity.ry, entity.rotation, 0, Math.PI * 2);
        path.closePath();
        break;
      case "polygon":
        for (let index = 0; index < entity.sides; index += 1) {
          const angle = entity.rotation + (index * Math.PI * 2) / entity.sides;
          const x = entity.cx + Math.cos(angle) * entity.radius;
          const y = entity.cy + Math.sin(angle) * entity.radius;
          if (index === 0) path.moveTo(x, y); else path.lineTo(x, y);
        }
        path.closePath();
        break;
      case "quadrant": {
        const start = (entity.quadrantIndex - 1) * Math.PI / 2;
        path.moveTo(entity.cx, entity.cy);
        path.lineTo(entity.cx + Math.cos(start) * entity.radius, entity.cy + Math.sin(start) * entity.radius);
        path.arc(entity.cx, entity.cy, entity.radius, start, start + Math.PI / 2);
        path.closePath();
        break;
      }
      case "semicircle":
        path.moveTo(entity.cx, entity.cy);
        path.lineTo(entity.cx + Math.cos(entity.startAngle) * entity.radius, entity.cy + Math.sin(entity.startAngle) * entity.radius);
        path.arc(entity.cx, entity.cy, entity.radius, entity.startAngle, entity.startAngle + Math.PI);
        path.closePath();
        break;
      case "segment":
        path.moveTo(entity.cx, entity.cy);
        path.lineTo(entity.cx + Math.cos(entity.startAngle) * entity.radius, entity.cy + Math.sin(entity.startAngle) * entity.radius);
        path.arc(entity.cx, entity.cy, entity.radius, entity.startAngle, entity.endAngle);
        path.closePath();
        break;
      case "star":
        for (let index = 0; index < entity.points * 2; index += 1) {
          const radius = index % 2 === 0 ? entity.outerRadius : entity.innerRadius;
          const angle = entity.rotation + (index * Math.PI) / entity.points;
          const x = entity.cx + Math.cos(angle) * radius;
          const y = entity.cy + Math.sin(angle) * radius;
          if (index === 0) path.moveTo(x, y); else path.lineTo(x, y);
        }
        path.closePath();
        break;
      case "cloud": {
        const first = entity.points[0];
        if (!first) break;
        let cx = 0;
        let cy = 0;
        for (const point of entity.points) { cx += point.x; cy += point.y; }
        cx /= entity.points.length;
        cy /= entity.points.length;
        path.moveTo(first.x, first.y);
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
          path.quadraticCurveTo(midX + nx * bulge, midY + ny * bulge, end.x, end.y);
        }
        path.closePath();
        break;
      }
      case "text":
        // Live text is rendered with CanvasRenderingContext2D.fillText. An
        // intentionally empty cached path keeps the RAF cache contract intact.
        break;
      case "dimension": {
        const geometry = getDimensionGeometry(entity);
        if (geometry.extensionStart) {
          path.moveTo(geometry.extensionStart[0].x, geometry.extensionStart[0].y);
          path.lineTo(geometry.extensionStart[1].x, geometry.extensionStart[1].y);
        }
        if (geometry.extensionEnd) {
          path.moveTo(geometry.extensionEnd[0].x, geometry.extensionEnd[0].y);
          path.lineTo(geometry.extensionEnd[1].x, geometry.extensionEnd[1].y);
        }
        path.moveTo(geometry.dimensionStart.x, geometry.dimensionStart.y);
        path.lineTo(geometry.dimensionEnd.x, geometry.dimensionEnd.y);
        for (const triangle of geometry.arrowheads) {
          path.moveTo(triangle[0].x, triangle[0].y);
          path.lineTo(triangle[1].x, triangle[1].y);
          path.lineTo(triangle[2].x, triangle[2].y);
          path.closePath();
        }
        break;
      }
      case "leader": {
        path.moveTo(entity.arrowPoint.x, entity.arrowPoint.y);
        path.lineTo(entity.elbowPoint.x, entity.elbowPoint.y);
        path.lineTo(entity.textPosition.x, entity.textPosition.y);
        const dx = entity.elbowPoint.x - entity.arrowPoint.x;
        const dy = entity.elbowPoint.y - entity.arrowPoint.y;
        const length = Math.hypot(dx, dy) || 1;
        const ux = dx / length;
        const uy = dy / length;
        const nx = -uy;
        const ny = ux;
        const size = 4;
        path.moveTo(entity.arrowPoint.x, entity.arrowPoint.y);
        path.lineTo(entity.arrowPoint.x + ux * size + nx * size * 0.38, entity.arrowPoint.y + uy * size + ny * size * 0.38);
        path.lineTo(entity.arrowPoint.x + ux * size - nx * size * 0.38, entity.arrowPoint.y + uy * size - ny * size * 0.38);
        path.closePath();
        break;
      }
    }
    return path;
  }
}

export const pathCache = new PathCache();

// @airspec/airmark-svg — SceneGraph -> SVG string. ~80 lines, zero deps.
import type { SceneGraph, SceneNode } from "@airspec/airmark-engine";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const attr = (o: Record<string, unknown>) =>
  Object.entries(o).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}="${esc(String(v))}"`).join(" ");

function node(n: SceneNode): string {
  switch (n.type) {
    case "group": return `<g>${n.children.map(node).join("")}</g>`;
    case "rect": return `<rect ${attr({ x: n.x, y: n.y, width: n.width, height: n.height, fill: n.fill, rx: n.rx, opacity: n.opacity, stroke: n.stroke, "stroke-width": n.strokeWidth })}/>`;
    case "line": return `<line ${attr({ x1: n.x1, y1: n.y1, x2: n.x2, y2: n.y2, stroke: n.stroke, "stroke-width": n.strokeWidth ?? 1, "stroke-dasharray": n.strokeDash?.join(" "), opacity: n.opacity })}/>`;
    case "path": return `<path ${attr({ d: n.d, stroke: n.stroke, fill: n.fill ?? "none", "stroke-width": n.strokeWidth, opacity: n.opacity })}/>`;
    case "circle": return `<circle ${attr({ cx: n.cx, cy: n.cy, r: n.r, fill: n.fill, opacity: n.opacity, stroke: n.stroke, "stroke-width": n.strokeWidth })}/>`;
    case "text": {
      const transform = n.angle ? `rotate(${n.angle} ${n.x} ${n.y})` : undefined;
      return `<text ${attr({ x: n.x, y: n.y, fill: n.fill, "font-size": n.fontSize, "text-anchor": n.anchor, "dominant-baseline": n.baseline, "font-weight": n.fontWeight, transform, "font-family": "system-ui, sans-serif" })}>${esc(n.content)}</text>`;
    }
    default: {
      const t = (n as { type: string }).type;
      throw new Error(`airmark-svg: unknown scene node type '${t}'`); // SCENEGRAPH.md §2: error, never skip
    }
  }
}

export function toSVG(scene: SceneGraph): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${scene.width} ${scene.height}" width="${scene.width}" height="${scene.height}">${scene.nodes.map(node).join("")}</svg>`;
}

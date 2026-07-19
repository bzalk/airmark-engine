// @airspec/airmark-react — thin React shell over the layout engine.
// All decisions happen in the engine; this file only maps SceneNodes to JSX
// and wires selection events from node.meta. Trivially replaceable per platform.
import { useMemo } from "react";
import { layout, type LayoutInput, type SceneNode } from "@airspec/airmark-engine";

export type AirmarkChartProps = LayoutInput & {
  onSelect?: (payload: { selection: string; datum: Record<string, unknown>; fields?: string[] }) => void;
};

function Node({ n, onSelect }: { n: SceneNode; onSelect?: AirmarkChartProps["onSelect"] }) {
  const sel = "meta" in n && n.meta?.selection ? n.meta : undefined;
  const handlers = sel && onSelect
    ? { onClick: () => onSelect({ selection: sel.selection!, datum: sel.datum ?? {}, fields: sel.fields }), style: { cursor: "pointer" as const } }
    : {};
  switch (n.type) {
    case "group": return <g {...handlers}>{n.children.map((c, i) => <Node key={i} n={c} onSelect={onSelect} />)}</g>;
    case "rect": return <rect x={n.x} y={n.y} width={n.width} height={n.height} fill={n.fill} rx={n.rx} opacity={n.opacity} stroke={n.stroke} strokeWidth={n.strokeWidth} {...handlers} />;
    case "line": return <line x1={n.x1} y1={n.y1} x2={n.x2} y2={n.y2} stroke={n.stroke} strokeWidth={n.strokeWidth ?? 1} strokeDasharray={n.strokeDash?.join(" ")} opacity={n.opacity} />;
    case "path": return <path d={n.d} stroke={n.stroke} fill={n.fill ?? "none"} strokeWidth={n.strokeWidth} opacity={n.opacity} {...handlers} />;
    case "circle": return <circle cx={n.cx} cy={n.cy} r={n.r} fill={n.fill} opacity={n.opacity} stroke={n.stroke} strokeWidth={n.strokeWidth} {...handlers} />;
    case "text": return <text x={n.x} y={n.y} fill={n.fill} fontSize={n.fontSize} textAnchor={n.anchor} dominantBaseline={n.baseline} fontWeight={n.fontWeight} transform={n.angle ? `rotate(${n.angle} ${n.x} ${n.y})` : undefined} style={{ fontFamily: "system-ui, sans-serif" }}>{n.content}</text>;
    default: throw new Error(`airmark-react: unknown scene node type '${(n as { type: string }).type}'`);
  }
}

export function AirmarkChart({ onSelect, ...input }: AirmarkChartProps) {
  const scene = useMemo(() => layout(input),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- serialized deps: engine is pure
    [JSON.stringify(input.graphic), input.rows, input.width, input.height, JSON.stringify(input.theme), JSON.stringify(input.selectionState)]);
  return (
    <svg viewBox={`0 0 ${scene.width} ${scene.height}`} width="100%" role="img">
      {scene.nodes.map((n, i) => <Node key={i} n={n} onSelect={onSelect} />)}
    </svg>
  );
}

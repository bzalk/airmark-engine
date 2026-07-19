// @airspec/airmark-react — thin React shell over the layout engine.
// All decisions happen in the engine; this file only maps SceneNodes to JSX
// and wires selection events from node.meta. Trivially replaceable per platform.
import { useEffect, useMemo, useRef, useState } from "react";
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
  // Scale 1 by construction: layout dimensions ARE the rendered dimensions.
  // Never stretch this SVG with CSS width/height — text, ticks, and margins
  // are computed for these exact pixels; scaling breaks all of them.
  return (
    <svg width={scene.width} height={scene.height} viewBox={`0 0 ${scene.width} ${scene.height}`} role="img" style={{ display: "block" }}>
      {scene.nodes.map((n, i) => <Node key={i} n={n} onSelect={onSelect} />)}
    </svg>
  );
}

/**
 * Container-driven variant: measures its own content box with a ResizeObserver
 * and calls the engine with the REAL pixel dimensions, re-laying out on resize.
 * Use this inside document-grid cells so the chart always obeys its card.
 */
export function AirmarkChartAuto({ onSelect, minHeight, ...input }: Omit<AirmarkChartProps, "width" | "height"> & { minHeight?: number }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      const w = Math.round(r.width), h = Math.round(r.height);
      if (w > 10 && h > 10) setSize((s) => (s && s.w === w && s.h === h ? s : { w, h }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} style={{ width: "100%", height: "100%", minHeight: minHeight ?? 240, overflow: "hidden" }}>
      {size && <AirmarkChart {...(input as Omit<AirmarkChartProps, "onSelect">)} width={size.w} height={size.h} onSelect={onSelect} />}
    </div>
  );
}

// @airspec/airmark-react — thin React shell over the layout engine.
// All decisions happen in the engine; this file only maps SceneNodes to JSX
// and wires selection events from node.meta. Trivially replaceable per platform.
import { useEffect, useMemo, useRef, useState } from "react";
import { layout, type LayoutInput, type SceneNode } from "@airspec/airmark-engine";

export type AirmarkChartProps = LayoutInput & {
  onSelect?: (payload: { selection: string; datum: Record<string, unknown>; fields?: string[] }) => void;
  /**
   * Animate marks between data states (data refresh, cross-filter, live update).
   * Purely presentational: the scene graph itself stays deterministic and
   * conformance-relevant; only the on-screen interpolation between two exact
   * layouts is smoothed. Rects, circles, and opacity/fill morph via CSS
   * geometry transitions; axis text crossfades; paths/lines snap (for now).
   * Requires stable mark identity across states — nodes are keyed by their
   * role and position within role, which is stable while the category domain
   * is stable (the common refresh case).
   */
  transitionMs?: number;
};

function Node({ n, onSelect, t }: { n: SceneNode; onSelect?: AirmarkChartProps["onSelect"]; t?: number }) {
  const sel = "meta" in n && n.meta?.selection ? n.meta : undefined;
  const handlers = sel && onSelect
    ? { onClick: () => onSelect({ selection: sel.selection!, datum: sel.datum ?? {}, fields: sel.fields }), style: { cursor: "pointer" as const } }
    : {};
  // CSS geometry transitions (SVG2): rect x/y/width/height and circle cx/cy/r
  // are CSS properties in modern browsers; setting them via style makes them
  // interpolate under a transition. Attributes remain for static renderers.
  const ease = t ? `${t}ms cubic-bezier(0.25, 0.1, 0.25, 1)` : undefined;
  switch (n.type) {
    case "group": return <g {...handlers}>{n.children.map((c, i) => <Node key={i} n={c} onSelect={onSelect} t={t} />)}</g>;
    case "rect": {
      const anim = ease ? { style: { x: `${n.x}px`, y: `${n.y}px`, width: `${n.width}px`, height: `${n.height}px`,
        transition: `x ${ease}, y ${ease}, width ${ease}, height ${ease}, fill ${ease}, opacity ${ease}`,
        ...(handlers.style ?? {}) } } : {};
      return <rect x={n.x} y={n.y} width={n.width} height={n.height} fill={n.fill} rx={n.rx} opacity={n.opacity} stroke={n.stroke} strokeWidth={n.strokeWidth} {...handlers} {...anim} />;
    }
    case "line": return <line x1={n.x1} y1={n.y1} x2={n.x2} y2={n.y2} stroke={n.stroke} strokeWidth={n.strokeWidth ?? 1} strokeDasharray={n.strokeDash?.join(" ")} opacity={n.opacity} />;
    case "path": return <path d={n.d} stroke={n.stroke} fill={n.fill ?? "none"} strokeWidth={n.strokeWidth} opacity={n.opacity} {...handlers} />;
    case "circle": {
      const anim = ease ? { style: { cx: `${n.cx}px`, cy: `${n.cy}px`, r: `${n.r}px`,
        transition: `cx ${ease}, cy ${ease}, r ${ease}, fill ${ease}, opacity ${ease}`,
        ...(handlers.style ?? {}) } } : {};
      return <circle cx={n.cx} cy={n.cy} r={n.r} fill={n.fill} opacity={n.opacity} stroke={n.stroke} strokeWidth={n.strokeWidth} {...handlers} {...anim} />;
    }
    case "text": return <text x={n.x} y={n.y} fill={n.fill} fontSize={n.fontSize} textAnchor={n.anchor} dominantBaseline={n.baseline} fontWeight={n.fontWeight} transform={n.angle ? `rotate(${n.angle} ${n.x} ${n.y})` : undefined} style={{ fontFamily: "system-ui, sans-serif", ...(ease ? { transition: `opacity ${ease}` } : {}) }}>{n.content}</text>;
    default: throw new Error(`airmark-react: unknown scene node type '${(n as { type: string }).type}'`);
  }
}

// Stable identity across data states: nodes keyed by role + ordinal within
// (type, role). While the category domain is stable (the normal refresh /
// cross-filter case) mark N remains mark N, so CSS transitions interpolate.
function keyed(nodes: SceneNode[]): Array<{ k: string; n: SceneNode }> {
  const counters: Record<string, number> = {};
  return nodes.map((n) => {
    const role = ("meta" in n && n.meta?.role) || "chrome";
    const bucket = `${n.type}:${role}`;
    const i = (counters[bucket] = (counters[bucket] ?? 0) + 1);
    return { k: `${bucket}:${i}`, n };
  });
}

export function AirmarkChart({ onSelect, transitionMs, ...input }: AirmarkChartProps) {
  const scene = useMemo(() => layout(input),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- serialized deps: engine is pure
    [JSON.stringify(input.graphic), input.rows, input.width, input.height, JSON.stringify(input.theme), JSON.stringify(input.selectionState)]);
  // Scale 1 by construction: layout dimensions ARE the rendered dimensions.
  // Never stretch this SVG with CSS width/height — text, ticks, and margins
  // are computed for these exact pixels; scaling breaks all of them.
  return (
    <svg width={scene.width} height={scene.height} viewBox={`0 0 ${scene.width} ${scene.height}`} role="img" style={{ display: "block" }}>
      {keyed(scene.nodes).map(({ k, n }) => <Node key={k} n={n} onSelect={onSelect} t={transitionMs} />)}
    </svg>
  );
}

/**
 * Container-driven variant: measures its own content box with a ResizeObserver
 * and calls the engine with the REAL pixel dimensions, re-laying out on resize.
 * Use this inside document-grid cells so the chart always obeys its card.
 */
export function AirmarkChartAuto({ onSelect, minHeight, transitionMs, ...input }: Omit<AirmarkChartProps, "width" | "height"> & { minHeight?: number }) {
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
      {size && <AirmarkChart {...(input as Omit<AirmarkChartProps, "onSelect">)} width={size.w} height={size.h} onSelect={onSelect} transitionMs={transitionMs} />}
    </div>
  );
}

// packages/engine/src/core.ts
// Pure, deterministic primitives shared by the layout pipeline.
// Zero dependencies. No I/O, no Date.now, no Math.random, no locale.

// ---------- Scene graph ----------
export type Meta = {
  role?: "mark" | "axis" | "grid" | "label" | "title";
  datum?: Record<string, unknown>;
  selection?: string;
  fields?: string[];
};
export type RectNode = { type: "rect"; x: number; y: number; width: number; height: number; fill: string; rx?: number; opacity?: number; stroke?: string; strokeWidth?: number; meta?: Meta };
export type LineNode = { type: "line"; x1: number; y1: number; x2: number; y2: number; stroke: string; strokeWidth?: number; strokeDash?: number[]; opacity?: number; meta?: Meta };
export type PathNode = { type: "path"; d: string; stroke?: string; fill?: string; strokeWidth?: number; opacity?: number; meta?: Meta };
export type CircleNode = { type: "circle"; cx: number; cy: number; r: number; fill: string; opacity?: number; stroke?: string; strokeWidth?: number; meta?: Meta };
export type TextNode = { type: "text"; x: number; y: number; content: string; fill: string; fontSize: number; anchor: "start" | "middle" | "end"; baseline?: "alphabetic" | "middle" | "hanging"; angle?: number; fontWeight?: number; meta?: Meta };
export type GroupNode = { type: "group"; children: SceneNode[]; meta?: Meta };
export type SceneNode = RectNode | LineNode | PathNode | CircleNode | TextNode | GroupNode;
export type SceneGraph = { width: number; height: number; nodes: SceneNode[] };

// ---------- AIRMark graphic (input) ----------
export type FormatObject = { type: string; maximumFractionDigits?: number; minimumFractionDigits?: number; notation?: string; currency?: string; pattern?: string };
export type Channel = {
  field?: string;
  type?: "quantitative" | "temporal" | "ordinal" | "nominal";
  aggregate?: "count" | "countDistinct" | "sum" | "average" | "minimum" | "maximum" | "median";
  bin?: boolean | { maxbins?: number };
  timeUnit?: string;
  sort?: "ascending" | "descending" | "x" | "y" | "-x" | "-y" | null | Array<string | number>;
  stack?: "zero" | "normalize" | "center" | null;
  title?: string | null;
  axis?: null | { title?: string | null; labelAngle?: number; labelLimit?: number; orient?: string; grid?: boolean; ticks?: boolean; tickCount?: number; format?: FormatObject };
  legend?: null | Record<string, unknown>;
  scale?: { type?: string; domain?: Array<number | string>; range?: string[]; scheme?: string; zero?: boolean; nice?: boolean; padding?: number };
  format?: FormatObject;
  value?: unknown;
  condition?: { selection: string; value?: unknown; field?: string; type?: string };
};
export type MarkDef = { type: string; color?: string; opacity?: number; size?: number; interpolate?: string; point?: boolean; tooltip?: boolean; filled?: boolean; cornerRadius?: number; cornerRadiusEnd?: number; strokeWidth?: number; strokeDash?: number[]; innerRadius?: number; outerRadius?: number };
export type Mark = string | MarkDef;
export type Encoding = Record<string, Channel | Channel[]>;
export type Predicate =
  | { field: string; equal?: unknown; oneOf?: unknown[]; range?: [number, number]; lt?: number; lte?: number; gt?: number; gte?: number; valid?: boolean }
  | { and: Predicate[] } | { or: Predicate[] } | { not: Predicate };
export type Transform = Record<string, unknown>; // discriminated by single key
export type Selection = { id: string; type: "point" | "interval"; on?: string; fields?: string[] };
export type UnitGraphic = { mark: Mark; encoding: Encoding; transform?: Transform[]; selections?: Selection[]; width?: number; height?: number; config?: Record<string, unknown> };
export type LayeredGraphic = { layers: UnitGraphic[]; width?: number; height?: number; config?: Record<string, unknown> };
export type Graphic = UnitGraphic | LayeredGraphic;

export type Theme = { palette: string[]; hue: string; fontSize: number; axisColor: string; gridColor: string; labelColor: string };
export const DEFAULT_THEME: Theme = { palette: ["#3264D6", "#26A69A", "#F59E0B", "#DC5A5A"], hue: "#3264D6", fontSize: 11, axisColor: "#4A576C", gridColor: "#E1E7F0", labelColor: "#4A576C" };

export type Row = Record<string, unknown>;
export type MeasureText = (content: string, fontSize: number, fontWeight?: number) => number;
export type LayoutInput = { graphic: Graphic; rows: Row[]; width: number; height: number; theme?: Partial<Theme>; measureText?: MeasureText; selectionState?: Record<string, Array<Record<string, unknown>>> };

// ---------- Determinism helpers ----------
export const r2 = (n: number): number => {
  const v = Math.round(n * 100) / 100;
  return Object.is(v, -0) ? 0 : v;
};
export const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

// SCENEGRAPH.md §5 — width-class text estimator (the only measurer used for goldens)
const CLASS_028 = new Set("iljI.,':;|!".split(""));
const CLASS_034 = new Set('ftr()[]{}"'.split(""));
const CLASS_085 = new Set("MWmw".split(""));
export const defaultMeasureText: MeasureText = (content, fontSize) => {
  let units = 0;
  for (const c of content) {
    if (CLASS_028.has(c)) units += 0.28;
    else if (CLASS_034.has(c)) units += 0.34;
    else if (c === " ") units += 0.30;
    else if (c >= "0" && c <= "9") units += 0.55;
    else if (CLASS_085.has(c)) units += 0.85;
    else if (c >= "A" && c <= "Z") units += 0.68;
    else units += 0.52;
  }
  return units * fontSize;
};
export const textHeight = (fontSize: number) => fontSize * 1.2;

export const truncateToFit = (content: string, maxWidth: number, fontSize: number, measure: MeasureText): string => {
  if (measure(content, fontSize) <= maxWidth) return content;
  const ell = "…";
  let out = "";
  for (const c of content) {
    if (measure(out + c + ell, fontSize) > maxWidth) break;
    out += c;
  }
  return out.length ? out + ell : ell;
};

// SCENEGRAPH.md §4.1 — normative tick/nice-domain algorithm
export type TickResult = { niceMin: number; niceMax: number; step: number; ticks: number[] };
export function niceTicks(dmin: number, dmax: number, axisLengthPx: number, opts?: { includeZero?: boolean; nice?: boolean; tickCount?: number }): TickResult {
  let lo = dmin, hi = dmax;
  if (opts?.includeZero) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
  if (lo === hi) hi = lo + 1;
  const targetCount = opts?.tickCount ?? clamp(Math.floor(axisLengthPx / 50), 2, 10);
  const span = hi - lo;
  const raw = span / targetCount;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const r = raw / mag;
  const step = mag * (r <= 1 ? 1 : r <= 2 ? 2 : r <= 5 ? 5 : 10);
  const niceMin = Math.floor(lo / step) * step;
  const niceMax = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  const n = Math.round((niceMax - niceMin) / step);
  for (let i = 0; i <= n; i++) ticks.push(niceMin + i * step);
  if (opts?.nice === false) {
    // domain is raw extent, ticks limited to those inside it
    return { niceMin: lo, niceMax: hi, step, ticks: ticks.filter((t) => t >= lo - 1e-9 && t <= hi + 1e-9) };
  }
  return { niceMin, niceMax, step, ticks };
}

// SCENEGRAPH.md §4.4 — locale-free tick label
export function formatTick(value: number, step: number): string {
  const decimals = clamp(Math.max(0, -Math.floor(Math.log10(step) + 1e-9)), 0, 10);
  let s = value.toFixed(decimals);
  if (decimals > 0) s = s.replace(/\.?0+$/, "");
  if (s === "-0" || s === "") s = "0";
  return s;
}

// Apply an AIRspec §11 format object with locale-free rules; fall back to tick formatting.
export function formatValue(value: unknown, fmt: FormatObject | undefined, step: number): string {
  if (typeof value !== "number") return String(value ?? "");
  if (!fmt) return formatTick(value, step);
  const max = fmt.maximumFractionDigits ?? 2;
  const min = fmt.minimumFractionDigits ?? 0;
  let v = value, suffix = "";
  if (fmt.notation === "compact") {
    const abs = Math.abs(v);
    if (abs >= 1e9) { v = v / 1e9; suffix = "B"; }
    else if (abs >= 1e6) { v = v / 1e6; suffix = "M"; }
    else if (abs >= 1e3) { v = v / 1e3; suffix = "K"; }
  }
  let s = v.toFixed(max);
  if (max > min) {
    s = s.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
    const dot = s.indexOf(".");
    const cur = dot === -1 ? 0 : s.length - dot - 1;
    if (cur < min) s = v.toFixed(min);
  }
  if (s === "-0") s = "0";
  const pct = fmt.type === "percent" ? "%" : "";
  const cur = fmt.type === "currency" ? "$" : "";
  return cur + s + suffix + pct;
}

// SCENEGRAPH.md §4.2 — band scale
export type BandScale = { kind: "band"; domain: Array<string | number>; start: number; length: number; step: number; bandwidth: number; position: (v: unknown) => number; center: (v: unknown) => number };
export function bandScale(domain: Array<string | number>, start: number, length: number, paddingInner = 0.15, paddingOuter = 0.1): BandScale {
  const n = domain.length;
  const step = n > 0 ? length / (n - paddingInner + 2 * paddingOuter) : 0;
  const bandwidth = step * (1 - paddingInner);
  const index = new Map(domain.map((d, i) => [String(d), i]));
  const position = (v: unknown) => {
    const i = index.get(String(v));
    return i === undefined ? NaN : start + step * paddingOuter + i * step;
  };
  return { kind: "band", domain, start, length, step, bandwidth, position, center: (v) => position(v) + bandwidth / 2 };
}

export type LinearScale = { kind: "linear"; domain: [number, number]; range: [number, number]; scale: (v: number) => number; ticksInfo: TickResult };
export function linearScale(ticksInfo: TickResult, range: [number, number], nice = true): LinearScale {
  const domain: [number, number] = [ticksInfo.niceMin, ticksInfo.niceMax];
  const [d0, d1] = domain; const [r0, r1] = range;
  const k = d1 === d0 ? 0 : (r1 - r0) / (d1 - d0);
  return { kind: "linear", domain, range, ticksInfo, scale: (v) => r0 + (v - d0) * k };
}

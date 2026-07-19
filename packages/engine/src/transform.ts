// packages/engine/src/transform.ts
// Data-shaping stage: structured predicates, channel-level aggregation,
// binning, and nominal-domain sort resolution. Pure and deterministic.

import { Channel, Encoding, Predicate, Row, Transform, niceTicks } from "./core.js";

export function matchPredicate(p: Predicate, row: Row): boolean {
  if ("and" in p) return p.and.every((q) => matchPredicate(q, row));
  if ("or" in p) return p.or.some((q) => matchPredicate(q, row));
  if ("not" in p) return !matchPredicate(p.not, row);
  const v = row[p.field];
  if (p.valid !== undefined) {
    const ok = v !== null && v !== undefined && !(typeof v === "number" && Number.isNaN(v));
    return p.valid ? ok : !ok;
  }
  if ("equal" in p) return v === p.equal;
  if (p.oneOf) return p.oneOf.some((o) => o === v);
  if (p.range) { const n = Number(v); return n >= p.range[0] && n <= p.range[1]; }
  if (p.lt !== undefined) return Number(v) < p.lt;
  if (p.lte !== undefined) return Number(v) <= p.lte;
  if (p.gt !== undefined) return Number(v) > p.gt;
  if (p.gte !== undefined) return Number(v) >= p.gte;
  return true;
}

export function applyTransforms(rows: Row[], transforms: Transform[] | undefined): Row[] {
  let out = rows;
  for (const t of transforms ?? []) {
    if ("filter" in t) out = out.filter((r) => matchPredicate(t.filter as Predicate, r));
    // aggregate / bin / timeUnit as explicit graphic transforms are handled by
    // the same helpers as channel-level shorthands; explicit forms are TODO'd
    // to fixtures before implementation (deny-by-default: unknown transform -> error).
    else if ("aggregate" in t || "bin" in t || "timeUnit" in t || "stack" in t || "window" in t || "fold" in t || "flatten" in t || "pivot" in t || "sort" in t) {
      throw new Error(`airmark-engine: explicit transform '${Object.keys(t)[0]}' not implemented yet — add a golden fixture and implement in transform.ts`);
    } else {
      throw new Error(`airmark-engine: unknown transform '${Object.keys(t)[0]}'`);
    }
  }
  return out;
}

const num = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
};

export function computeOp(op: NonNullable<Channel["aggregate"]>, values: unknown[], field?: string): number {
  const nums = field === undefined && op === "count" ? [] : values.map(num).filter((v): v is number => v !== null);
  switch (op) {
    case "count": return values.length;
    case "countDistinct": return new Set(values.map((v) => String(v))).size;
    case "sum": return nums.reduce((a, b) => a + b, 0);
    case "average": return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
    case "minimum": return nums.length ? Math.min(...nums) : 0;
    case "maximum": return nums.length ? Math.max(...nums) : 0;
    case "median": {
      if (!nums.length) return 0;
      const s = [...nums].sort((a, b) => a - b);
      const m = Math.floor(s.length / 2);
      return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
    }
  }
}

const asChannel = (c: Channel | Channel[] | undefined): Channel | undefined => (Array.isArray(c) ? c[0] : c);

export type ResolvedLayerData = {
  rows: Row[];              // post aggregation/binning; fields referenced by channels exist on these rows
  binned: boolean;          // x carries __bin0/__bin1 interval fields
  xField?: string; yField?: string; colorField?: string;
};

// Resolve channel-level aggregate/bin shorthands into concrete rows.
// Grouping keys: the non-aggregated positional field plus the color field.
export function resolveLayerData(rows: Row[], encoding: Encoding, plotWidth: number): ResolvedLayerData {
  const x = asChannel(encoding.x), y = asChannel(encoding.y), color = asChannel(encoding.color);
  const colorField = color?.field;

  // --- binning: quantitative bin on x (histogram) ---
  const binDef = x?.bin;
  if (binDef) {
    const maxbins = typeof binDef === "object" && binDef.maxbins ? binDef.maxbins : 10;
    const field = x!.field!;
    const values = rows.map((r) => num(r[field])).filter((v): v is number => v !== null);
    const lo = Math.min(...values), hi = Math.max(...values);
    // bin boundaries reuse the normative nice-step algorithm with targetCount=maxbins
    const t = niceTicks(lo, hi, maxbins * 50, { tickCount: maxbins });
    const edges: number[] = [];
    for (let e = t.niceMin; e <= t.niceMax + 1e-9; e += t.step) edges.push(e);
    const buckets: Row[][] = Array.from({ length: edges.length - 1 }, () => []);
    for (const r of rows) {
      const v = num(r[field]);
      if (v === null) continue;
      let i = Math.floor((v - t.niceMin) / t.step);
      if (i >= buckets.length) i = buckets.length - 1;
      if (i < 0) i = 0;
      buckets[i].push(r);
    }
    const yOp = y?.aggregate ?? "count";
    const out: Row[] = buckets.map((b, i) => ({
      __bin0: edges[i], __bin1: edges[i + 1],
      [yFieldName(y)]: computeOp(yOp, y?.field ? b.map((r) => r[y.field!]) : b, y?.field),
    }));
    return { rows: out, binned: true, xField: "__bin0", yField: yFieldName(y), colorField };
  }

  // --- channel aggregation: one positional channel aggregates, grouped by the other ---
  const agg = x?.aggregate ? { ch: x!, other: y } : y?.aggregate ? { ch: y!, other: x } : null;
  if (agg) {
    const groupField = agg.other?.field;
    const keys: string[] = [];
    const groups = new Map<string, Row[]>();
    for (const r of rows) {
      const key = JSON.stringify([groupField ? r[groupField] : "__all", colorField ? r[colorField] : null]);
      if (!groups.has(key)) { groups.set(key, []); keys.push(key); }
      groups.get(key)!.push(r);
    }
    const aggName = aggFieldName(agg.ch);
    const out: Row[] = keys.map((key) => {
      const [gv, cv] = JSON.parse(key) as [unknown, unknown];
      const g = groups.get(key)!;
      const row: Row = {};
      if (groupField) row[groupField] = gv;
      if (colorField) row[colorField] = cv;
      row[aggName] = computeOp(agg.ch.aggregate!, agg.ch.field ? g.map((r) => r[agg.ch.field!]) : g, agg.ch.field);
      return row;
    });
    const xf = x === agg.ch ? aggName : x?.field;
    const yf = y === agg.ch ? aggName : y?.field;
    return { rows: out, binned: false, xField: xf, yField: yf, colorField };
  }

  return { rows, binned: false, xField: x?.field, yField: y?.field, colorField };
}

export const aggFieldName = (c: Channel): string => c.field ? `__${c.aggregate}_${c.field}` : `__${c.aggregate}`;
const yFieldName = (y: Channel | undefined): string => (y?.aggregate ? aggFieldName(y) : y?.field ?? "__count");

// SCENEGRAPH.md §4.3 — nominal domain order (stable)
export function nominalDomain(rows: Row[], field: string, sort: Channel["sort"], otherField?: string): Array<string | number> {
  const seen = new Set<string>();
  const items: Array<{ v: string | number; other: number }> = [];
  for (const r of rows) {
    const raw = r[field];
    const v = (typeof raw === "number" ? raw : String(raw)) as string | number;
    const k = String(v);
    if (seen.has(k)) continue;
    seen.add(k);
    const o = otherField ? num(r[otherField]) ?? 0 : 0;
    items.push({ v, other: o });
  }
  if (Array.isArray(sort)) {
    const order = new Map(sort.map((s, i) => [String(s), i]));
    return [...items].sort((a, b) => (order.get(String(a.v)) ?? 1e9) - (order.get(String(b.v)) ?? 1e9)).map((i) => i.v);
  }
  const cmpSelf = (a: { v: string | number }, b: { v: string | number }) =>
    typeof a.v === "number" && typeof b.v === "number" ? a.v - b.v : String(a.v) < String(b.v) ? -1 : String(a.v) > String(b.v) ? 1 : 0;
  switch (sort) {
    case "ascending": return [...items].sort(cmpSelf).map((i) => i.v);
    case "descending": return [...items].sort((a, b) => cmpSelf(b, a)).map((i) => i.v);
    case "y": case "x": return [...items].sort((a, b) => a.other - b.other).map((i) => i.v);
    case "-y": case "-x": return [...items].sort((a, b) => b.other - a.other).map((i) => i.v);
    default: return items.map((i) => i.v); // null / undefined = data order
  }
}

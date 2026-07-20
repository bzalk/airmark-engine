// packages/engine/src/layout.ts
// Layout pipeline: validated graphic + rows + size -> SceneGraph.
// Implements SCENEGRAPH.md §6: orientation, shared scales across layers,
// stacking/grouping, temporal axes, legends, facets, arcs.
// Pure and deterministic.

import {
  BandScale, Channel, DEFAULT_THEME, Graphic, LayoutInput, LinearScale, PlotBounds,
  MarkDef, MeasureText, Meta, Row, SceneGraph, SceneNode, TextNode, Theme,
  UnitGraphic, arcPath, bandScale, boxStats, defaultMeasureText, formatTick, formatValue, logScale, LogScale,
  linearScale, niceTicks, parseTemporal, r2, textHeight, timeTicks, truncateToFit,
} from "./core.js";
import { applyTransforms, nominalDomain, resolveLayerData, ResolvedLayerData } from "./transform.js";

const asChannel = (c: Channel | Channel[] | undefined): Channel | undefined => (Array.isArray(c) ? c[0] : c);
const markDef = (m: UnitGraphic["mark"]): MarkDef => (typeof m === "string" ? { type: m } : m);
const isQuant = (c?: Channel) => c?.type === "quantitative" || !!c?.aggregate || !!c?.bin;
const num = (v: unknown): number => (typeof v === "number" ? v : Number(v));

type Ctx = { theme: Theme; measure: MeasureText; selectionState?: LayoutInput["selectionState"] };
type Rect = { x: number; y: number; w: number; h: number };
type Shared = { qLo: number; qHi: number; domainNominal: Array<string | number>; colorDomain: Array<string | number> };
type Prepared = { unit: UnitGraphic; mark: MarkDef; data: ResolvedLayerData };

export function layout(input: LayoutInput): SceneGraph {
  const ctx: Ctx = {
    theme: { ...DEFAULT_THEME, ...(input.theme ?? {}) },
    measure: input.measureText ?? defaultMeasureText,
    selectionState: input.selectionState,
  };
  const units: UnitGraphic[] = "layers" in input.graphic ? input.graphic.layers : [input.graphic];
  if (units.length === 0) throw new Error("airmark-engine: graphic has no layers");
  const nodes: SceneNode[] = [];

  // ---- Facet dispatch (SCENEGRAPH.md §6: small multiples share all scales) ----
  const enc0 = units[0].encoding;
  const facetCh = asChannel(enc0.facet) ?? asChannel(enc0.column) ?? asChannel(enc0.row);
  const facetMode = asChannel(enc0.facet) ? "facet" : asChannel(enc0.column) ? "column" : asChannel(enc0.row) ? "row" : null;

  if (facetCh && facetMode) {
    if (!facetCh.field) throw new Error("airmark-engine: facet channel requires a field");
    const fField = facetCh.field;
    const panelsOf = nominalDomain(input.rows, fField, facetCh.sort ?? "ascending");
    const k = panelsOf.length;
    const cols = facetMode === "column" ? k : facetMode === "row" ? 1 : Math.ceil(Math.sqrt(k));
    const rowsN = Math.ceil(k / cols);
    const gap = 16, titleH = textHeight(ctx.theme.fontSize) + 4;
    const strippedUnits = units.map((u) => {
      const { facet: _f, column: _c, row: _r, ...restEnc } = u.encoding;
      return { ...u, encoding: restEnc };
    });
    // Shared domains over ALL rows
    const shared = computeShared(strippedUnits, input.rows, ctx);
    const pw = (input.width - gap * (cols - 1)) / cols;
    const ph = (input.height - gap * (rowsN - 1)) / rowsN;
    panelsOf.forEach((pv, i) => {
      const cx = i % cols, cy = Math.floor(i / cols);
      const rect: Rect = { x: r2(cx * (pw + gap)), y: r2(cy * (ph + gap) + titleH), w: r2(pw), h: r2(ph - titleH) };
      nodes.push({ type: "text", x: r2(rect.x + rect.w / 2), y: r2(rect.y - 6), content: String(pv), fill: ctx.theme.labelColor, fontSize: ctx.theme.fontSize, anchor: "middle", fontWeight: 600, meta: { role: "title" } });
      const panelRows = input.rows.filter((r) => String(r[fField]) === String(pv));
      nodes.push(...layoutPanel(strippedUnits, panelRows, rect, ctx, shared, { suppressLegend: true }).nodes);
    });
    // One shared legend at top-level would overlap panels; facet legends are a
    // deliberate follow-up (throwing keeps deny-by-default honest):
    if (shared.colorDomain.length && asChannel(strippedUnits[0].encoding.color)?.legend !== null && asChannel(strippedUnits[0].encoding.color)?.field !== fField) {
      throw new Error("airmark-engine: color legend inside facets not implemented yet — add a golden fixture");
    }
    return { width: input.width, height: input.height, nodes };
  }

  const panel = layoutPanel(units, input.rows, { x: 0, y: 0, w: input.width, h: input.height }, ctx);
  nodes.push(...panel.nodes);
  return { width: input.width, height: input.height, nodes, ...(panel.plot ? { plot: panel.plot } : {}) };
}

function computeShared(units: UnitGraphic[], rows: Row[], ctx: Ctx): Shared {
  const prepared = units.map((unit) => ({ unit, mark: markDef(unit.mark), data: resolveLayerData(applyTransforms(rows, unit.transform), unit.encoding, 0) }));
  const x0 = asChannel(prepared[0].unit.encoding.x), y0 = asChannel(prepared[0].unit.encoding.y);
  const horizontal = isQuant(x0) && !isQuant(y0) && !!y0;
  let qLo = Infinity, qHi = -Infinity;
  for (const p of prepared) {
    const f = horizontal ? p.data.xField : p.data.yField;
    for (const r of p.data.rows) { const v = num(r[f!]); if (Number.isFinite(v)) { qLo = Math.min(qLo, v); qHi = Math.max(qHi, v); } }
  }
  if (!Number.isFinite(qLo)) { qLo = 0; qHi = 1; }
  const nomField = horizontal ? prepared[0].data.yField : prepared[0].data.xField;
  const nomCh = horizontal ? y0 : x0;
  const domainNominal = nomField && nomCh ? nominalDomain(prepared[0].data.rows, nomField, nomCh.sort, horizontal ? prepared[0].data.xField : prepared[0].data.yField) : [];
  const colorField = prepared[0].data.colorField;
  const colorDomain = colorField ? nominalDomain(prepared[0].data.rows, colorField, null) : [];
  return { qLo, qHi, domainNominal, colorDomain };
}

function layoutPanel(units: UnitGraphic[], rowsIn: Row[], rect: Rect, ctx: Ctx, shared?: Shared, opts?: { suppressLegend?: boolean }): { nodes: SceneNode[]; plot: PlotBounds | null } {
  const { theme, measure } = ctx;
  const fs = theme.fontSize;
  const nodes: SceneNode[] = [];
  const push = (n: SceneNode) => nodes.push(n);

  const prepared: Prepared[] = units.map((unit) => ({ unit, mark: markDef(unit.mark), data: resolveLayerData(applyTransforms(rowsIn, unit.transform), unit.encoding, rect.w) }));

  // Contract check (SCENEGRAPH §3): rows are flat objects keyed by field/alias.
  // A referenced field missing from the rows is a broker/dataset contract
  // violation — name it, never render an "undefined" band.
  for (const p of prepared) {
    if (!p.data.rows.length) continue;
    const keys = new Set(Object.keys(p.data.rows[0]));
    const needed = [p.data.xField, p.data.yField, p.data.colorField]
      .filter((f): f is string => !!f && !f.startsWith("__"));
    // Every row must carry every encoded field — a single keyless row (e.g. a
    // rollup/total row appended by a data layer) must be a named error, not a
    // phantom 'undefined' band.
    for (let ri = 0; ri < p.data.rows.length; ri++) {
      const bad = needed.filter((f) => !(f in p.data.rows[ri]));
      if (bad.length && ri > 0) {
        throw new Error(`airmark-engine: row ${ri} is missing encoded field${bad.length > 1 ? "s" : ""} '${bad.join("', '")}' (other rows have ${bad.length > 1 ? "them" : "it"}) — the data layer emitted a partial row, e.g. an aggregation rollup/total row; aggregate responses must contain exactly one complete row per group`);
      }
    }
    const missing = needed.filter((f) => !keys.has(f));
    if (missing.length) {
      const hints = missing.map((f) => {
        const fl = f.toLowerCase();
        const near = [...keys].find((k) => { const kl = k.toLowerCase(); return kl.endsWith("_" + fl) || kl.startsWith(fl + "_") || kl.replace(/[_-]/g, "") === fl; });
        return near ? `row key '${near}' looks like a renamed '${f}' — the data layer is applying its own output naming; outputs must use the document's declared alias (or the field name for dimensions)` : null;
      }).filter(Boolean);
      throw new Error(`airmark-engine: encoding references field${missing.length > 1 ? "s" : ""} '${missing.join("', '")}' but data rows have keys [${[...keys].join(", ")}] — the dataset output does not match the encoding.${hints.length ? " Hint: " + hints.join("; ") : ""}`);
    }
  }

  // ---------- ARC / PIE ----------
  if (prepared[0].mark.type === "arc") return { nodes: layoutArc(prepared[0], rect, ctx, opts), plot: null };

  const x0 = asChannel(prepared[0].unit.encoding.x);
  const y0 = asChannel(prepared[0].unit.encoding.y);
  if (!x0 && !y0) throw new Error("airmark-engine: encoding needs an x or y channel");
  const xQ = isQuant(x0), yQ = isQuant(y0);
  const horizontal = xQ && !yQ && !!y0;
  const nomCh = horizontal ? y0! : x0;
  const quantCh = horizontal ? x0! : y0!;
  if (!quantCh || !isQuant(quantCh)) throw new Error("airmark-engine: a quantitative channel (field, aggregate, or bin) is required");
  const binned = prepared[0].data.binned;
  const temporal = !binned && nomCh?.type === "temporal";
  const scatter = !binned && !temporal && !horizontal && xQ && yQ; // both quantitative
  if (temporal && prepared.some((p) => p.mark.type === "bar")) {
    throw new Error("airmark-engine: temporal-axis bars not implemented — use a nominal axis (e.g. timeUnit labels) or add a golden fixture");
  }

  const nomField = horizontal ? prepared[0].data.yField : prepared[0].data.xField;
  const quantField = horizontal ? prepared[0].data.xField! : prepared[0].data.yField!;
  const hasBars = prepared.some((p) => p.mark.type === "bar");

  // ---------- Stacking detection ----------
  const stackMode = (quantCh.stack === "zero" || quantCh.stack === "normalize") && prepared[0].data.colorField ? quantCh.stack : null;
  // ---------- Grouping detection ----------
  const offCh = asChannel(prepared[0].unit.encoding[horizontal ? "yOffset" : "xOffset"]);
  const offField = offCh?.field;

  // ---------- Domains ----------
  let qLo: number, qHi: number;
  const colorField = prepared[0].data.colorField;
  const colorDomain = shared?.colorDomain.length ? shared.colorDomain : colorField ? nominalDomain(prepared[0].data.rows, colorField, null) : [];
  let stackedSegs: Array<{ nom: unknown; color: unknown; v0: number; v1: number; datum: Row }> | null = null;

  if (stackMode) {
    // group by nominal, cumulate in colorDomain order
    const byNom = new Map<string, Row[]>();
    const order: string[] = [];
    for (const r of prepared[0].data.rows) {
      const k = String(r[nomField!]);
      if (!byNom.has(k)) { byNom.set(k, []); order.push(k); }
      byNom.get(k)!.push(r);
    }
    stackedSegs = [];
    let maxTop = 0;
    for (const k of order) {
      const g = byNom.get(k)!;
      const total = g.reduce((s, r) => s + num(r[quantField]), 0);
      let acc = 0;
      for (const cv of colorDomain) {
        const r = g.find((rr) => String(rr[colorField!]) === String(cv));
        if (!r) continue;
        let v = num(r[quantField]);
        if (stackMode === "normalize" && total > 0) v = v / total;
        stackedSegs.push({ nom: r[nomField!], color: cv, v0: acc, v1: acc + v, datum: r });
        acc += v;
      }
      maxTop = Math.max(maxTop, acc);
    }
    qLo = 0; qHi = stackMode === "normalize" ? 1 : maxTop;
  } else if (shared) {
    qLo = shared.qLo; qHi = shared.qHi;
  } else {
    qLo = Infinity; qHi = -Infinity;
    for (const p of prepared) {
      const f = horizontal ? p.data.xField : p.data.yField;
      for (const r of p.data.rows) { const v = num(r[f!]); if (Number.isFinite(v)) { qLo = Math.min(qLo, v); qHi = Math.max(qHi, v); } }
    }
    if (!Number.isFinite(qLo)) { qLo = 0; qHi = 1; }
  }

  let domainNominal = shared?.domainNominal.length
    ? shared.domainNominal
    : !binned && !temporal && !scatter && nomField && nomCh
      ? nominalDomain(prepared[0].data.rows, nomField, nomCh.sort, quantField)
      : [];
  if (nomCh?.scale?.reverse === true) domainNominal = [...domainNominal].reverse();

  // ---------- Legend reservation ----------
  const colorCh = asChannel(prepared[0].unit.encoding.color);
  const wantLegend = !opts?.suppressLegend && colorDomain.length > 0 && colorCh?.legend !== null && !!colorCh?.field;
  const legendLabelW = wantLegend ? colorDomain.reduce((m: number, v) => Math.max(m, measure(String(v), fs)), 0) : 0;
  const legendW = wantLegend ? Math.min(legendLabelW, 120) + 10 + 6 + 16 : 0;

  // ---------- Margins ----------
  const quantAxis = quantCh.axis === null ? null : (quantCh.axis ?? {});
  const nomAxis = nomCh ? (nomCh.axis === null ? null : (nomCh.axis ?? {})) : null;
  const tickLen = 4, labelGap = 4, titleGap = 8;
  const provisional = niceTicks(qLo, qHi, horizontal ? rect.w : rect.h, { includeZero: hasBars || !!stackMode || quantCh.scale?.zero === true, nice: quantCh.scale?.nice !== false, tickCount: quantAxis?.tickCount, domain: quantCh.scale?.domain });
  const qFmt = quantAxis?.format ?? (stackMode === "normalize" ? { type: "percent", maximumFractionDigits: 0 } : undefined);
  const qLabels = provisional.ticks.map((t) => formatValue(stackMode === "normalize" ? t * 100 : t, qFmt, provisional.step * (stackMode === "normalize" ? 100 : 1)));
  const maxQLabelW = qLabels.reduce((m, l) => Math.max(m, measure(l, fs)), 0);
  const nomLabels = domainNominal.map(String);
  const maxNomLabelW = nomLabels.reduce((m, l) => Math.max(m, measure(l, fs)), 0);
  const quantTitle = quantCh.title ?? quantAxis?.title ?? undefined;
  const nomTitle = nomCh ? (nomCh.title ?? nomAxis?.title ?? undefined) : undefined;

  const validateAxisOrient = (orient: string | undefined, channel: string, supported: string[]) => {
    if (!orient) return;
    if (!["left", "right", "bottom", "top"].includes(orient)) {
      throw new Error(`airmark-engine: axis orient '${orient}' invalid`);
    }
    if (!supported.includes(orient)) {
      throw new Error(`airmark-engine: axis orient '${orient}' not implemented for the ${channel} channel in this chart orientation — add a golden fixture`);
    }
  };
  validateAxisOrient(nomAxis?.orient, "nominal", horizontal ? ["left", "right"] : ["bottom"]);
  validateAxisOrient(quantAxis?.orient, "quantitative", horizontal ? ["bottom"] : ["left"]);
  const nomOrientRight = horizontal && nomAxis?.orient === "right";
  const mTop = Math.ceil(textHeight(fs) / 2) + 2;
  let mRight = Math.ceil(Math.min(maxQLabelW, 60) / 2) + 4 + legendW;
  let mLeft: number, mBottom: number;
  if (horizontal) {
    const nomSide = (nomAxis !== null ? Math.min(maxNomLabelW, 140) + tickLen + labelGap : 0) + (nomTitle ? textHeight(fs) + titleGap : 0) + 4;
    if (nomOrientRight) { mLeft = 6; mRight += nomSide; } else { mLeft = nomSide; }
    mBottom = (quantAxis !== null ? textHeight(fs) + tickLen + labelGap : 0) + (quantTitle ? textHeight(fs) + titleGap : 0) + 4;
  } else {
    mLeft = (quantAxis !== null ? Math.min(maxQLabelW, 80) + tickLen + labelGap : 0) + (quantTitle ? textHeight(fs) + titleGap : 0) + 4;
    const angled = nomAxis?.labelAngle ? Math.abs(nomAxis.labelAngle) > 0 : false;
    const nomLabelH = nomAxis !== null ? (angled ? Math.min(maxNomLabelW, 90) * 0.85 : textHeight(fs)) : (temporal || scatter ? textHeight(fs) + tickLen + labelGap : 0);
    mBottom = nomLabelH + (nomAxis !== null ? tickLen + labelGap : 0) + (nomTitle ? textHeight(fs) + titleGap : 0) + 4;
  }
  const plot: Rect = { x: r2(rect.x + mLeft), y: r2(rect.y + mTop), w: r2(Math.max(10, rect.w - mLeft - mRight)), h: r2(Math.max(10, rect.h - mTop - mBottom)) };

  // ---------- Scales (deny-by-default on scale.type) ----------
  const checkScaleType = (c: Channel | undefined, allowLog: boolean): "linear" | "log" => {
    const t = c?.scale?.type;
    if (t === undefined || t === "linear") return "linear";
    if (t === "log" && allowLog) {
      if (hasBars || stackMode) throw new Error("airmark-engine: log scale with bar/stacked marks not supported (bars need a meaningful zero)");
      return "log";
    }
    throw new Error(`airmark-engine: scale type '${t}' not implemented — add a golden fixture (supported: linear, log for point/line axes)`);
  };
  const qType = checkScaleType(quantCh, true);
  const qTicksLinear = niceTicks(qLo, qHi, horizontal ? plot.w : plot.h, { includeZero: hasBars || !!stackMode || quantCh.scale?.zero === true, nice: quantCh.scale?.nice !== false, tickCount: quantAxis?.tickCount, domain: quantCh.scale?.domain });
  const qRev = quantCh.scale?.reverse === true;
  const qRange: [number, number] = horizontal
    ? (qRev ? [plot.x + plot.w, plot.x] : [plot.x, plot.x + plot.w])
    : (qRev ? [plot.y, plot.y + plot.h] : [plot.y + plot.h, plot.y]);
  const qDom = quantCh.scale?.domain;
  const [qdLo, qdHi] = qDom && qDom.length === 2 && typeof qDom[0] === "number" && typeof qDom[1] === "number" ? [qDom[0] as number, qDom[1] as number] : [qLo, qHi];
  const qLog: LogScale | null = qType === "log" ? logScale(qdLo, qdHi, qRange, quantCh.scale?.nice !== false && !qDom) : null;
  const qTicks = qLog ? { niceMin: qLog.domain[0], niceMax: qLog.domain[1], step: qLog.domain[0], ticks: qLog.ticks } : qTicksLinear;
  const qScaleLin: LinearScale = linearScale(qTicksLinear, qRange);
  const qScale = qLog ? { ...qScaleLin, scale: qLog.scale } : qScaleLin;
  const nScale: BandScale | null = !binned && !temporal && domainNominal.length ? bandScale(domainNominal, horizontal ? plot.y : plot.x, horizontal ? plot.h : plot.w) : null;
  const offScale: BandScale | null = offField && nScale ? bandScale(nominalDomain(prepared[0].data.rows, offField, null), 0, nScale.bandwidth, 0.1, 0.05) : null;

  let binScale: LinearScale | null = null;
  if (binned) {
    let bLo = Infinity, bHi = -Infinity;
    for (const r of prepared[0].data.rows) { bLo = Math.min(bLo, num(r.__bin0)); bHi = Math.max(bHi, num(r.__bin1)); }
    const bt = niceTicks(bLo, bHi, plot.w, {});
    binScale = linearScale({ ...bt, niceMin: bLo, niceMax: bHi }, [plot.x, plot.x + plot.w]);
  }
  let xLin: LinearScale | null = null;
  if (scatter) {
    let xLo = Infinity, xHi = -Infinity;
    for (const p of prepared) {
      const f = p.data.xField!;
      for (const r of p.data.rows) { const v = num(r[f]); if (Number.isFinite(v)) { xLo = Math.min(xLo, v); xHi = Math.max(xHi, v); } }
    }
    if (!Number.isFinite(xLo)) { xLo = 0; xHi = 1; }
    const xType = checkScaleType(x0, true);
    const xRange: [number, number] = x0?.scale?.reverse === true ? [plot.x + plot.w, plot.x] : [plot.x, plot.x + plot.w];
    if (xType === "log") {
      const lg = logScale(xLo, xHi, xRange, x0?.scale?.nice !== false);
      xLin = { kind: "linear", domain: lg.domain, range: lg.range, scale: lg.scale,
               ticksInfo: { niceMin: lg.domain[0], niceMax: lg.domain[1], step: lg.domain[0], ticks: lg.ticks } };
    } else {
      const xt = niceTicks(xLo, xHi, plot.w, { includeZero: x0?.scale?.zero === true, nice: x0?.scale?.nice !== false, tickCount: (x0?.axis && x0.axis !== null ? x0.axis.tickCount : undefined), domain: x0?.scale?.domain });
      xLin = linearScale(xt, xRange);
    }
  }
  let tScale: { scale: (v: number) => number; ticks: number[]; labels: string[] } | null = null;
  if (temporal) {
    let tLo = Infinity, tHi = -Infinity;
    for (const p of prepared) {
      const f = horizontal ? p.data.yField! : p.data.xField!;
      for (const r of p.data.rows) { const t = parseTemporal(r[f]); tLo = Math.min(tLo, t); tHi = Math.max(tHi, t); }
    }
    const pad = (tHi - tLo) * 0.02 || 1;
    tLo -= pad; tHi += pad;
    const tt = timeTicks(tLo, tHi, plot.w);
    const k = (plot.w) / (tHi - tLo);
    tScale = { scale: (v) => plot.x + (v - tLo) * k, ticks: tt.ticks, labels: tt.labels };
  }

  // ---------- Color resolution ----------
  if (colorCh?.scale?.scheme) throw new Error("airmark-engine: color scale.scheme not implemented — use scale.range or the theme palette");
  const colorRange = colorCh?.scale?.range ?? theme.palette;
  const paletteFor = (v: unknown): string => {
    const i = colorDomain.findIndex((d) => String(d) === String(v));
    return i < 0 ? theme.hue : colorRange[i % colorRange.length];
  };
  const selected = (sel: string | undefined, datum: Row): boolean | null => {
    if (!sel) return null;
    const state = ctx.selectionState?.[sel];
    if (!state || state.length === 0) return null;
    return state.some((s) => Object.entries(s).every(([k, v]) => datum[k] === v));
  };
  const resolveFill = (mark: MarkDef, datum: Row): string => {
    if (colorCh?.condition) {
      const isSel = selected(colorCh.condition.selection, datum);
      if (isSel === null || isSel) {
        if (colorCh.condition.field) return paletteFor(datum[colorCh.condition.field]);
        if (typeof colorCh.condition.value === "string") return colorCh.condition.value;
      }
      if (typeof colorCh.value === "string") return colorCh.value;
    }
    if (mark.color) return mark.color;
    if (colorField) return paletteFor(datum[colorField]);
    if (typeof colorCh?.value === "string") return colorCh.value;
    return theme.hue;
  };

  // ---------- Grid ----------
  if (quantAxis && quantAxis.grid) {
    for (const t of qTicks.ticks) {
      const p = r2(qScale.scale(t));
      push(horizontal
        ? { type: "line", x1: p, y1: plot.y, x2: p, y2: r2(plot.y + plot.h), stroke: theme.gridColor, strokeWidth: 1, meta: { role: "grid" } }
        : { type: "line", x1: plot.x, y1: p, x2: r2(plot.x + plot.w), y2: p, stroke: theme.gridColor, strokeWidth: 1, meta: { role: "grid" } });
    }
  }

  // ---------- Marks ----------
  const zeroV = Math.max(qTicks.niceMin, Math.min(0, qTicks.niceMax));
  const zero = r2(qScale.scale(zeroV < 0 ? 0 : Math.max(0, qTicks.niceMin)));

  // Stacked bars replace the per-layer bar path
  if (stackedSegs && nScale) {
    const mark = prepared[0].mark;
    for (const s of stackedSegs) {
      const np = r2(nScale.position(s.nom));
      const bw = r2(nScale.bandwidth);
      const p0 = r2(qScale.scale(s.v0)), p1 = r2(qScale.scale(s.v1));
      const fill = paletteFor(s.color);
      push(horizontal
        ? { type: "rect", x: Math.min(p0, p1), y: np, width: r2(Math.abs(p1 - p0)), height: bw, fill, ...(mark.opacity !== undefined ? { opacity: mark.opacity } : {}), meta: { role: "mark", datum: s.datum } }
        : { type: "rect", x: np, y: Math.min(p0, p1), width: bw, height: r2(Math.abs(p1 - p0)), fill, ...(mark.opacity !== undefined ? { opacity: mark.opacity } : {}), meta: { role: "mark", datum: s.datum } });
    }
  }

  for (const p of prepared) {
    if (stackedSegs && p.mark.type === "bar") continue; // handled above
    const enc = p.unit.encoding;
    const qF = horizontal ? p.data.xField! : p.data.yField!;
    const nF = horizontal ? p.data.yField : p.data.xField;
    const selMeta = p.unit.selections?.[0]?.id;
    const selFields = p.unit.selections?.[0]?.fields;
    const meta = (datum: Row): Meta => ({ role: "mark", datum, ...(selMeta ? { selection: selMeta, fields: selFields } : {}) });
    const nomPos = (r: Row): number => {
      if (scatter && xLin && nF) return xLin.scale(num(r[nF]));
      if (temporal && tScale && nF) return tScale.scale(parseTemporal(r[nF]));
      if (binScale) return binScale.scale((num(r.__bin0) + num(r.__bin1)) / 2);
      return nScale && nF ? nScale.center(r[nF]) : 0;
    };

    switch (p.mark.type) {
      case "bar": {
        for (const rrow of p.data.rows) {
          const qp = r2(qScale.scale(num(rrow[qF])));
          const fill = resolveFill(p.mark, rrow);
          const rx = p.mark.cornerRadiusEnd ?? p.mark.cornerRadius;
          const common = { fill, ...(p.mark.opacity !== undefined ? { opacity: p.mark.opacity } : {}), ...(rx !== undefined ? { rx } : {}), meta: meta(rrow) };
          if (binned && binScale) {
            const x0p = r2(binScale.scale(num(rrow.__bin0))), x1p = r2(binScale.scale(num(rrow.__bin1)));
            push({ type: "rect", x: x0p, y: Math.min(qp, zero), width: r2(Math.max(0, x1p - x0p - 1)), height: r2(Math.abs(zero - qp)), ...common });
          } else if (nScale && nF) {
            let np = nScale.position(rrow[nF]);
            let bw = nScale.bandwidth;
            if (offScale && offField) { np += offScale.position(rrow[offField]); bw = offScale.bandwidth; }
            np = r2(np); bw = r2(bw);
            push(horizontal
              ? { type: "rect", x: Math.min(qp, zero), y: np, width: r2(Math.abs(qp - zero)), height: bw, ...common }
              : { type: "rect", x: np, y: Math.min(qp, zero), width: bw, height: r2(Math.abs(zero - qp)), ...common });
          }
        }
        break;
      }
      case "line": case "area": {
        // multi-series: split by color field, one path per series in colorDomain order
        const seriesKeys = colorField && p.data.colorField ? colorDomain : [null];
        for (const sk of seriesKeys) {
          const rows = sk === null ? p.data.rows : p.data.rows.filter((r) => String(r[colorField!]) === String(sk));
          if (!rows.length) continue;
          const pts = rows.map((rrow) => {
            const qp = qScale.scale(num(rrow[qF]));
            const np = nomPos(rrow);
            return horizontal ? { x: qp, y: np, row: rrow } : { x: np, y: qp, row: rrow };
          });
          const d = pts.map((pt, i) => `${i === 0 ? "M" : "L"}${r2(pt.x)},${r2(pt.y)}`).join("");
          const stroke = sk === null ? resolveFill(p.mark, rows[0]) : paletteFor(sk);
          if (p.mark.type === "area") {
            const base = horizontal ? `L${zero},${r2(pts[pts.length - 1].y)}L${zero},${r2(pts[0].y)}Z` : `L${r2(pts[pts.length - 1].x)},${zero}L${r2(pts[0].x)},${zero}Z`;
            push({ type: "path", d: d + base, fill: stroke, opacity: p.mark.opacity ?? 0.25, meta: { role: "mark" } });
          }
          push({ type: "path", d, stroke, strokeWidth: p.mark.strokeWidth ?? 2, meta: { role: "mark" } });
          if (p.mark.point) for (const pt of pts) push({ type: "circle", cx: r2(pt.x), cy: r2(pt.y), r: 3, fill: stroke, meta: meta(pt.row) });
        }
        break;
      }
      case "point": case "circle": case "square": case "tick": {
        const sizeCh = asChannel(enc.size);
        let sLo = 0, sHi = 1;
        if (sizeCh?.field) {
          sLo = Infinity; sHi = -Infinity;
          for (const rrow of p.data.rows) { const v = num(rrow[sizeCh.field]); if (Number.isFinite(v)) { sLo = Math.min(sLo, v); sHi = Math.max(sHi, v); } }
          if (!Number.isFinite(sLo) || sLo === sHi) { sLo = 0; sHi = 1; }
        }
        const R_MIN = 2, R_MAX = 12; // normative: area-linear in the size field
        const radius = (rrow: Row): number => {
          if (sizeCh?.field) {
            const t = (num(rrow[sizeCh.field]) - sLo) / (sHi - sLo);
            return r2(Math.sqrt(R_MIN * R_MIN + t * (R_MAX * R_MAX - R_MIN * R_MIN)));
          }
          return p.mark.size ? r2(Math.sqrt(p.mark.size)) : 3.5;
        };
        if (p.mark.type === "tick") {
          const half = 6;
          for (const rrow of p.data.rows) {
            const qp = r2(qScale.scale(num(rrow[qF])));
            const np = r2(nomPos(rrow));
            push(horizontal || scatter
              ? { type: "line", x1: nF && (scatter || horizontal) ? (horizontal ? qp : np) : np, y1: r2((horizontal ? np : qp) - half), x2: nF && (scatter || horizontal) ? (horizontal ? qp : np) : np, y2: r2((horizontal ? np : qp) + half), stroke: resolveFill(p.mark, rrow), strokeWidth: 2, ...(p.mark.opacity !== undefined ? { opacity: p.mark.opacity } : {}), meta: meta(rrow) }
              : { type: "line", x1: r2(np - half), y1: qp, x2: r2(np + half), y2: qp, stroke: resolveFill(p.mark, rrow), strokeWidth: 2, ...(p.mark.opacity !== undefined ? { opacity: p.mark.opacity } : {}), meta: meta(rrow) });
          }
          break;
        }
        for (const rrow of p.data.rows) {
          const qp = qScale.scale(num(rrow[qF]));
          const np = nomPos(rrow);
          push({ type: "circle", cx: r2(horizontal ? qp : np), cy: r2(horizontal ? np : qp), r: radius(rrow), fill: resolveFill(p.mark, rrow), ...(p.mark.opacity !== undefined ? { opacity: p.mark.opacity } : {}), meta: meta(rrow) });
        }
        break;
      }
      case "rule": {
        for (const rrow of p.data.rows) {
          const qp = r2(qScale.scale(num(rrow[qF])));
          push(horizontal
            ? { type: "line", x1: qp, y1: plot.y, x2: qp, y2: r2(plot.y + plot.h), stroke: resolveFill(p.mark, rrow), strokeWidth: p.mark.strokeWidth ?? 1.5, meta: meta(rrow) }
            : { type: "line", x1: plot.x, y1: qp, x2: r2(plot.x + plot.w), y2: qp, stroke: resolveFill(p.mark, rrow), strokeWidth: p.mark.strokeWidth ?? 1.5, meta: meta(rrow) });
        }
        break;
      }
      case "text": {
        const textCh = asChannel(enc.text);
        for (const rrow of p.data.rows) {
          const qp = qScale.scale(num(rrow[qF]));
          const np = nomPos(rrow);
          const content = String(textCh?.field !== undefined ? rrow[textCh.field] : textCh?.value ?? "");
          const fill = p.mark.color ?? theme.labelColor;
          const pad = 6;
          const node: TextNode = horizontal
            ? { type: "text", x: r2(qp - pad), y: r2(np + textHeight(fs) / 2 - fs * 0.25), content: truncateToFit(content, Math.abs(qp - zero) - pad * 2, fs, measure), fill, fontSize: fs, anchor: "end", meta: meta(rrow) }
            : { type: "text", x: r2(np), y: r2(qp - 4), content, fill, fontSize: fs, anchor: "middle", meta: meta(rrow) };
          if (node.content.length) push(node);
        }
        break;
      }
      case "boxplot": {
        if (!nScale || !nF) throw new Error("airmark-engine: boxplot requires a nominal positional channel");
        // group RAW rows by category; stats computed in-engine (SCENEGRAPH.md §6.5)
        const byCat = new Map<string, number[]>();
        for (const rrow of p.data.rows) {
          const k = String(rrow[nF]);
          const v = num(rrow[qF]);
          if (Number.isFinite(v)) byCat.set(k, [...(byCat.get(k) ?? []), v]);
        }
        const boxFrac = 0.7;
        for (const cat of domainNominal) {
          const vals = byCat.get(String(cat));
          if (!vals?.length) continue;
          const st = boxStats(vals);
          const center = r2(nScale.center(cat));
          const bw = nScale.bandwidth * boxFrac;
          const half = r2(bw / 2);
          const capHalf = r2(bw / 4);
          const fill = resolveFill(p.mark, { [nF]: cat });
          const stroke = theme.axisColor;
          const P = (v: number) => r2(qScale.scale(v));
          const dMeta: Meta = { role: "mark", datum: { [nF]: cat, q1: r2(st.q1), median: r2(st.median), q3: r2(st.q3), whiskerLo: r2(st.whiskerLo), whiskerHi: r2(st.whiskerHi) } };
          if (horizontal) {
            push({ type: "line", x1: P(st.whiskerLo), y1: center, x2: P(st.q1), y2: center, stroke, strokeWidth: 1, meta: dMeta });
            push({ type: "line", x1: P(st.q3), y1: center, x2: P(st.whiskerHi), y2: center, stroke, strokeWidth: 1, meta: dMeta });
            push({ type: "line", x1: P(st.whiskerLo), y1: r2(center - capHalf), x2: P(st.whiskerLo), y2: r2(center + capHalf), stroke, strokeWidth: 1, meta: dMeta });
            push({ type: "line", x1: P(st.whiskerHi), y1: r2(center - capHalf), x2: P(st.whiskerHi), y2: r2(center + capHalf), stroke, strokeWidth: 1, meta: dMeta });
            push({ type: "rect", x: Math.min(P(st.q1), P(st.q3)), y: r2(center - half), width: r2(Math.abs(P(st.q3) - P(st.q1))), height: r2(bw), fill, stroke, strokeWidth: 1, ...(p.mark.opacity !== undefined ? { opacity: p.mark.opacity } : {}), meta: dMeta });
            push({ type: "line", x1: P(st.median), y1: r2(center - half), x2: P(st.median), y2: r2(center + half), stroke: "#FFFFFF", strokeWidth: 2, meta: dMeta });
            for (const o of st.outliers) push({ type: "circle", cx: P(o), cy: center, r: 2.5, fill, opacity: 0.7, meta: { role: "mark", datum: { [nF]: cat, value: o, outlier: true } } });
          } else {
            push({ type: "line", x1: center, y1: P(st.whiskerLo), x2: center, y2: P(st.q1), stroke, strokeWidth: 1, meta: dMeta });
            push({ type: "line", x1: center, y1: P(st.q3), x2: center, y2: P(st.whiskerHi), stroke, strokeWidth: 1, meta: dMeta });
            push({ type: "line", x1: r2(center - capHalf), y1: P(st.whiskerLo), x2: r2(center + capHalf), y2: P(st.whiskerLo), stroke, strokeWidth: 1, meta: dMeta });
            push({ type: "line", x1: r2(center - capHalf), y1: P(st.whiskerHi), x2: r2(center + capHalf), y2: P(st.whiskerHi), stroke, strokeWidth: 1, meta: dMeta });
            push({ type: "rect", x: r2(center - half), y: Math.min(P(st.q1), P(st.q3)), width: r2(bw), height: r2(Math.abs(P(st.q1) - P(st.q3))), fill, stroke, strokeWidth: 1, ...(p.mark.opacity !== undefined ? { opacity: p.mark.opacity } : {}), meta: dMeta });
            push({ type: "line", x1: r2(center - half), y1: P(st.median), x2: r2(center + half), y2: P(st.median), stroke: "#FFFFFF", strokeWidth: 2, meta: dMeta });
            for (const o of st.outliers) push({ type: "circle", cx: center, cy: P(o), r: 2.5, fill, opacity: 0.7, meta: { role: "mark", datum: { [nF]: cat, value: o, outlier: true } } });
          }
        }
        break;
      }
      default:
        throw new Error(`airmark-engine: unsupported mark type '${p.mark.type}'`);
    }
  }

  // ---------- Axes ----------
  const axisText = (x: number, y: number, content: string, anchor: TextNode["anchor"], extra?: Partial<TextNode>): TextNode =>
    ({ type: "text", x: r2(x), y: r2(y), content, fill: theme.labelColor, fontSize: fs, anchor, meta: { role: "label" }, ...extra });

  if (quantAxis) {
    push(horizontal
      ? { type: "line", x1: plot.x, y1: r2(plot.y + plot.h), x2: r2(plot.x + plot.w), y2: r2(plot.y + plot.h), stroke: theme.axisColor, strokeWidth: 1, meta: { role: "axis" } }
      : { type: "line", x1: plot.x, y1: plot.y, x2: plot.x, y2: r2(plot.y + plot.h), stroke: theme.axisColor, strokeWidth: 1, meta: { role: "axis" } });
    for (let i = 0; i < qTicks.ticks.length; i++) {
      const t = qTicks.ticks[i];
      const p = r2(qScale.scale(t));
      const label = formatValue(stackMode === "normalize" ? t * 100 : t, qFmt, (qLog ? t : qTicks.step) * (stackMode === "normalize" ? 100 : 1));
      if (horizontal) {
        push({ type: "line", x1: p, y1: r2(plot.y + plot.h), x2: p, y2: r2(plot.y + plot.h + tickLen), stroke: theme.axisColor, strokeWidth: 1, meta: { role: "axis" } });
        push(axisText(p, plot.y + plot.h + tickLen + labelGap + fs * 0.8, label, "middle"));
      } else {
        push({ type: "line", x1: r2(plot.x - tickLen), y1: p, x2: plot.x, y2: p, stroke: theme.axisColor, strokeWidth: 1, meta: { role: "axis" } });
        push(axisText(plot.x - tickLen - labelGap, p + fs * 0.35, label, "end"));
      }
    }
    if (quantTitle) {
      push(horizontal
        ? axisText(plot.x + plot.w / 2, rect.y + rect.h - 4, String(quantTitle), "middle", { meta: { role: "title" } })
        : axisText(0, 0, String(quantTitle), "middle", { angle: -90, x: r2(rect.x + textHeight(fs) - 2), y: r2(plot.y + plot.h / 2), meta: { role: "title" } }));
    }
  }
  if (nomAxis && nScale) {
    const edgeX = nomOrientRight ? r2(plot.x + plot.w) : plot.x;
    push(horizontal
      ? { type: "line", x1: edgeX, y1: plot.y, x2: edgeX, y2: r2(plot.y + plot.h), stroke: theme.axisColor, strokeWidth: 1, meta: { role: "axis" } }
      : { type: "line", x1: plot.x, y1: r2(plot.y + plot.h), x2: r2(plot.x + plot.w), y2: r2(plot.y + plot.h), stroke: theme.axisColor, strokeWidth: 1, meta: { role: "axis" } });
    const angle = nomAxis.labelAngle ?? 0;
    for (const v of domainNominal) {
      const c = r2(nScale.center(v));
      const label = truncateToFit(String(v), nomAxis.labelLimit ?? 140, fs, measure);
      if (horizontal) {
        if (nomOrientRight) {
          push({ type: "line", x1: edgeX, y1: c, x2: r2(edgeX + tickLen), y2: c, stroke: theme.axisColor, strokeWidth: 1, meta: { role: "axis" } });
          push(axisText(edgeX + tickLen + labelGap, c + fs * 0.35, label, "start"));
        } else {
          push({ type: "line", x1: r2(plot.x - tickLen), y1: c, x2: plot.x, y2: c, stroke: theme.axisColor, strokeWidth: 1, meta: { role: "axis" } });
          push(axisText(plot.x - tickLen - labelGap, c + fs * 0.35, label, "end"));
        }
      } else {
        push({ type: "line", x1: c, y1: r2(plot.y + plot.h), x2: c, y2: r2(plot.y + plot.h + tickLen), stroke: theme.axisColor, strokeWidth: 1, meta: { role: "axis" } });
        push(angle
          ? axisText(c, plot.y + plot.h + tickLen + labelGap + fs * 0.8, label, "end", { angle })
          : axisText(c, plot.y + plot.h + tickLen + labelGap + fs * 0.8, label, "middle"));
      }
    }
    if (nomTitle) {
      push(horizontal
        ? axisText(0, 0, String(nomTitle), "middle", { angle: nomOrientRight ? 90 : -90, x: r2(nomOrientRight ? rect.x + rect.w - textHeight(fs) + 2 : rect.x + textHeight(fs) - 2), y: r2(plot.y + plot.h / 2), meta: { role: "title" } })
        : axisText(plot.x + plot.w / 2, rect.y + rect.h - 4, String(nomTitle), "middle", { meta: { role: "title" } }));
    }
  }
  if (temporal && tScale && nomAxis !== null) {
    push({ type: "line", x1: plot.x, y1: r2(plot.y + plot.h), x2: r2(plot.x + plot.w), y2: r2(plot.y + plot.h), stroke: theme.axisColor, strokeWidth: 1, meta: { role: "axis" } });
    tScale.ticks.forEach((t, i) => {
      const p = r2(tScale!.scale(t));
      push({ type: "line", x1: p, y1: r2(plot.y + plot.h), x2: p, y2: r2(plot.y + plot.h + tickLen), stroke: theme.axisColor, strokeWidth: 1, meta: { role: "axis" } });
      push(axisText(p, plot.y + plot.h + tickLen + labelGap + fs * 0.8, tScale!.labels[i], "middle"));
    });
    if (nomTitle) push(axisText(plot.x + plot.w / 2, rect.y + rect.h - 4, String(nomTitle), "middle", { meta: { role: "title" } }));
  }
  if (scatter && xLin && x0?.axis !== null) {
    const xAxisCfg = x0?.axis ?? {};
    push({ type: "line", x1: plot.x, y1: r2(plot.y + plot.h), x2: r2(plot.x + plot.w), y2: r2(plot.y + plot.h), stroke: theme.axisColor, strokeWidth: 1, meta: { role: "axis" } });
    for (const t of xLin.ticksInfo.ticks) {
      const p = r2(xLin.scale(t));
      push({ type: "line", x1: p, y1: r2(plot.y + plot.h), x2: p, y2: r2(plot.y + plot.h + tickLen), stroke: theme.axisColor, strokeWidth: 1, meta: { role: "axis" } });
      push(axisText(p, plot.y + plot.h + tickLen + labelGap + fs * 0.8, formatValue(t, xAxisCfg.format, x0?.scale?.type === "log" ? t : xLin.ticksInfo.step), "middle"));
    }
    const xt = x0?.title ?? xAxisCfg.title;
    if (xt) push(axisText(plot.x + plot.w / 2, rect.y + rect.h - 4, String(xt), "middle", { meta: { role: "title" } }));
  }
  if (binned && binScale && (x0?.axis !== null)) {
    push({ type: "line", x1: plot.x, y1: r2(plot.y + plot.h), x2: r2(plot.x + plot.w), y2: r2(plot.y + plot.h), stroke: theme.axisColor, strokeWidth: 1, meta: { role: "axis" } });
    for (const t of binScale.ticksInfo.ticks.filter((t) => t >= binScale!.domain[0] - 1e-9 && t <= binScale!.domain[1] + 1e-9)) {
      const p = r2(binScale.scale(t));
      push({ type: "line", x1: p, y1: r2(plot.y + plot.h), x2: p, y2: r2(plot.y + plot.h + tickLen), stroke: theme.axisColor, strokeWidth: 1, meta: { role: "axis" } });
      push(axisText(p, plot.y + plot.h + tickLen + labelGap + fs * 0.8, formatTick(t, binScale.ticksInfo.step), "middle"));
    }
    const xt = x0?.title ?? (x0?.axis as { title?: string } | undefined)?.title;
    if (xt) push(axisText(plot.x + plot.w / 2, rect.y + rect.h - 4, String(xt), "middle", { meta: { role: "title" } }));
  }

  // ---------- Legend (SCENEGRAPH.md §6: right side, swatch 10px, row height fs*1.6) ----------
  if (wantLegend) {
    const lx = r2(plot.x + plot.w + 16);
    const rowH = fs * 1.6;
    colorDomain.forEach((v, i) => {
      const ly = r2(plot.y + i * rowH);
      push({ type: "rect", x: lx, y: ly, width: 10, height: 10, fill: paletteFor(v), rx: 2, meta: { role: "label" } });
      push({ type: "text", x: r2(lx + 16), y: r2(ly + fs * 0.85), content: truncateToFit(String(v), 120, fs, measure), fill: theme.labelColor, fontSize: fs, anchor: "start", meta: { role: "label" } });
    });
  }

  return { nodes, plot: { x: plot.x, y: plot.y, w: plot.w, h: plot.h } };
}

// ---------- Arc / pie (SCENEGRAPH.md §2: 4° polyline approximation) ----------
function layoutArc(p: Prepared, rect: Rect, ctx: Ctx, opts?: { suppressLegend?: boolean }): SceneNode[] {
  const { theme, measure } = ctx;
  const fs = theme.fontSize;
  const nodes: SceneNode[] = [];
  const thetaCh = asChannel(p.unit.encoding.theta);
  const colorCh = asChannel(p.unit.encoding.color);
  if (!thetaCh?.field) throw new Error("airmark-engine: arc mark requires a theta channel with a field");
  const colorField = colorCh?.field;
  const colorDomain = colorField ? nominalDomain(p.data.rows, colorField, null) : [];
  if (colorCh?.scale?.scheme) throw new Error("airmark-engine: color scale.scheme not implemented — use scale.range or the theme palette");
  const arcRange = colorCh?.scale?.range ?? theme.palette;
  const paletteFor = (v: unknown): string => arcRange[colorDomain.findIndex((d) => String(d) === String(v)) % arcRange.length] ?? theme.hue;

  const wantLegend = !opts?.suppressLegend && colorDomain.length > 0 && colorCh?.legend !== null;
  const legendLabelW = wantLegend ? colorDomain.reduce((m: number, v) => Math.max(m, measure(String(v), fs)), 0) : 0;
  const legendW = wantLegend ? Math.min(legendLabelW, 120) + 10 + 6 + 16 : 0;

  const cx = r2(rect.x + (rect.w - legendW) / 2);
  const cy = r2(rect.y + rect.h / 2);
  const rOuter = p.mark.outerRadius ?? Math.max(10, Math.min(rect.w - legendW, rect.h) / 2 - 8);
  const rInner = p.mark.innerRadius ?? 0;

  const total = p.data.rows.reduce((s, r) => s + num(r[thetaCh.field!]), 0);
  let a = 0;
  const selMeta = p.unit.selections?.[0]?.id;
  const selFields = p.unit.selections?.[0]?.fields;
  for (const rrow of p.data.rows) {
    const frac = total > 0 ? num(rrow[thetaCh.field!]) / total : 0;
    const a1 = a + frac * Math.PI * 2;
    nodes.push({ type: "path", d: arcPath(cx, cy, rInner, rOuter, a, a1), fill: p.mark.color ?? (colorField ? paletteFor(rrow[colorField]) : theme.hue), ...(p.mark.opacity !== undefined ? { opacity: p.mark.opacity } : {}), meta: { role: "mark", datum: rrow, ...(selMeta ? { selection: selMeta, fields: selFields } : {}) } });
    a = a1;
  }
  if (wantLegend) {
    const lx = r2(rect.x + rect.w - legendW + 16);
    const rowH = fs * 1.6;
    colorDomain.forEach((v, i) => {
      const ly = r2(rect.y + 8 + i * rowH);
      nodes.push({ type: "rect", x: lx, y: ly, width: 10, height: 10, fill: paletteFor(v), rx: 2, meta: { role: "label" } });
      nodes.push({ type: "text", x: r2(lx + 16), y: r2(ly + fs * 0.85), content: truncateToFit(String(v), 120, fs, measure), fill: theme.labelColor, fontSize: fs, anchor: "start", meta: { role: "label" } });
    });
  }
  return nodes;
}

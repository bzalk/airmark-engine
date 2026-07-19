// packages/engine/src/layout.ts
// The layout pipeline: validated graphic + rows + size -> SceneGraph.
// Implements SCENEGRAPH.md §6 obligations. Pure and deterministic.

import {
  BandScale, Channel, DEFAULT_THEME, Encoding, Graphic, LayoutInput, LinearScale,
  MarkDef, Meta, Row, SceneGraph, SceneNode, TextNode, Theme, UnitGraphic,
  bandScale, clamp, defaultMeasureText, formatTick, formatValue, linearScale,
  niceTicks, r2, textHeight, truncateToFit,
} from "./core.js";
import { applyTransforms, nominalDomain, resolveLayerData, ResolvedLayerData } from "./transform.js";

const asChannel = (c: Channel | Channel[] | undefined): Channel | undefined => (Array.isArray(c) ? c[0] : c);
const markDef = (m: UnitGraphic["mark"]): MarkDef => (typeof m === "string" ? { type: m } : m);
const isQuant = (c?: Channel) => c?.type === "quantitative" || c?.type === "temporal" || !!c?.aggregate || !!c?.bin;
const num = (v: unknown): number => (typeof v === "number" ? v : Number(v));

type Prepared = { unit: UnitGraphic; mark: MarkDef; data: ResolvedLayerData };

export function layout(input: LayoutInput): SceneGraph {
  const theme: Theme = { ...DEFAULT_THEME, ...(input.theme ?? {}) };
  const measure = input.measureText ?? defaultMeasureText;
  const W = input.width, H = input.height;
  const units: UnitGraphic[] = "layers" in input.graphic ? input.graphic.layers : [input.graphic];
  if (units.length === 0) throw new Error("airmark-engine: graphic has no layers");

  // ---- 1. Per-layer data resolution (transforms, aggregation, binning) ----
  const prepared: Prepared[] = units.map((unit) => {
    const rows = applyTransforms(input.rows, unit.transform);
    return { unit, mark: markDef(unit.mark), data: resolveLayerData(rows, unit.encoding, W) };
  });

  // ---- 2. Orientation from the first layer (all layers share scales) ----
  const x0 = asChannel(prepared[0].unit.encoding.x);
  const y0 = asChannel(prepared[0].unit.encoding.y);
  if (!x0 && !y0) throw new Error("airmark-engine: encoding needs an x or y channel");
  const xQ = isQuant(x0), yQ = isQuant(y0);
  // horizontal = quantitative x against nominal y
  const horizontal = xQ && !yQ && !!y0;
  const nomCh = horizontal ? y0! : x0;              // may be undefined for pure-quant charts (not yet supported)
  const quantCh = horizontal ? x0! : y0!;
  if (!quantCh) throw new Error("airmark-engine: a quantitative channel (field, aggregate, or bin) is required");
  const binned = prepared[0].data.binned;

  // ---- 3. Shared domains across layers ----
  const nomField = horizontal ? prepared[0].data.yField : prepared[0].data.xField;
  const quantField = horizontal ? prepared[0].data.xField! : prepared[0].data.yField!;
  const hasBars = prepared.some((p) => p.mark.type === "bar");
  let qLo = Infinity, qHi = -Infinity;
  for (const p of prepared) {
    const f = horizontal ? p.data.xField : p.data.yField;
    for (const r of p.data.rows) {
      const v = num(r[f!]);
      if (Number.isFinite(v)) { qLo = Math.min(qLo, v); qHi = Math.max(qHi, v); }
    }
    if (p.data.binned) {
      for (const r of p.data.rows) { /* x extent for binned handled below */ }
    }
  }
  if (!Number.isFinite(qLo)) { qLo = 0; qHi = 1; }

  const domainNominal = !binned && nomField && nomCh
    ? nominalDomain(prepared[0].data.rows, nomField, nomCh.sort, quantField)
    : [];

  // ---- 4. Margins from measured axis content (SCENEGRAPH.md §6) ----
  const fs = theme.fontSize;
  const quantAxis = quantCh.axis === null ? null : (quantCh.axis ?? {});
  const nomAxis = nomCh ? (nomCh.axis === null ? null : (nomCh.axis ?? {})) : null;
  const tickLen = 4, labelGap = 4, titleGap = 8;

  // Provisional quantitative ticks against full size for label measurement
  const provisional = niceTicks(qLo, qHi, horizontal ? W : H, { includeZero: hasBars || quantCh.scale?.zero === true, nice: quantCh.scale?.nice !== false, tickCount: quantAxis?.tickCount });
  const qLabels = provisional.ticks.map((t) => formatValue(t, quantAxis?.format, provisional.step));
  const maxQLabelW = qLabels.reduce((m, l) => Math.max(m, measure(l, fs)), 0);

  const nomLabels = domainNominal.map(String);
  const maxNomLabelW = nomLabels.reduce((m, l) => Math.max(m, measure(l, fs)), 0);

  const quantTitle = quantCh.title ?? quantAxis?.title ?? undefined;
  const nomTitle = nomCh ? (nomCh.title ?? nomAxis?.title ?? undefined) : undefined;

  let mLeft: number, mBottom: number;
  const mTop = Math.ceil(textHeight(fs) / 2) + 2;
  let mRight = Math.ceil(Math.min(maxQLabelW, 60) / 2) + 4;
  if (horizontal) {
    mLeft = (nomAxis !== null ? Math.min(maxNomLabelW, 140) + tickLen + labelGap : 0) + (nomTitle ? textHeight(fs) + titleGap : 0) + 4;
    mBottom = (quantAxis !== null ? textHeight(fs) + tickLen + labelGap : 0) + (quantTitle ? textHeight(fs) + titleGap : 0) + 4;
  } else {
    mLeft = (quantAxis !== null ? Math.min(maxQLabelW, 80) + tickLen + labelGap : 0) + (quantTitle ? textHeight(fs) + titleGap : 0) + 4;
    const angled = nomAxis?.labelAngle ? Math.abs(nomAxis.labelAngle) > 0 : false;
    const nomLabelH = nomAxis !== null ? (angled ? Math.min(maxNomLabelW, 90) * 0.85 : textHeight(fs)) : 0;
    mBottom = nomLabelH + (nomAxis !== null ? tickLen + labelGap : 0) + (nomTitle ? textHeight(fs) + titleGap : 0) + 4;
  }
  const plot = { x: r2(mLeft), y: r2(mTop), w: r2(Math.max(10, W - mLeft - mRight)), h: r2(Math.max(10, H - mTop - mBottom)) };

  // ---- 5. Final scales ----
  const qTicks = niceTicks(qLo, qHi, horizontal ? plot.w : plot.h, { includeZero: hasBars || quantCh.scale?.zero === true, nice: quantCh.scale?.nice !== false, tickCount: quantAxis?.tickCount });
  const qScale: LinearScale = horizontal
    ? linearScale(qTicks, [plot.x, plot.x + plot.w])
    : linearScale(qTicks, [plot.y + plot.h, plot.y]); // y grows downward
  const nScale: BandScale | null = !binned && domainNominal.length
    ? bandScale(domainNominal, horizontal ? plot.y : plot.x, horizontal ? plot.h : plot.w)
    : null;
  // binned x: linear scale over bin extent
  let binScale: LinearScale | null = null;
  if (binned) {
    let bLo = Infinity, bHi = -Infinity;
    for (const r of prepared[0].data.rows) { bLo = Math.min(bLo, num(r.__bin0)); bHi = Math.max(bHi, num(r.__bin1)); }
    const bt = niceTicks(bLo, bHi, plot.w, {});
    binScale = linearScale({ ...bt, niceMin: bLo, niceMax: bHi }, [plot.x, plot.x + plot.w]);
  }

  // ---- 6. Color resolution (SCENEGRAPH.md §4.3) ----
  const colorCh = asChannel(prepared[0].unit.encoding.color);
  const colorField = prepared[0].data.colorField;
  const colorDomain = colorField ? nominalDomain(prepared[0].data.rows, colorField, null) : [];
  const paletteFor = (v: unknown): string => theme.palette[colorDomain.findIndex((d) => String(d) === String(v)) % theme.palette.length] ?? theme.hue;
  const selected = (sel: string | undefined, datum: Row): boolean | null => {
    if (!sel) return null;
    const state = input.selectionState?.[sel];
    if (!state || state.length === 0) return null; // no active selection -> condition value applies to none? spec: no selection -> base value
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

  const nodes: SceneNode[] = [];
  const push = (n: SceneNode) => nodes.push(n);

  // ---- 7. Grid (before marks) ----
  if (quantAxis && quantAxis.grid) {
    for (const t of qTicks.ticks) {
      const p = r2(qScale.scale(t));
      push(horizontal
        ? { type: "line", x1: p, y1: plot.y, x2: p, y2: r2(plot.y + plot.h), stroke: theme.gridColor, strokeWidth: 1, meta: { role: "grid" } }
        : { type: "line", x1: plot.x, y1: p, x2: r2(plot.x + plot.w), y2: p, stroke: theme.gridColor, strokeWidth: 1, meta: { role: "grid" } });
    }
  }

  // ---- 8. Marks, in layer order ----
  const zero = r2(qScale.scale(Math.max(qTicks.niceMin, Math.min(0, qTicks.niceMax)) < 0 ? 0 : Math.max(0, qTicks.niceMin)));
  for (const p of prepared) {
    const enc = p.unit.encoding;
    const mx = asChannel(enc.x), my = asChannel(enc.y);
    const qF = horizontal ? p.data.xField! : p.data.yField!;
    const nF = horizontal ? p.data.yField : p.data.xField;
    const selMeta: Meta["selection"] = p.unit.selections?.[0]?.id;
    const selFields = p.unit.selections?.[0]?.fields;
    const meta = (datum: Row): Meta => ({ role: "mark", datum, ...(selMeta ? { selection: selMeta, fields: selFields } : {}) });

    switch (p.mark.type) {
      case "bar": {
        for (const rrow of p.data.rows) {
          const qv = num(rrow[qF]);
          const qp = r2(qScale.scale(qv));
          const fill = resolveFill(p.mark, rrow);
          const opacity = p.mark.opacity;
          const rx = p.mark.cornerRadiusEnd ?? p.mark.cornerRadius;
          if (binned && binScale) {
            const x0p = r2(binScale.scale(num(rrow.__bin0)));
            const x1p = r2(binScale.scale(num(rrow.__bin1)));
            push({ type: "rect", x: x0p, y: Math.min(qp, zero), width: r2(Math.max(0, x1p - x0p - 1)), height: r2(Math.abs(zero - qp)), fill, ...(opacity !== undefined ? { opacity } : {}), ...(rx !== undefined ? { rx } : {}), meta: meta(rrow) });
          } else if (nScale && nF) {
            const np = r2(nScale.position(rrow[nF]));
            const bw = r2(nScale.bandwidth);
            push(horizontal
              ? { type: "rect", x: Math.min(qp, zero), y: np, width: r2(Math.abs(qp - zero)), height: bw, fill, ...(opacity !== undefined ? { opacity } : {}), ...(rx !== undefined ? { rx } : {}), meta: meta(rrow) }
              : { type: "rect", x: np, y: Math.min(qp, zero), width: bw, height: r2(Math.abs(zero - qp)), fill, ...(opacity !== undefined ? { opacity } : {}), ...(rx !== undefined ? { rx } : {}), meta: meta(rrow) });
          }
        }
        break;
      }
      case "line": case "area": {
        const pts = p.data.rows.map((rrow) => {
          const qp = qScale.scale(num(rrow[qF]));
          const np = nScale && nF ? nScale.center(rrow[nF]) : binScale ? binScale.scale((num(rrow.__bin0) + num(rrow.__bin1)) / 2) : 0;
          return horizontal ? { x: qp, y: np, row: rrow } : { x: np, y: qp, row: rrow };
        });
        if (pts.length) {
          const d = pts.map((pt, i) => `${i === 0 ? "M" : "L"}${r2(pt.x)},${r2(pt.y)}`).join("");
          const stroke = resolveFill(p.mark, p.data.rows[0]);
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
        for (const rrow of p.data.rows) {
          const qp = qScale.scale(num(rrow[qF]));
          const np = nScale && nF ? nScale.center(rrow[nF]) : 0;
          const fill = resolveFill(p.mark, rrow);
          push({ type: "circle", cx: r2(horizontal ? qp : np), cy: r2(horizontal ? np : qp), r: p.mark.size ? Math.sqrt(p.mark.size) : 3.5, fill, ...(p.mark.opacity !== undefined ? { opacity: p.mark.opacity } : {}), meta: meta(rrow) });
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
          const qv = num(rrow[qF]);
          const qp = qScale.scale(qv);
          const np = nScale && nF ? nScale.center(rrow[nF]) : 0;
          const content = String(textCh?.field !== undefined ? rrow[textCh.field] : textCh?.value ?? "");
          const fill = p.mark.color ?? theme.labelColor;
          // Place just inside the bar end (horizontal) / just above (vertical).
          const pad = 6;
          const node: TextNode = horizontal
            ? { type: "text", x: r2(qp - pad), y: r2(np + textHeight(fs) / 2 - fs * 0.25), content: truncateToFit(content, Math.abs(qp - zero) - pad * 2, fs, measure), fill, fontSize: fs, anchor: "end", meta: meta(rrow) }
            : { type: "text", x: r2(np), y: r2(qp - 4), content, fill, fontSize: fs, anchor: "middle", meta: meta(rrow) };
          if (node.content.length) push(node);
        }
        break;
      }
      case "arc":
        throw new Error("airmark-engine: 'arc' mark not implemented yet — add a golden fixture and implement in layout.ts");
      default:
        throw new Error(`airmark-engine: unsupported mark type '${p.mark.type}'`);
    }
  }

  // ---- 9. Axes (after marks) ----
  const axisText = (x: number, y: number, content: string, anchor: TextNode["anchor"], extra?: Partial<TextNode>): TextNode =>
    ({ type: "text", x: r2(x), y: r2(y), content, fill: theme.labelColor, fontSize: fs, anchor, meta: { role: "label" }, ...extra });

  if (quantAxis) {
    // domain line
    push(horizontal
      ? { type: "line", x1: plot.x, y1: r2(plot.y + plot.h), x2: r2(plot.x + plot.w), y2: r2(plot.y + plot.h), stroke: theme.axisColor, strokeWidth: 1, meta: { role: "axis" } }
      : { type: "line", x1: plot.x, y1: plot.y, x2: plot.x, y2: r2(plot.y + plot.h), stroke: theme.axisColor, strokeWidth: 1, meta: { role: "axis" } });
    for (const t of qTicks.ticks) {
      const p = r2(qScale.scale(t));
      const label = formatValue(t, quantAxis.format, qTicks.step);
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
        ? axisText(plot.x + plot.w / 2, H - 4, String(quantTitle), "middle", { meta: { role: "title" } })
        : axisText(0, 0, String(quantTitle), "middle", { angle: -90, x: r2(textHeight(fs) - 2), y: r2(plot.y + plot.h / 2), meta: { role: "title" } }));
    }
  }
  if (nomAxis && nScale) {
    push(horizontal
      ? { type: "line", x1: plot.x, y1: plot.y, x2: plot.x, y2: r2(plot.y + plot.h), stroke: theme.axisColor, strokeWidth: 1, meta: { role: "axis" } }
      : { type: "line", x1: plot.x, y1: r2(plot.y + plot.h), x2: r2(plot.x + plot.w), y2: r2(plot.y + plot.h), stroke: theme.axisColor, strokeWidth: 1, meta: { role: "axis" } });
    const angle = nomAxis.labelAngle ?? 0;
    for (const v of domainNominal) {
      const c = r2(nScale.center(v));
      const label = truncateToFit(String(v), nomAxis.labelLimit ?? 140, fs, measure);
      if (horizontal) {
        push({ type: "line", x1: r2(plot.x - tickLen), y1: c, x2: plot.x, y2: c, stroke: theme.axisColor, strokeWidth: 1, meta: { role: "axis" } });
        push(axisText(plot.x - tickLen - labelGap, c + fs * 0.35, label, "end"));
      } else {
        push({ type: "line", x1: c, y1: r2(plot.y + plot.h), x2: c, y2: r2(plot.y + plot.h + tickLen), stroke: theme.axisColor, strokeWidth: 1, meta: { role: "axis" } });
        push(angle
          ? axisText(c, plot.y + plot.h + tickLen + labelGap + fs * 0.8, label, "end", { angle })
          : axisText(c, plot.y + plot.h + tickLen + labelGap + fs * 0.8, label, "middle"));
      }
    }
    if (nomTitle) {
      push(horizontal
        ? axisText(0, 0, String(nomTitle), "middle", { angle: -90, x: r2(textHeight(fs) - 2), y: r2(plot.y + plot.h / 2), meta: { role: "title" } })
        : axisText(plot.x + plot.w / 2, H - 4, String(nomTitle), "middle", { meta: { role: "title" } }));
    }
  }
  // binned x axis (linear ticks along x)
  if (binned && binScale && (x0?.axis !== null)) {
    push({ type: "line", x1: plot.x, y1: r2(plot.y + plot.h), x2: r2(plot.x + plot.w), y2: r2(plot.y + plot.h), stroke: theme.axisColor, strokeWidth: 1, meta: { role: "axis" } });
    for (const t of binScale.ticksInfo.ticks.filter((t) => t >= binScale!.domain[0] - 1e-9 && t <= binScale!.domain[1] + 1e-9)) {
      const p = r2(binScale.scale(t));
      push({ type: "line", x1: p, y1: r2(plot.y + plot.h), x2: p, y2: r2(plot.y + plot.h + tickLen), stroke: theme.axisColor, strokeWidth: 1, meta: { role: "axis" } });
      push(axisText(p, plot.y + plot.h + tickLen + labelGap + fs * 0.8, formatTick(t, binScale.ticksInfo.step), "middle"));
    }
    const xt = x0?.title ?? (x0?.axis as { title?: string } | undefined)?.title;
    if (xt) push(axisText(plot.x + plot.w / 2, H - 4, String(xt), "middle", { meta: { role: "title" } }));
  }

  return { width: W, height: H, nodes };
}

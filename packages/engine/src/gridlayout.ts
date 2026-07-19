// packages/engine/src/gridlayout.ts
// Deterministic implementation of the AIRspec §8.2 document grid: multiple
// chart/metric/table components arranged beside and below each other.
// This is DOCUMENT layout (host responsibility), deliberately separate from
// AIRMark: side-by-side charts are grid items, never in-graphic concat.

import { clamp, r2 } from "./core.js";

export type GridItem = {
  id: string;
  span?: number; spanTablet?: number; spanMobile?: number;   // 1..12
  minHeight?: number; maxHeight?: number;
  height?: number;                                            // desired content height
};
export type GridOptions = {
  containerWidth: number;
  gap?: number;                    // px, default 16
  columns?: number;                // default 12
  breakpoints?: { mobile: number; tablet: number };  // defaults 640 / 1024
  defaultHeight?: number;          // default 300
};
export type GridBox = { id: string; x: number; y: number; width: number; height: number; row: number };

export function layoutGrid(items: GridItem[], opts: GridOptions): { boxes: GridBox[]; totalHeight: number } {
  const cols = opts.columns ?? 12;
  const gap = opts.gap ?? 16;
  const bp = opts.breakpoints ?? { mobile: 640, tablet: 1024 };
  const W = opts.containerWidth;
  const mode: "mobile" | "tablet" | "desktop" = W < bp.mobile ? "mobile" : W < bp.tablet ? "tablet" : "desktop";
  const colW = (W - gap * (cols - 1)) / cols;

  const spanOf = (it: GridItem): number => {
    const s = mode === "mobile" ? it.spanMobile ?? it.spanTablet ?? it.span
      : mode === "tablet" ? it.spanTablet ?? it.span
      : it.span;
    return clamp(s ?? cols, 1, cols);
  };
  const heightOf = (it: GridItem): number => {
    let h = it.height ?? opts.defaultHeight ?? 300;
    if (it.minHeight !== undefined) h = Math.max(h, it.minHeight);
    if (it.maxHeight !== undefined) h = Math.min(h, it.maxHeight);
    return h;
  };

  // Row packing: fill left-to-right; an item that would overflow the row wraps.
  const boxes: GridBox[] = [];
  let row = 0, used = 0, y = 0;
  let current: Array<{ it: GridItem; span: number }> = [];
  const flush = () => {
    if (!current.length) return;
    const rowH = Math.max(...current.map(({ it }) => heightOf(it)));
    let x = 0, c = 0;
    for (const { it, span } of current) {
      const w = span * colW + (span - 1) * gap;
      boxes.push({ id: it.id, x: r2(x), y: r2(y), width: r2(w), height: r2(rowH), row });
      x += w + gap; c += span;
    }
    y += rowH + gap; row++; used = 0; current = [];
  };
  for (const it of items) {
    const span = spanOf(it);
    if (used + span > cols) flush();
    current.push({ it, span });
    used += span;
    if (used === cols) flush();
  }
  flush();
  return { boxes, totalHeight: r2(Math.max(0, y - gap)) };
}

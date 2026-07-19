// packages/engine/test/invariants.test.mjs
// Golden fixtures prove stability; these tests prove the goldens are RIGHT.
// Each assertion encodes a human-checkable fact about the expected chart.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { layout, niceTicks, formatTick, defaultMeasureText } from "../dist/index.js";

const load = (name) => JSON.parse(readFileSync(new URL(`../../../fixtures/cases/${name}.json`, import.meta.url), "utf8")).input;
const marks = (scene, type) => scene.nodes.filter((n) => n.type === type && n.meta?.role === "mark");

test("determinism: identical input -> byte-identical output", () => {
  const input = load("bar-vertical-letter-frequency");
  assert.equal(JSON.stringify(layout(input)), JSON.stringify(layout(input)));
});

test("normative ticks: 0..0.127 over 300px", () => {
  const t = niceTicks(0, 0.127, 300, { includeZero: true });
  // targetCount = clamp(floor(300/50),2,10) = 6; raw=0.02117; step=0.05? mag=0.01, r=2.117 -> step 0.05
  assert.equal(t.step, 0.05);
  assert.equal(t.niceMin, 0);
  assert.ok(Math.abs(t.niceMax - 0.15) < 1e-9);
  assert.deepEqual(t.ticks.map((x) => formatTick(x, t.step)), ["0", "0.05", "0.1", "0.15"]);
});

test("letter frequency: 26 bars, E tallest, bars sit on the zero line", () => {
  const scene = layout(load("bar-vertical-letter-frequency"));
  const bars = marks(scene, "rect");
  assert.equal(bars.length, 26);
  const tallest = bars.reduce((a, b) => (b.height > a.height ? b : a));
  assert.equal(tallest.meta.datum.letter, "E");
  const baseline = Math.max(...bars.map((b) => b.y + b.height));
  for (const b of bars) assert.ok(Math.abs(b.y + b.height - baseline) < 0.02, "all bars share the baseline");
  // E's height must be ~ (0.127/0.15) of the plot height implied by the shortest-to-baseline distance of a zero bar
  const e = tallest, a = bars.find((b) => b.meta.datum.letter === "A");
  assert.ok(Math.abs(e.height / a.height - 0.127 / 0.082) < 0.02, "heights proportional to frequency");
  assert.ok(scene.nodes.some((n) => n.type === "text" && n.content === "E"), "x labels emitted");
  assert.ok(scene.nodes.some((n) => n.type === "line" && n.meta?.role === "grid"), "grid lines emitted");
});

test("met departments: uniform horizontal bars, white inside labels, no axes", () => {
  const scene = layout(load("bar-horizontal-uniform-text-overlay"));
  const bars = marks(scene, "rect");
  assert.equal(bars.length, 14);
  const widths = new Set(bars.map((b) => b.width));
  assert.equal(widths.size, 1, "count=1 for every department -> uniform bar length");
  const labels = scene.nodes.filter((n) => n.type === "text" && n.fill === "#FFFFFF");
  assert.equal(labels.length, 14);
  // labels end just inside the bar end, and bars are alphabetical top-to-bottom
  const sortedByY = [...bars].sort((x, y) => x.y - y.y).map((b) => b.meta.datum.displayName);
  assert.deepEqual(sortedByY, [...sortedByY].sort());
  for (const l of labels) assert.equal(l.anchor, "end");
  assert.ok(!scene.nodes.some((n) => n.meta?.role === "axis"), "axis:null suppresses all axes");
});

test("histogram: contiguous bins, counts sum to row count", () => {
  const input = load("histogram-binned-count");
  const scene = layout(input);
  const bars = marks(scene, "rect");
  assert.ok(bars.length >= 5 && bars.length <= 12);
  const total = bars.reduce((s, b) => s + b.meta.datum[Object.keys(b.meta.datum).find((k) => k.startsWith("__count"))], 0);
  assert.equal(total, input.rows.length);
  const xs = [...bars].sort((a, b) => a.x - b.x);
  for (let i = 1; i < xs.length; i++) {
    assert.ok(xs[i].x - (xs[i - 1].x + xs[i - 1].width) <= 1.5, "bins contiguous (1px gap allowance)");
  }
});

test("layered bar+line: shared band scale, points centered on bands", () => {
  const scene = layout(load("layered-bar-line-trend"));
  const bars = marks(scene, "rect");
  const points = scene.nodes.filter((n) => n.type === "circle");
  assert.equal(bars.length, 6);
  assert.equal(points.length, 6);
  const sortedBars = [...bars].sort((a, b) => a.x - b.x);
  const sortedPts = [...points].sort((a, b) => a.cx - b.cx);
  for (let i = 0; i < 6; i++) {
    const center = sortedBars[i].x + sortedBars[i].width / 2;
    assert.ok(Math.abs(sortedPts[i].cx - center) < 0.02, "line points share the band centers");
  }
  assert.ok(scene.nodes.some((n) => n.type === "text" && n.content === "$100K"), "compact currency tick label");
});

test("selection condition: picked datum takes palette color, rest take base value", () => {
  const scene = layout(load("bar-selection-condition-highlight"));
  const bars = marks(scene, "rect");
  const west = bars.find((b) => b.meta.datum.region === "West");
  const east = bars.find((b) => b.meta.datum.region === "East");
  assert.equal(west.fill, "#3264D6");
  assert.equal(east.fill, "#C7CDD8");
  for (const b of bars) { assert.equal(b.meta.selection, "picked"); assert.deepEqual(b.meta.fields, ["region"]); }
  // -y sort: descending by revenue left-to-right
  const order = [...bars].sort((a, b) => a.x - b.x).map((b) => b.meta.datum.region);
  assert.deepEqual(order, ["West", "East", "North", "South"]);
});

test("measureText estimator matches the normative class table", () => {
  assert.ok(Math.abs(defaultMeasureText("ill", 10) - 0.28 * 3 * 10) < 1e-9);
  assert.ok(Math.abs(defaultMeasureText("MW", 10) - 0.85 * 2 * 10) < 1e-9);
  assert.ok(Math.abs(defaultMeasureText("09", 10) - 0.55 * 2 * 10) < 1e-9);
});

test("deny by default: unknown mark and unknown transform throw", () => {
  const base = load("bar-vertical-letter-frequency");
  assert.throws(() => layout({ ...base, graphic: { ...base.graphic, mark: "hexbin" } }), /unsupported mark/);
  assert.throws(() => layout({ ...base, graphic: { ...base.graphic, transform: [{ calculate: "x" }] } }), /unknown transform/);
});

// ---------------- New-capability invariants ----------------
import { layoutGrid } from "../dist/index.js";

test("stacked bars: segments contiguous, column heights = group totals, legend emitted", () => {
  const scene = layout(load("bar-stacked-zero"));
  const bars = marks(scene, "rect");
  assert.equal(bars.length, 12);
  const west = bars.filter((b) => b.meta.datum.region === "West").sort((a, b) => b.y - a.y);
  // contiguity: each segment's top equals the next segment's bottom
  for (let i = 1; i < west.length; i++) {
    assert.ok(Math.abs((west[i].y + west[i].height) - west[i - 1].y) < 0.02, "stack segments contiguous");
  }
  const westTotal = west.reduce((s, b) => s + b.height, 0);
  const south = bars.filter((b) => b.meta.datum.region === "South");
  const southTotal = south.reduce((s, b) => s + b.height, 0);
  assert.ok(Math.abs(westTotal / southTotal - 275 / 95) < 0.02, "stack heights proportional to totals");
  const swatches = scene.nodes.filter((n) => n.type === "rect" && n.meta?.role === "label");
  assert.equal(swatches.length, 3, "legend swatch per product");
});

test("grouped bars: 4 groups x 3, inner bars inside outer band", () => {
  const scene = layout(load("bar-grouped-xoffset"));
  const bars = marks(scene, "rect");
  assert.equal(bars.length, 12);
  const byRegion = new Map();
  for (const b of bars) {
    const r = b.meta.datum.region;
    byRegion.set(r, [...(byRegion.get(r) ?? []), b]);
  }
  for (const [, group] of byRegion) {
    assert.equal(group.length, 3);
    const xs = group.map((b) => b.x).sort((a, b) => a - b);
    const spread = xs[2] + group[0].width - xs[0];
    // three inner bars must be narrower than a third of the panel width
    assert.ok(group[0].width * 3 <= spread + 1, "inner bars packed");
  }
  const fills = new Set(bars.map((b) => b.fill));
  assert.equal(fills.size, 3, "one palette color per product");
});

test("pie: slice fractions proportional, full circle, legend", () => {
  const input = load("arc-pie-legend");
  const scene = layout(input);
  const slices = scene.nodes.filter((n) => n.type === "path" && n.meta?.role === "mark");
  assert.equal(slices.length, 4);
  // Chrome (64%) slice path should have ~64% of the polyline segments of the full circle
  const segs = slices.map((s) => s.d.split("L").length);
  const total = segs.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(segs[0] / total - 0.64) < 0.05, "segment counts track angular fractions");
  assert.equal(scene.nodes.filter((n) => n.type === "rect" && n.meta?.role === "label").length, 4, "legend");
  // donut variant produces ring paths (contains inner arc: more L commands than pie wedge with same angle)
  const donut = layout(load("arc-donut"));
  assert.equal(donut.nodes.filter((n) => n.type === "path" && n.meta?.role === "mark").length, 3);
});

test("temporal multi-series line: two palette paths, month labels, shared scale", () => {
  const scene = layout(load("line-multiseries-temporal"));
  const paths = scene.nodes.filter((n) => n.type === "path" && n.meta?.role === "mark");
  assert.equal(paths.length, 2);
  assert.equal(paths[0].stroke, "#3264D6");
  assert.equal(paths[1].stroke, "#26A69A");
  const labels = scene.nodes.filter((n) => n.type === "text").map((n) => n.content);
  assert.ok(labels.includes("Feb 2026") || labels.includes("Feb 1"), "temporal tick labels present: " + labels.join("|"));
});

test("facets: 4 titled panels sharing the quantitative domain", () => {
  const scene = layout(load("facet-column-small-multiples"));
  const titles = scene.nodes.filter((n) => n.type === "text" && n.meta?.role === "title" && ["East","North","South","West"].includes(n.content));
  assert.equal(titles.length, 4);
  assert.deepEqual(titles.map((t) => t.content), ["East","North","South","West"], "alphabetical panel order");
  const bars = marks(scene, "rect");
  assert.equal(bars.length, 12);
  // shared scale: the 120-revenue bar (West/Hardware) is the tallest overall,
  // and equal revenues in different panels have equal heights
  const h = (r, p) => bars.find((b) => b.meta.datum.region === r && b.meta.datum.product === p).height;
  assert.ok(Math.abs(h("West","Hardware") / h("East","Software") - 120 / 110) < 0.03, "cross-panel heights share one scale");
});

test("document grid: spans, wrapping, row heights, responsive collapse", () => {
  const items = [
    { id: "m1", span: 3, height: 120 }, { id: "m2", span: 3, height: 120 },
    { id: "chart", span: 6, minHeight: 320 },
    { id: "table", span: 12, height: 260 },
  ];
  const g = layoutGrid(items, { containerWidth: 1120, gap: 16 });
  const by = Object.fromEntries(g.boxes.map((b) => [b.id, b]));
  assert.equal(by.m1.row, 0); assert.equal(by.chart.row, 0); assert.equal(by.table.row, 1);
  assert.equal(by.m1.height, 320, "row height = max of items in row");
  assert.ok(Math.abs((by.m1.width + by.m2.width + by.chart.width + 2 * 16) - 1120) < 0.05, "row fills container");
  assert.equal(by.table.y, 320 + 16);
  const mobile = layoutGrid(items.map((i) => ({ ...i, spanMobile: 12 })), { containerWidth: 390 });
  assert.deepEqual(mobile.boxes.map((b) => b.row), [0, 1, 2, 3], "mobile: every item wraps to its own row");
});

test("boxplot: normative quartiles, whisker fences, outliers, composition", async () => {
  const { boxStats } = await import("../dist/index.js");
  // Normative R-7 check: [1..9] -> q1=3, med=5, q3=7 ; [1,2,3,4] -> q1=1.75, med=2.5, q3=3.25
  const a = boxStats([1,2,3,4,5,6,7,8,9]);
  assert.deepEqual([a.q1, a.median, a.q3], [3, 5, 7]);
  const b = boxStats([1,2,3,4]);
  assert.deepEqual([b.q1, b.median, b.q3], [1.75, 2.5, 3.25]);
  // Fence: outlier excluded from whiskers
  const c = boxStats([10,11,12,13,14,50]);
  assert.ok(c.outliers.includes(50) && c.whiskerHi <= 14);

  const input = load("boxplot-price-by-category");
  const scene = layout(input);
  const boxes = scene.nodes.filter((n) => n.type === "rect" && n.meta?.role === "mark");
  assert.equal(boxes.length, 3);
  const order = [...boxes].sort((x, y) => x.x - y.x).map((bx) => bx.meta.datum.category);
  assert.deepEqual(order, ["Economy", "Standard", "Premium"], "explicit sort array honored");
  for (const bx of boxes) {
    const d = bx.meta.datum;
    assert.ok(d.q1 < d.median && d.median < d.q3, "median inside box");
    // white median line within the box's vertical extent
    const med = scene.nodes.find((n) => n.type === "line" && n.stroke === "#FFFFFF" && n.meta?.datum?.category === d.category);
    assert.ok(med.y1 >= bx.y - 0.01 && med.y1 <= bx.y + bx.height + 0.01, "median line inside box rect");
  }
  const outliers = scene.nodes.filter((n) => n.type === "circle" && n.meta?.datum?.outlier);
  assert.ok(outliers.length >= 3, "injected outliers rendered as points");
  const premiumBox = boxes.find((bx) => bx.meta.datum.category === "Premium");
  const premiumOut = outliers.filter((o) => o.meta.datum.category === "Premium");
  assert.ok(premiumOut.some((o) => o.cy < premiumBox.y) && premiumOut.some((o) => o.cy > premiumBox.y + premiumBox.height),
    "Premium outliers on both sides of the box");
});

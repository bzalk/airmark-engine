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

test("scatter: linear x axis, nice y ticks, area-proportional size, legend", () => {
  const input = load("scatter-bubble-color-size");
  const scene = layout(input);
  const pts = scene.nodes.filter((n) => n.type === "circle" && n.meta?.role === "mark");
  assert.equal(pts.length, input.rows.length);
  // x axis: linear currency ticks + title (the exact defects from the app screenshot)
  const labels = scene.nodes.filter((n) => n.type === "text").map((n) => n.content);
  assert.ok(labels.some((l) => /^\$\d/.test(l)), "currency x tick labels present: " + labels.filter(l=>l.startsWith("$")).join(","));
  assert.ok(labels.includes("Price (USD)"), "x axis title emitted");
  // y: nice ticks, not one-per-distinct-rating; zero not forced
  const yTickLabels = labels.filter((l) => /^[2-5](\.\d)?$/.test(l));
  assert.ok(yTickLabels.length <= 8, "y uses nice ticks, got: " + yTickLabels.join(","));
  assert.ok(!labels.includes("0"), "scale.zero:false respected");
  // x positions correlate with price (monotone check on extremes)
  const cheapest = input.rows.reduce((a, b) => (b.price < a.price ? b : a));
  const dearest  = input.rows.reduce((a, b) => (b.price > a.price ? b : a));
  const px = (t) => pts.find((p) => p.meta.datum.title === t.title).cx;
  assert.ok(px(dearest) > px(cheapest) + 100, "linear x spread, not banding");
  // size: radii in [2,12], area-linear -> max stock has max radius
  const rs = pts.map((p) => p.r);
  assert.ok(Math.min(...rs) >= 2 - 1e-9 && Math.max(...rs) <= 12 + 1e-9);
  const maxStock = input.rows.reduce((a, b) => (b.stock > a.stock ? b : a));
  assert.ok(Math.abs(px && pts.find((p) => p.meta.datum.title === maxStock.title).r - 12) < 0.01, "largest stock -> r = 12");
  // legend: one swatch per category
  assert.equal(scene.nodes.filter((n) => n.type === "rect" && n.meta?.role === "label").length, 4);
});

test("horizontal sorted bars (-x): longest on top, nominal y labels, quantitative x ticks", () => {
  const scene = layout(load("bar-horizontal-sorted-negx"));
  const bars = marks(scene, "rect");
  assert.equal(bars.length, 4);
  const topToBottom = [...bars].sort((a, b) => a.y - b.y).map((b) => b.meta.datum.category);
  assert.deepEqual(topToBottom, ["laptops", "fragrances", "skincare", "groceries"], "-x sorts descending by value");
  const widths = [...bars].sort((a, b) => a.y - b.y).map((b) => b.width);
  for (let i = 1; i < widths.length; i++) assert.ok(widths[i] <= widths[i - 1] + 0.01, "bar length decreases downward");
  const labels = scene.nodes.filter((n) => n.type === "text").map((n) => n.content);
  assert.ok(labels.includes("laptops") && labels.includes("groceries"), "y axis shows category names");
  assert.ok(!labels.includes("5999.94999") && !labels.includes("419.95"), "x axis shows nice ticks, never raw data values");
  assert.ok(labels.some((l) => /^\$\d+(K)?$/.test(l)), "compact currency x ticks: " + labels.filter(l=>l.startsWith("$")).join(","));
});

test("horizontal tick strip: vertical segments at price positions on category rows", () => {
  const input = load("tick-strip-horizontal");
  const scene = layout(input);
  const ticks = scene.nodes.filter((n) => n.type === "line" && n.meta?.role === "mark");
  assert.equal(ticks.length, 60);
  for (const t of ticks) {
    assert.ok(Math.abs(t.x1 - t.x2) < 0.01 && Math.abs(t.y2 - t.y1 - 12) < 0.01, "vertical 12px segment");
  }
  // electronics ticks sit to the right of groceries ticks (linear x)
  const maxG = Math.max(...ticks.filter((t) => t.meta.datum.category === "groceries").map((t) => t.x1));
  const minE = Math.min(...ticks.filter((t) => t.meta.datum.category === "electronics").map((t) => t.x1));
  assert.ok(minE > maxG, "linear price axis separates categories");
  // three distinct row centers, three palette colors, no legend
  assert.equal(new Set(ticks.map((t) => (t.y1 + t.y2) / 2)).size, 3, "ticks centered on 3 category rows");
  assert.equal(new Set(ticks.map((t) => t.stroke)).size, 3);
  assert.equal(scene.nodes.filter((n) => n.type === "rect" && n.meta?.role === "label").length, 0, "legend:null respected");
});

test("log x scatter: decade ticks, skewed data spread, deny unsupported types", () => {
  const input = load("scatter-log-x-skewed");
  const scene = layout(input);
  const labels = scene.nodes.filter((n) => n.type === "text").map((n) => n.content);
  for (const expected of ["$1", "$10", "$100", "$1000"]) {
    assert.ok(labels.includes(expected), `decade tick ${expected} present; got: ${labels.filter(l=>l.startsWith("$")).join(",")}`);
  }
  const pts = scene.nodes.filter((n) => n.type === "circle" && n.meta?.role === "mark");
  // On a linear axis the $1-$20 groceries would collapse into <1% of width;
  // on log they must span a meaningful share of the plot.
  const groc = pts.filter((p) => p.meta.datum.category === "groceries").map((p) => p.cx);
  const all = pts.map((p) => p.cx);
  const plotW = Math.max(...all) - Math.min(...all);
  assert.ok((Math.max(...groc) - Math.min(...groc)) / plotW > 0.15, "cheap items spread on log axis");
  // laptops sit right of every grocery
  const minLap = Math.min(...pts.filter((p) => p.meta.datum.category === "laptops").map((p) => p.cx));
  assert.ok(minLap > Math.max(...groc), "expensive decade separated");
  // deny-by-default: sqrt not implemented -> throw; log with nonpositive -> throw
  const g = input.graphic;
  assert.throws(() => layout({ ...input, graphic: { ...g, encoding: { ...g.encoding, x: { ...g.encoding.x, scale: { type: "sqrt" } } } } }), /not implemented/);
  assert.throws(() => layout({ ...input, rows: [...input.rows, { title: "free", category: "beauty", price: 0, rating: 3, stock: 5 }] }), /positive domain/);
});

test("color scale.range: custom range overrides theme palette; scheme denied", () => {
  const input = load("bar-stacked-zero");
  const g = JSON.parse(JSON.stringify(input.graphic));
  g.encoding.color.scale = { range: ["#111111", "#555555", "#999999"] };
  const scene = layout({ ...input, graphic: g });
  const fills = new Set(marks(scene, "rect").map((b) => b.fill));
  assert.deepEqual([...fills].sort(), ["#111111", "#555555", "#999999"], "segments use the declared range, not the theme palette");
  const swatches = scene.nodes.filter((n) => n.type === "rect" && n.meta?.role === "label").map((n) => n.fill);
  assert.deepEqual([...new Set(swatches)].sort(), ["#111111", "#555555", "#999999"], "legend swatches match the range");
  g.encoding.color.scale = { scheme: "category10" };
  assert.throws(() => layout({ ...input, graphic: g }), /scheme not implemented/);
});

test("scale.reverse: flipped quantitative range (pyramid left panel) and band reversal", () => {
  const input = load("bar-horizontal-reversed-x-pyramid");
  const scene = layout(input);
  const bars = marks(scene, "rect");
  assert.equal(bars.length, 9);
  // zero baseline at the RIGHT: all bars end at the same right edge
  const rights = bars.map((b) => b.x + b.width);
  const baseline = rights[0];
  for (const r of rights) assert.ok(Math.abs(r - baseline) < 0.02, "bars right-aligned on the zero baseline");
  // larger population extends further LEFT
  const big = bars.find((b) => b.meta.datum.age === "30-34");
  const small = bars.find((b) => b.meta.datum.age === "0-4");
  assert.ok(big.x < small.x, "larger value reaches further left");
  // tick labels mirrored: the '0' tick label is the rightmost numeric label
  const numLabels = scene.nodes.filter((n) => n.type === "text" && /^\d+$/.test(n.content));
  const zero = numLabels.find((n) => n.content === "0");
  assert.ok(zero && numLabels.every((n) => n.x <= zero.x + 0.01), "0 at the right edge");
  // band reversal composes with sort
  const g = JSON.parse(JSON.stringify(input.graphic));
  g.encoding.y.scale = { reverse: true };
  const flipped = layout({ ...input, graphic: g });
  const orderA = [...bars].sort((a, b) => a.y - b.y).map((b) => b.meta.datum.age);
  const orderB = [...marks(flipped, "rect")].sort((a, b) => a.y - b.y).map((b) => b.meta.datum.age);
  assert.deepEqual(orderB, [...orderA].reverse(), "nominal reverse flips resolved domain order");
});

test("axis orient right: age labels on the spine edge of the reversed pyramid half", () => {
  const input = load("bar-horizontal-reversed-x-pyramid");
  const scene = layout(input);
  const bars = marks(scene, "rect");
  const barsRight = Math.max(...bars.map((b) => b.x + b.width));
  const ageLabels = scene.nodes.filter((n) => n.type === "text" && /^\d/.test(n.content) && n.content.includes("-"));
  assert.equal(ageLabels.length, 9);
  for (const l of ageLabels) {
    assert.ok(l.x > barsRight, "labels sit to the RIGHT of the bars (spine side)");
    assert.equal(l.anchor, "start");
  }
  // zero baseline (bar right edges) now abuts the label column: reversed + orient right = pyramid half
  const zero = scene.nodes.filter((n) => n.type === "text" && n.content === "0");
  assert.ok(zero.length >= 1 && Math.abs(zero[0].x - barsRight) < 20, "zero tick adjacent to spine");

  const badNominal = structuredClone(input);
  badNominal.graphic.encoding.y.axis.orient = "bottom";
  assert.throws(() => layout(badNominal), /not implemented for the nominal channel/);

  const badQuantitative = structuredClone(input);
  badQuantitative.graphic.encoding.x.axis = { orient: "top" };
  assert.throws(() => layout(badQuantitative), /not implemented for the quantitative channel/);

  const invalid = structuredClone(input);
  invalid.graphic.encoding.y.axis.orient = "diagonal";
  assert.throws(() => layout(invalid), /orient 'diagonal' invalid/);
});

test("deny by default: expression-string filter throws a named error, never a TypeError", async () => {
  const { applyTransforms } = await import("../dist/index.js");
  assert.throws(
    () => applyTransforms([{ sex: "male" }], [{ filter: "datum.sex === 'male'" }]),
    /expression strings are not part of AIRMark/,
  );
  assert.throws(() => applyTransforms([{}], [{ filter: null }]), /got null/);
  assert.throws(() => applyTransforms([{}], [{ filter: [{ field: "x", equal: 1 }] }]), /structured object/);
});

test("explicit scale.domain: exact bounds honored, not nice-rounded (mirrored-pair guarantee)", () => {
  const base = { width: 400, height: 300, rows: [{ age: "a", pop: 407 }, { age: "b", pop: 62 }],
    graphic: { mark: "bar", encoding: { y: { field: "age", type: "nominal", sort: null },
      x: { field: "pop", type: "quantitative", scale: { zero: true, domain: [0, 1000] } } } } };
  const s = layout(base);
  const ticks = s.nodes.filter((n) => n.type === "text" && /^\d+$/.test(n.content)).map((n) => +n.content);
  assert.equal(Math.max(...ticks), 1000, "domain max 1000 honored (nice would give 500)");
  // the 407 bar occupies ~40.7% of the 62 bar's plot... compare ratio to domain
  const bars = s.nodes.filter((n) => n.type === "rect");
  const b407 = bars.find((b) => b.meta.datum.pop === 407), b62 = bars.find((b) => b.meta.datum.pop === 62);
  assert.ok(Math.abs(b407.width / b62.width - 407 / 62) < 0.05, "lengths proportional within the declared domain");
  // shared-domain guarantee: two layouts with different data but same domain give equal px-per-unit
  const other = JSON.parse(JSON.stringify(base)); other.rows = [{ age: "a", pop: 95 }, { age: "b", pop: 73 }];
  const s2 = layout(other);
  const b95 = s2.nodes.filter((n) => n.type === "rect").find((b) => b.meta.datum.pop === 95);
  assert.ok(Math.abs(b407.width / 407 - b95.width / 95) < 0.01, "identical domains -> identical px-per-unit across charts");
  for (const domain of [[0], [1, 0], [0, "1000"]]) {
    const invalid = structuredClone(base); invalid.graphic.encoding.x.scale.domain = domain;
    assert.throws(() => layout(invalid), /exactly two ascending finite numbers/);
  }
});

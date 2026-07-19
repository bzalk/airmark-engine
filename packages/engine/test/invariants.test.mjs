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

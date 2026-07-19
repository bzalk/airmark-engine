// Generates fixtures/manifest.json — the machine-readable gallery/picker index.
// Regenerate whenever fixtures change: npm run gallery:gen
import { readdirSync, readFileSync, writeFileSync } from "node:fs";

// Curated presentation metadata keyed by fixture name. A fixture missing here
// still appears (fail-open with defaults) so the manifest can't silently drop cases.
const META = {
  "bar-vertical-letter-frequency":      { title: "Bar chart (vertical)",            category: "Bars",       blurb: "Nominal x, quantitative y, grid and formatted ticks." },
  "bar-horizontal-sorted-negx":         { title: "Bar chart (horizontal, sorted)",  category: "Bars",       blurb: "Quantitative x, nominal y, sorted descending with -x." },
  "bar-horizontal-uniform-text-overlay":{ title: "Labeled bars (text overlay)",     category: "Bars",       blurb: "Layered graphic: uniform bars with in-bar text labels, axes suppressed." },
  "bar-stacked-zero":                   { title: "Stacked bars",                    category: "Bars",       blurb: "stack: zero with color segments and legend." },
  "bar-grouped-xoffset":                { title: "Grouped bars",                    category: "Bars",       blurb: "xOffset inner bands, one palette color per group." },
  "bar-selection-condition-highlight":  { title: "Selectable bars (highlight)",     category: "Interaction",blurb: "Point selection with condition color: picked vs muted." },
  "bar-horizontal-reversed-x-pyramid":  { title: "Population pyramid (half)",       category: "Diverging",  blurb: "scale.reverse mirrored axis — pair two of these for a full pyramid.", pairWith: "https://github.com/bzalk/AIRspec/blob/main/conformance/valid/v05-mirrored-pyramid.json" },
  "histogram-binned-count":             { title: "Histogram",                       category: "Distribution", blurb: "bin: maxbins with count aggregation on nice-step edges." },
  "boxplot-price-by-category":          { title: "Box plot",                        category: "Distribution", blurb: "Normative R-7 quartiles, 1.5×IQR whiskers, outlier points." },
  "tick-strip-horizontal":              { title: "Strip plot",                      category: "Distribution", blurb: "Tick marks on a quantitative axis per category row." },
  "scatter-bubble-color-size":          { title: "Bubble scatter",                  category: "Scatter",    blurb: "Two quantitative axes, area-proportional size channel, legend." },
  "scatter-log-x-skewed":               { title: "Scatter (log x)",                 category: "Scatter",    blurb: "Log scale with decade ticks for right-skewed data." },
  "line-multiseries-temporal":          { title: "Multi-series line (time)",        category: "Lines",      blurb: "Temporal axis with UTC tick ladder, one path per series." },
  "layered-bar-line-trend":             { title: "Bar + line combo",                category: "Lines",      blurb: "Layered marks sharing band x scale." },
  "arc-pie-legend":                     { title: "Pie chart",                       category: "Parts of a whole", blurb: "Arc marks with theta encoding and legend." },
  "arc-donut":                          { title: "Donut chart",                     category: "Parts of a whole", blurb: "Arc with innerRadius ring." },
  "facet-column-small-multiples":       { title: "Small multiples (facets)",        category: "Composition", blurb: "Column facets with shared scales and panel titles." },
};

const RAW = "https://raw.githubusercontent.com/bzalk/airmark-engine/main/fixtures";
const entries = [];
for (const f of readdirSync("fixtures/cases").filter((f) => f.endsWith(".json")).sort()) {
  const name = f.replace(/\.json$/, "");
  const c = JSON.parse(readFileSync(`fixtures/cases/${f}`, "utf8"));
  const g = c.input.graphic;
  const units = g.layers ?? [g];
  const capabilities = new Set();
  for (const u of units) {
    const mark = typeof u.mark === "string" ? u.mark : u.mark.type;
    capabilities.add(`mark:${mark}`);
    for (const [ch, cc] of Object.entries(u.encoding ?? {})) {
      const c0 = Array.isArray(cc) ? cc[0] : cc;
      if (!c0) continue;
      if (c0.bin) capabilities.add("bin");
      if (c0.aggregate) capabilities.add(`aggregate:${c0.aggregate}`);
      if (c0.scale?.type && c0.scale.type !== "linear") capabilities.add(`scale:${c0.scale.type}`);
      if (c0.scale?.reverse) capabilities.add("scale:reverse");
      if (["facet","row","column"].includes(ch)) capabilities.add("facet");
      if (ch === "xOffset" || ch === "yOffset") capabilities.add("grouping");
      if (c0.stack) capabilities.add(`stack:${c0.stack}`);
      if (ch === "size") capabilities.add("size-channel");
    }
    if (u.selections?.length) capabilities.add("selection");
  }
  if (g.layers) capabilities.add("layers");
  const m = META[name] ?? { title: name, category: "Other", blurb: "" };
  entries.push({
    id: name,
    title: m.title, category: m.category, blurb: m.blurb,
    capabilities: [...capabilities].sort(),
    invariants: c.invariants ?? [],
    engineCase: `${RAW}/cases/${f}`,
    golden: `${RAW}/golden/${f}`,
    ...(m.pairWith ? { documentExample: m.pairWith } : {}),
  });
}
const manifest = {
  $comment: "Generated by scripts/gen-gallery-manifest.mjs — do not edit by hand. Regenerate with: npm run gallery:gen",
  version: JSON.parse(readFileSync("package.json", "utf8")).version,
  generatedFrom: "fixtures/cases",
  usage: {
    preview: "Fetch engineCase, call layout(input) from @airspec/airmark-engine, draw the scene graph. Rows are inline; no data broker needed.",
    generation: "For AI few-shot: prefer full AIRspec documents (documentExample where present, or conformance/valid in the AIRspec repo). Engine cases are graphics, not documents.",
  },
  charts: entries,
};
writeFileSync("fixtures/manifest.json", JSON.stringify(manifest, null, 2) + "\n");
console.log(`manifest: ${entries.length} chart types across ${new Set(entries.map((e) => e.category)).size} categories`);

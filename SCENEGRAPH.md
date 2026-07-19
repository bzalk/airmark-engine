# AIRMark Scene Graph — Companion Specification

Status: **Draft 1.0** — companion to AIRspec 1.1 §10 (AIRMark). Canonical home: the [AIRspec repository](https://github.com/bzalk/AIRspec), once stabilized. Reference implementation: [airmark-engine](https://github.com/bzalk/airmark-engine).

## Problem

AIRMark defines *what a chart means*; it deliberately does not define *where the pixels go*. Every Host therefore re-decides orientation, domains, ticks, bar positions, label truncation, and layer coordination — and re-fights the same rendering bugs. Porting a renderer to another language restarts the fight from zero.

This document closes that gap by specifying the **scene graph**: a deterministic, JSON-serializable tree of positioned primitives that a conforming layout engine MUST produce for a given `(graphic, rows, size, theme)` input. The scene graph is the contract between *layout* (hard, portable, specified here) and *drawing* (trivial, platform-specific, ~80 lines per platform).

Conformance is proven by **golden fixtures**: recorded inputs with expected scene graphs. An engine in any language conforms if its output matches the goldens within the tolerance policy below. Every rendering bug fixed in one implementation becomes a fixture, and every port inherits the fix as a test.

## 1. Coordinate system

* Origin at top-left of the graphic's outer box; +x right, +y down; units are CSS pixels.
* The engine receives an outer `width` and `height` and computes inner plot bounds by subtracting margins it derives from axis content (§6). Margins are outputs, not inputs.
* All emitted coordinates and dimensions MUST be rounded to **2 decimal places** at serialization.

## 2. Node vocabulary

A scene graph is `{ "width", "height", "nodes": SceneNode[] }`. Nodes render in array order (painter's algorithm). Unknown node types MUST cause a renderer error, not silent skipping.

| Node | Required | Optional |
| --- | --- | --- |
| `group` | `type`, `children[]` | `meta` |
| `rect` | `type`, `x`, `y`, `width`, `height`, `fill` | `rx`, `opacity`, `stroke`, `strokeWidth`, `meta` |
| `line` | `type`, `x1`, `y1`, `x2`, `y2`, `stroke` | `strokeWidth`, `strokeDash[]`, `opacity`, `meta` |
| `path` | `type`, `d`, (`stroke` or `fill`) | `strokeWidth`, `fill`, `stroke`, `opacity`, `meta` |
| `circle` | `type`, `cx`, `cy`, `r`, `fill` | `opacity`, `stroke`, `strokeWidth`, `meta` |
| `text` | `type`, `x`, `y`, `content`, `fill`, `fontSize`, `anchor` (`start`\|`middle`\|`end`) | `baseline` (`alphabetic`\|`middle`\|`hanging`), `angle` (deg, rotate about x,y), `fontWeight`, `meta` |

`path.d` uses only `M`, `L`, `Z` commands with absolute coordinates (deterministic; no curves in Draft 1.0 — line interpolation smoothing is a renderer MAY, applied visually without changing the scene graph). Arcs (pie/donut slices) are emitted as **polyline approximations with 4° segments**, angles measured clockwise from 12 o'clock; this keeps arc geometry exactly comparable across languages.

### 2.1 Interaction metadata

`meta` is optional, JSON-only, and carries no behavior: `{ "role": "mark" | "axis" | "grid" | "label" | "title", "datum": {…row}, "selection": "<selectionId>", "fields": ["region"] }`. Renderers wire events using `meta.selection`/`meta.fields`; the engine never emits handlers.

## 3. Engine input

```
layout(input) -> SceneGraph
input = { graphic, rows, width, height, theme?, measureText? }
```

* `graphic` — a **validated** AIRMark graphic (Layers 1–4 already passed). Engines MUST NOT re-validate security properties and MUST NOT accept unvalidated documents in Host pipelines.
* `rows` — flat objects keyed by field/alias, as returned by the Data Broker.
* `theme` — resolved visual defaults: `{ palette: [c0…], hue, fontSize, axisColor, gridColor, labelColor }`. The Host applies the AIRspec §10.1 resolution order *before* calling the engine; the engine consumes one final theme.
* `measureText` — see §5.

The engine is a pure function: same input, same output, no I/O, no clock, no randomness, no locale access.

## 4. Determinism rules (normative)

### 4.1 Tick and nice-domain algorithm

For a quantitative axis over data extent `[dmin, dmax]` and axis pixel length `L`:

```
targetCount = clamp(floor(L / 50), 2, 10)
if bars are encoded on this axis, or scale.zero == true: dmin = min(dmin, 0), dmax = max(dmax, 0)
if dmin == dmax: dmax = dmin + 1
span  = dmax - dmin
raw   = span / targetCount
mag   = 10 ^ floor(log10(raw))
step  = mag * pick(raw / mag)     where pick(r): r <= 1→1, r <= 2→2, r <= 5→5, else 10
niceMin = floor(dmin / step) * step
niceMax = ceil (dmax / step) * step
ticks  = niceMin, niceMin+step, … , niceMax   (inclusive; compute as niceMin + i*step to avoid drift)
```

`scale.nice: false` uses `[dmin, dmax]` as the domain but the same tick step. `scale.reverse: true` flips the scale's pixel range **after** all domain and tick computation — same nice domain, same tick values, mirrored positions (a bar zero-baseline lands on the flipped side automatically); on band/ordinal scales it reverses the resolved domain order, composing with (not replacing) `sort`. Applies uniformly to linear, log, band, and scatter axes. Tick label formatting: minimal decimals sufficient for `step` (trailing zeros trimmed), `-0` normalized to `0`. Temporal axes use the same algorithm over epoch milliseconds; labels format per §4.4.

### 4.2 Band scale

For `n` domain values over pixel length `L` with `paddingInner = 0.15`, `paddingOuter = 0.1` (theme MAY override; fixtures pin these defaults):

```
step = L / (n - paddingInner + 2*paddingOuter)     ; n>0
bandwidth = step * (1 - paddingInner)
position(i) = round2(start + step*paddingOuter + i*step)
```

### 4.3 Ordering and color

* Nominal domain order: data order after applying `encoding.sort` (`"ascending"`/`"descending"` by the channel's own field, `"y"`/`"-y"`/`"x"`/`"-x"` by the referenced channel's value, explicit array verbatim, `null` = data order). Ties preserve input order (stable sort).
* Color resolution order: `mark.color` wins; else a `color` channel with `field` maps domain values in domain order (cycling) to the channel's **`scale.range` if declared, otherwise `theme.palette`**; else single-series marks use `theme.hue`. `scale.scheme` is unimplemented and MUST error, never silently fall back. `condition` on a selection resolves at layout time from `input.selectionState` when provided, else the non-condition value.

### 4.4 Time ticks

Temporal axes use a fixed step ladder over UTC epoch milliseconds: `1s, 5s, 15s, 30s, 1m, 5m, 15m, 30m, 1h, 3h, 6h, 12h, 1d, 2d, 7d`, then calendar-aware `1/3/6 months` and `1, 2, 5, 10, …` years. The engine picks the first ladder step where `span/step ≤ targetCount` (`targetCount = clamp(floor(L/80), 2, 10)`); month/year ticks fall on UTC month/year boundaries walked from the floored start. Label format is chosen by the realized step: ≥ ~1 year → `YYYY`; ≥ ~1 month → `MMM YYYY`; ≥ 1 day → `MMM D`; else `HH:mm` — UTC, English 3-letter months, ASCII digits. Temporal parsing accepts ISO strings (with `YYYY` and `YYYY-MM` normalized to the 1st) and epoch numbers; anything else is an error.

### 4.5 Log scale

`scale.type: "log"` (point/line/scatter axes only; bars and stacks reject it — they need a meaningful zero) requires a strictly positive domain and errors otherwise. Nice domain snaps to the enclosing powers of 10; ticks fall on every in-domain `10^k`, adding `2·10^k` and `5·10^k` when fewer than four decades are visible. Position is linear in `log10(v)`. `sqrt`/`pow` remain unimplemented (engines MUST error, not fall back to linear).

### 4.6 Formatting

Numeric and temporal tick/label formatting is engine-owned and locale-free: ASCII digits, `.` decimal separator, no grouping separators in Draft 1.0; temporal labels use UTC and the shortest of `YYYY`, `MMM YYYY`, `MMM D`, `HH:mm` that distinguishes adjacent ticks (`MMM` = English 3-letter). AIRspec §11 format objects, when present, are applied by the engine using these same locale-free rules.

## 5. Text measurement (normative default)

Layout depends on text width (margins, truncation, angled labels). Platforms disagree on real metrics, so:

* The engine MUST accept an injected `measureText(content, fontSize, fontWeight) -> widthPx`.
* The default, and the ONLY measurer used for golden fixtures, is the **width-class estimator**: `width = fontSize × Σ w(c)` with `w(c)`: `iljI.,':;|!` → 0.28; `ftr()[]{}"` → 0.34; space → 0.30; digits → 0.55; `MWmw` → 0.85; other uppercase → 0.68; all else → 0.52. Height = `fontSize` × 1.2.
* Label truncation appends `…` (single char, class 0.52) and truncates to fit the available box; truncation decisions in goldens are therefore deterministic.
* Hosts MAY inject real platform metrics in production; doing so changes layout legally but is out of scope for conformance.

## 6. Layout obligations

Given the inputs, a conforming engine MUST: detect orientation (nominal↔quantitative positional pair; both-quantitative = scatter/line semantics; `bin` on a quantitative channel produces interval bars); share one scale per positional channel and one color scale across all layers of a graphic; derive margins from measured tick labels, axis titles, angled-label extents, and the legend; emit grid lines (when `axis.grid`) before marks, marks in layer order, axis lines/ticks/labels/titles after marks; suppress an axis entirely when `axis` is `null`; and emit per-mark `meta.datum` for every data-driven node.

### 6.1 Stacking and grouping

`stack: "zero" | "normalize"` on the quantitative channel, with a color field present, replaces per-row bars with per-(category, color) segments: within each category, segments accumulate in **color-domain order** with no gaps; `normalize` divides by the category total and defaults the axis to percent labels. `xOffset`/`yOffset` with a field nests an inner band scale (`paddingInner 0.10`, `paddingOuter 0.05`) inside each outer band, in the offset field's data order.

### 6.2 Legends

A color channel with a `field` and `legend ≠ null` reserves right margin `min(maxLabelWidth, 120) + 32` and emits, top-aligned with the plot: a 10×10 swatch (`rx 2`) plus a label per color-domain value, row height `fontSize × 1.6`, labels truncated at 120px. Legends inside facets are not yet specified (engines MUST error rather than improvise).

### 6.3 Facets (small multiples)

A `row`, `column`, or `facet` channel partitions rows by its field (panel order: `sort` if given, else ascending). Panel grids: `column` → one row of k panels; `row` → one column; `facet` → wrap at `ceil(sqrt(k))` columns; 16px gaps, and a bold panel title (`fontWeight 600`) centered 6px above each panel. **All panels share the quantitative extent, nominal domain, and color domain computed over the full dataset** — per-panel scales are non-conformant. Each panel then lays out independently within its rect with absolute coordinates.

### 6.4 Scatter and the size channel

When **both positional channels are quantitative** (no bin, no timeUnit), the graphic is a scatter: each axis gets its own continuous linear scale via the §4.1 algorithm, with `includeZero` only when that channel sets `scale.zero: true` (points do not force zero the way bars do). Both axes emit ticks, labels, and titles.

A `size` channel with a quantitative field maps **area-linearly** to point radius over the field's data extent: `r = sqrt(rMin² + t·(rMax² − rMin²))` with `t = (v − lo)/(hi − lo)`, `rMin = 2`, `rMax = 12` (normative — area proportionality, not radius proportionality, so a doubled value reads as a doubled dot). Without a size channel, radius is `sqrt(mark.size)` or 3.5.

### 6.5 Composite marks: boxplot

`boxplot` groups **raw rows** by the nominal channel's field and computes statistics in-engine (datasets stay simple `list` operations; broker aggregations are not involved). The statistics are normative for cross-language conformance:

* Quartiles by linear interpolation on the sorted sample (R-7 / inclusive): `q(p) = s[⌊h⌋] + (h−⌊h⌋)(s[⌈h⌉]−s[⌊h⌋])` with `h = (n−1)p`.
* Fences at `q1 − 1.5·IQR` and `q3 + 1.5·IQR`; whiskers extend to the most extreme data points **within** the fences; points beyond are outliers.

Composition per category, in emission order: lower whisker rule, upper whisker rule, two whisker caps (half the box width), the box rect from `q1` to `q3` (width = `bandwidth × 0.7`, mark fill, axis-color stroke), a white 2px median line, then outlier circles (`r 2.5`, opacity 0.7). Box `meta.datum` carries the category plus `q1/median/q3/whiskerLo/whiskerHi` (rounded); outlier datum carries `value` and `outlier: true`. Both orientations follow the standard orientation rule. `errorbar`/`errorband` remain unimplemented pending fixtures.

### 6.6 What is NOT in the graphic: document-level arrangement

Multiple charts beside/above one another are **document layout** (AIRspec §8's 12-column grid), never in-graphic composition. Appendix A specifies the deterministic grid algorithm so hosts on any platform arrange components identically.

## 7. Golden fixture format and tolerance

A fixture is `cases/<name>.json`:

```json
{ "name": "letter-frequency-vertical",
  "airspec": "1.1",
  "input": { "graphic": {…}, "rows": [...], "width": 720, "height": 420,
             "theme": { "palette": ["#3264D6","#26A69A","#F59E0B","#DC5A5A"],
                        "hue": "#3264D6", "fontSize": 11,
                        "axisColor": "#4A576C", "gridColor": "#E1E7F0",
                        "labelColor": "#4A576C" } },
  "invariants": ["optional human-readable expectations"] }
```

with expected output `golden/<name>.json` (a SceneGraph). Comparison rules:

* Node count, order, types, `content`, `fill`/`stroke`, `anchor`, and `meta` MUST match exactly.
* Every numeric property MUST match within **ε = 0.5 px** (cross-implementation floating-point allowance; the reference engine reproduces its own goldens exactly).
* A fixture change requires the same discipline as a spec change: goldens are regenerated only with a reviewed rationale, never to silence a failing port.

Every rendering bug fixed in any conforming implementation SHOULD be captured as a new fixture before the fix is merged.

## 8. Appendix A — Document grid algorithm (normative for the reference helper)

`layoutGrid(items, options)` implements AIRspec §8.2 as a pure function. Breakpoints: width `< 640` = mobile, `< 1024` = tablet, else desktop; the effective span is `spanMobile ?? spanTablet ?? span` (mobile), `spanTablet ?? span` (tablet), `span` (desktop), clamped to `1..columns` (default 12), default span = full width. Column width is `(containerWidth − gap×(columns−1)) / columns` with `gap` default 16. Items pack left-to-right in document order; an item whose span would overflow the current row starts a new row (no reordering, no backfill). An item's height is `clamp(height ?? 300, minHeight, maxHeight)`; the **row height is the max of its items**, and every box in the row stretches to it. Output boxes carry `x, y, width, height, row`, rounded to 2dp.

## 9. Explicit non-goals

The scene graph does not include: animation or transitions; event handlers or behavior of any kind; CSS, classes, or stylesheets; fonts beyond a size/weight pair (font *family* is renderer-owned); accessibility trees (renderers MUST add platform-appropriate a11y from `meta`); curve interpolation geometry; canvas/GPU-specific constructs; or any property whose value is a string to be evaluated. Determinism is load-bearing: any proposal that would make layout depend on platform, locale, wall clock, or randomness is rejected by construction.

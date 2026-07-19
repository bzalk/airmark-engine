# AIRMark Scene Graph — Companion Specification

Status: **Draft 1.0** — companion to AIRspec 1.1 §10 (AIRMark). Canonical home: the AIRspec repository, once stabilized. Reference implementation: `airmark-engine`.

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

`path.d` uses only `M`, `L`, `Z` commands with absolute coordinates (deterministic; no curves in Draft 1.0 — line interpolation smoothing is a renderer MAY, applied visually without changing the scene graph).

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

`scale.nice: false` uses `[dmin, dmax]` as the domain but the same tick step. Tick label formatting: minimal decimals sufficient for `step` (trailing zeros trimmed), `-0` normalized to `0`. Temporal axes use the same algorithm over epoch milliseconds; labels format per §4.4.

### 4.2 Band scale

For `n` domain values over pixel length `L` with `paddingInner = 0.15`, `paddingOuter = 0.1` (theme MAY override; fixtures pin these defaults):

```
step = L / (n - paddingInner + 2*paddingOuter)     ; n>0
bandwidth = step * (1 - paddingInner)
position(i) = round2(start + step*paddingOuter + i*step)
```

### 4.3 Ordering and color

* Nominal domain order: data order after applying `encoding.sort` (`"ascending"`/`"descending"` by the channel's own field, `"y"`/`"-y"`/`"x"`/`"-x"` by the referenced channel's value, explicit array verbatim, `null` = data order). Ties preserve input order (stable sort).
* Color: `mark.color` wins; else a `color` channel with `field` maps domain values to `theme.palette` in domain order (cycling); else single-series marks use `theme.hue`. `condition` on a selection resolves at layout time from `input.selectionState` when provided, else the non-condition value.

### 4.4 Formatting

Numeric and temporal tick/label formatting is engine-owned and locale-free: ASCII digits, `.` decimal separator, no grouping separators in Draft 1.0; temporal labels use UTC and the shortest of `YYYY`, `MMM YYYY`, `MMM D`, `HH:mm` that distinguishes adjacent ticks (`MMM` = English 3-letter). AIRspec §11 format objects, when present, are applied by the engine using these same locale-free rules.

## 5. Text measurement (normative default)

Layout depends on text width (margins, truncation, angled labels). Platforms disagree on real metrics, so:

* The engine MUST accept an injected `measureText(content, fontSize, fontWeight) -> widthPx`.
* The default, and the ONLY measurer used for golden fixtures, is the **width-class estimator**: `width = fontSize × Σ w(c)` with `w(c)`: `iljI.,':;|!` → 0.28; `ftr()[]{}"` → 0.34; space → 0.30; digits → 0.55; `MWmw` → 0.85; other uppercase → 0.68; all else → 0.52. Height = `fontSize` × 1.2.
* Label truncation appends `…` (single char, class 0.52) and truncates to fit the available box; truncation decisions in goldens are therefore deterministic.
* Hosts MAY inject real platform metrics in production; doing so changes layout legally but is out of scope for conformance.

## 6. Layout obligations

Given the inputs, a conforming engine MUST: detect orientation (nominal↔quantitative positional pair; both-quantitative = scatter/line semantics; `bin` on a quantitative channel produces interval bars); share one scale per positional channel and one color scale across all layers of a graphic; derive margins from measured tick labels, axis titles, and angled-label extents; emit grid lines (when `axis.grid`) before marks, marks in layer order, axis lines/ticks/labels/titles after marks; suppress an axis entirely when `axis` is `null`; and emit per-mark `meta.datum` for every data-driven node.

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

## 8. Explicit non-goals

The scene graph does not include: animation or transitions; event handlers or behavior of any kind; CSS, classes, or stylesheets; fonts beyond a size/weight pair (font *family* is renderer-owned); accessibility trees (renderers MUST add platform-appropriate a11y from `meta`); curve interpolation geometry; canvas/GPU-specific constructs; or any property whose value is a string to be evaluated. Determinism is load-bearing: any proposal that would make layout depend on platform, locale, wall clock, or randomness is rejected by construction.

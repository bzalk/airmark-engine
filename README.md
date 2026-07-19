# airmark-engine

**Reference implementation of the [AIRMark Scene Graph](./SCENEGRAPH.md) — the portable layout layer for [AIRspec](https://airspec.dev) charts.**

AIRMark defines what a chart *means*. This engine decides where every pixel *goes* — deterministically, in pure TypeScript with **zero runtime dependencies** — and emits a JSON scene graph of positioned primitives. Drawing the scene graph on any platform is ~80 lines.

```text
validated AIRMark graphic + rows + size + theme
        │
        ▼   @airspec/airmark-engine        (all the hard decisions:
   layout(input)                            orientation, domains, ticks,
        │                                   bars, layers, labels, colors)
        ▼
   SceneGraph  { nodes: [ {type:"rect", x:140, y:22, …}, … ] }
        │
        ├─▶ @airspec/airmark-react   thin JSX shell (this repo)
        ├─▶ @airspec/airmark-svg     SVG string, server-side export (this repo)
        └─▶ your platform            Canvas, Svelte, SwiftUI, Compose, a
                                     Python port — walk the tree, draw nodes
```

## Why a scene graph

Every rendering bug lives in layout, not drawing: orientation detection, shared scales across layers, nice domains, tick generation, label truncation, bar geometry. By specifying layout as a deterministic function with **golden fixtures** — recorded `(input) → expected scene graph` pairs — every bug fixed here becomes a portable test. A port in another language doesn't reverse-engineer this code; it implements until the fixtures pass.

Determinism is enforced by construction: no locale, no clock, no randomness, coordinates rounded to 2dp, a normative tick algorithm, and injected text measurement with a specified default estimator (see SCENEGRAPH.md §4–§5).

## Packages

| Package | What | Deps |
| --- | --- | --- |
| [`@airspec/airmark-engine`](https://www.npmjs.com/package/@airspec/airmark-engine) | `layout(input) → SceneGraph`. Marks: bar (vertical/horizontal/binned/**stacked/grouped**), line/area (**multi-series**), point, rule, text overlay, **arc/pie/donut**, **boxplot** (normative R-7 quartiles, 1.5×IQR whiskers, outliers); layers; **facets (small multiples with shared scales)**; **legends**; **temporal axes** (UTC tick ladder); channel aggregates + explicit `aggregate`/`timeUnit`/`fold`/`sort`/`bin` transforms; structured-predicate filters; selection `condition` resolution; axes/grid/titles; **`layoutGrid`** for the AIRspec §8 document grid (charts beside/above each other). | none |
| [`@airspec/airmark-svg`](https://www.npmjs.com/package/@airspec/airmark-svg) | `toSVG(scene) → string` | engine |
| [`@airspec/airmark-react`](https://www.npmjs.com/package/@airspec/airmark-react) | `<AirmarkChart {...input} onSelect={…} />` | engine, React ≥18 (peer) |

## Quickstart

Install the package for your target renderer:

```bash
npm install @airspec/airmark-react
# or: npm install @airspec/airmark-engine @airspec/airmark-svg
```

To work on this repository:

```bash
npm install
npm test              # build + invariant tests
npm run goldens:check # build + compare against golden fixtures (ε = 0.5px)
```

React usage:

```tsx
import { AirmarkChart } from "@airspec/airmark-react";

<AirmarkChart
  graphic={validatedGraphic}   // Layers 1–4 MUST pass before this point
  rows={brokerRows}
  width={720} height={420}
  theme={resolvedTheme}         // host applies AIRspec §10.1 resolution order first
  selectionState={selections}
  onSelect={({ selection, datum, fields }) => dispatch(selection, datum, fields)}
/>
```

The engine consumes **validated** graphics only — it is a layout engine, not a validator. Run the AIRspec validation pipeline (and its conformance suite) upstream.

## The workflow: fixture first, always

Adding a mark, scale, or behavior — or fixing a bug — follows one loop:

1. Write a fixture in `fixtures/cases/` capturing the input (and an `invariants` list of human-checkable facts).
2. Add invariant assertions in `packages/engine/test/` that encode *why* the expected output is correct.
3. Implement until tests pass; unimplemented paths must `throw` (deny by default — the engine never silently skips).
4. `npm run goldens:gen`, eyeball the rendered SVG, commit case + golden + code together.

Goldens are contract: regenerate only with a reviewed rationale, never to silence a failing port (SCENEGRAPH.md §7).

Current fixtures (11): vertical/horizontal bars, uniform-bar text overlays, binned histograms, layered bar+line, selection-condition highlighting, stacked bars, grouped bars, pie + donut, multi-series temporal lines with legends, and faceted small multiples — plus grid-layout tests. Known-unimplemented (throwing, awaiting fixtures): legends inside facets, temporal-axis bars, `stack`/`window`/`pivot`/`flatten` explicit transforms, `errorband`/`errorbar`, interval-selection brushing.

## Relationship to AIRspec

`SCENEGRAPH.md` is drafted here and moves to the [AIRspec repository](https://github.com/bzalk/AIRspec) (with the golden fixtures) once stabilized — fixtures are contract, engines are implementations. This repo versions against spec releases ("implements AIRspec 1.1"). Nothing in AIRspec requires this engine; it exists so implementers don't re-fight solved layout bugs.

## License

MIT

Release maintainers: see [PUBLISHING.md](./PUBLISHING.md) for npm package and trusted-publishing instructions.

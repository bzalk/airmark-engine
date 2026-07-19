# @airspec/airmark-engine

Pure, deterministic AIRMark layout engine. It accepts a validated AIRMark graphic, trusted broker rows, dimensions, and a resolved theme, then returns a portable JSON scene graph.

```ts
import { layout } from "@airspec/airmark-engine";

const scene = layout({ graphic, rows, width: 720, height: 420, theme });
```

The package has no runtime dependencies. AIRspec validation Layers 1–4 must pass before calling the engine.

See the [repository](https://github.com/bzalk/airmark-engine) for documentation, fixtures, and the AIRMark Scene Graph draft.

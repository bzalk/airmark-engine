# @airspec/airmark-react

Thin React renderer for AIRMark graphics, backed by `@airspec/airmark-engine`.

```bash
npm install @airspec/airmark-react
```

```tsx
import { AirmarkChart } from "@airspec/airmark-react";

<AirmarkChart
  graphic={validatedGraphic}
  rows={brokerRows}
  width={720}
  height={420}
  theme={resolvedTheme}
  onSelect={handleSelection}
/>
```

React 18 or newer is required. AIRspec validation Layers 1–4 must pass before rendering.

## Responsive containers

Layout pixels must equal display pixels. `AirmarkChart` renders its supplied `width` and `height` at scale 1; do not CSS-stretch its SVG. Use `AirmarkChartAuto` when the surrounding card determines the size:

```tsx
import { AirmarkChartAuto } from "@airspec/airmark-react";

<div style={{ width: "100%", height: 420 }}>
  <AirmarkChartAuto
    graphic={validatedGraphic}
    rows={brokerRows}
    theme={resolvedTheme}
    onSelect={handleSelection}
  />
</div>
```

The auto-sized component measures its content box with `ResizeObserver` and re-runs layout when that box changes instead of scaling an already-laid-out chart.

See the [repository](https://github.com/bzalk/airmark-engine) for documentation and examples.

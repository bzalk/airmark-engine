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

See the [repository](https://github.com/bzalk/airmark-engine) for documentation and examples.

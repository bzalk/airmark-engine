import { test } from "node:test";
import assert from "node:assert/strict";
import { layout } from "@airspec/airmark-engine";
import { toSVG } from "../dist/index.js";

test("toSVG emits escaped native title tooltips", () => {
  const scene = layout({
    width: 400,
    height: 300,
    rows: [{ category: "beauty & wellness", post_count: 12, share: 42 }],
    graphic: { mark: { type: "arc", innerRadius: 0.5 }, encoding: {
      theta: { field: "post_count", type: "quantitative" },
      color: { field: "category", type: "nominal" },
      tooltip: [
        { field: "category", title: "Category" },
        { field: "share", title: "Share", format: { type: "percent", maximumFractionDigits: 0 } },
      ],
    } },
  });
  const svg = toSVG(scene);
  assert.match(svg, /<title>Category: beauty &amp; wellness\nShare: 42%<\/title>/);
});

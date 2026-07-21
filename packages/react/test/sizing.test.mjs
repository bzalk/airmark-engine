import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AirmarkChart } from "../dist/index.js";

const fixture = JSON.parse(readFileSync(
  new URL("../../../fixtures/cases/scatter-bubble-color-size.json", import.meta.url),
  "utf8",
)).input;

test("AirmarkChart renders layout pixels at scale 1", () => {
  const markup = renderToStaticMarkup(createElement(AirmarkChart, {
    ...fixture,
    width: 1400,
    height: 420,
  }));

  assert.match(markup, /<svg[^>]*width="1400"/);
  assert.match(markup, /<svg[^>]*height="420"/);
  assert.match(markup, /<svg[^>]*viewBox="0 0 1400 420"/);
  assert.doesNotMatch(markup, /width="100%"/);
});

test("AirmarkChart emits native title tooltips and transition styles", () => {
  const markup = renderToStaticMarkup(createElement(AirmarkChart, {
    width: 400,
    height: 300,
    rows: [{ category: "beauty", post_count: 12, share: 42 }],
    graphic: { mark: "bar", encoding: {
      x: { field: "category", type: "nominal" },
      y: { field: "post_count", type: "quantitative" },
      tooltip: [
        { field: "category", title: "Category" },
        { field: "share", title: "Share", format: { type: "percent", maximumFractionDigits: 0 } },
      ],
    } },
    transitionMs: 250,
  }));
  assert.match(markup, /<title>Category: beauty\nShare: 42%<\/title>/);
  assert.match(markup, /transition:[^;]*250ms/);
});

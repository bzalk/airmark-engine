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

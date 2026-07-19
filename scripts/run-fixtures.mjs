// Compares engine output to goldens under the SCENEGRAPH.md §7 tolerance policy:
// exact match for types/order/strings/meta, epsilon 0.5px for numerics.
import { readdirSync, readFileSync } from "node:fs";
import { layout } from "../packages/engine/dist/index.js";

const EPS = Number(process.env.AIRMARK_EPS ?? 0.5);
let failures = 0;

function diff(path, a, b, errs) {
  if (typeof a === "number" && typeof b === "number") {
    if (Math.abs(a - b) > EPS) errs.push(`${path}: ${a} vs ${b}`);
  } else if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) { errs.push(`${path}: length ${a.length} vs ${b.length}`); return; }
    a.forEach((v, i) => diff(`${path}[${i}]`, v, b[i], errs));
  } else if (a && b && typeof a === "object" && typeof b === "object") {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) diff(`${path}.${k}`, a[k], b[k], errs);
  } else if (a !== b) errs.push(`${path}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
}

for (const f of readdirSync("fixtures/cases").filter((f) => f.endsWith(".json"))) {
  const c = JSON.parse(readFileSync(`fixtures/cases/${f}`, "utf8"));
  const golden = JSON.parse(readFileSync(`fixtures/golden/${f}`, "utf8"));
  const errs = [];
  try { diff("$", layout(c.input), golden, errs); } catch (e) { errs.push(`threw: ${e.message}`); }
  if (errs.length) { failures++; console.log(`FAIL ${f}\n  ${errs.slice(0, 5).join("\n  ")}${errs.length > 5 ? `\n  …${errs.length - 5} more` : ""}`); }
  else console.log(`ok   ${f}`);
}
process.exit(failures ? 1 : 0);

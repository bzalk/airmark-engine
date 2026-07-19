// Regenerates golden scene graphs from fixture cases.
// Goldens are contract: regenerate only with a reviewed rationale (SCENEGRAPH.md §7).
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { layout } from "../packages/engine/dist/index.js";

for (const f of readdirSync("fixtures/cases").filter((f) => f.endsWith(".json"))) {
  const c = JSON.parse(readFileSync(`fixtures/cases/${f}`, "utf8"));
  const scene = layout(c.input);
  writeFileSync(`fixtures/golden/${f}`, JSON.stringify(scene, null, 2) + "\n");
  console.log(`golden: ${f}  (${scene.nodes.length} nodes)`);
}

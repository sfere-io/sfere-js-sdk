// Gzip budget for the script-tag bundle. Fails (exit 1) when dist/cdn/sfere.min.js is over budget.
// Budget = size measured on 2026-09-28 for v0.1.0 (46,162 B gzip -9) + ~10% headroom.
// Raise it deliberately, in a reviewed change, when a dependency upgrade needs more room.
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

const FILE = "dist/cdn/sfere.min.js";
const BUDGET_BYTES = 50_700;

let source;
try {
  source = readFileSync(FILE);
} catch {
  console.error(`size: ${FILE} not found; run \`npm run build\` first.`);
  process.exit(1);
}

const gzip = gzipSync(source, { level: 9 }).length;
const kb = (n) => `${(n / 1024).toFixed(2)} KiB`;
const pct = ((gzip / BUDGET_BYTES) * 100).toFixed(1);
console.log(
  `size: ${FILE} raw ${source.length} B (${kb(source.length)}), gzip ${gzip} B (${kb(gzip)}), ` +
    `budget ${BUDGET_BYTES} B (${kb(BUDGET_BYTES)}), ${pct}% used`,
);
if (gzip > BUDGET_BYTES) {
  console.error(`size: over budget by ${gzip - BUDGET_BYTES} B`);
  process.exit(1);
}

import { readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";

const roots = ["apps", "src", "scripts", "tests"];
const files = [];

async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) await collect(fullPath);
    else if (/\.(mjs|js)$/.test(entry.name)) files.push(fullPath);
  }
}

for (const root of roots) await collect(root);
for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log(`Sintaksis tekshiruvi: PASS (${files.length} fayl)`);

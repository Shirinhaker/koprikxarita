import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const dist = path.resolve("dist");
await rm(dist, { recursive: true, force: true });
await mkdir(path.join(dist, "apps/api"), { recursive: true });
await mkdir(path.join(dist, "apps/web"), { recursive: true });
await cp("apps/web/public", path.join(dist, "apps/web/public"), { recursive: true });
await cp("apps/api/src", path.join(dist, "apps/api/src"), { recursive: true });
await cp("src", path.join(dist, "src"), { recursive: true });
await cp("database", path.join(dist, "database"), { recursive: true });
await cp("data", path.join(dist, "data"), { recursive: true });
await writeFile(path.join(dist, "package.json"), JSON.stringify({
  name: "koprik-xarita-build-0003",
  private: true,
  type: "module",
  scripts: { start: "node apps/api/src/server.mjs" },
}, null, 2) + "\n", "utf8");
await writeFile(path.join(dist, "BUILD.txt"), `Ko‘prik Xarita BUILD 0003\nBuilt: ${new Date().toISOString()}\n`, "utf8");
console.log("BUILD 0003 tayyor: dist/");

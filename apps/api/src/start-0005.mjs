import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JsonBuildingRepository } from "../../../src/storage/json-building-repository.mjs";
import { MicrosoftImportProcessManager, resolveStoragePaths } from "./server-0005.mjs";

export function microsoftAutoImportEnabled(value = process.env.MICROSOFT_AUTO_IMPORT) {
  return ["1", "true", "on", "yes"].includes(String(value ?? "false").trim().toLowerCase());
}

export async function waitForHealth(url, { fetchImpl = fetch, attempts = 60, delayMs = 500 } = {}) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetchImpl(url);
      if (response.ok) return true;
      lastError = new Error(`Health HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw lastError ?? new Error("Server health tekshiruvi tugadi");
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  const projectRoot = path.resolve(path.dirname(currentFile), "../../..");
  const port = Number(process.env.PORT ?? 4100);
  const jwtSecret = process.env.JWT_SECRET ?? "development-only-secret-change-me";
  const storage = resolveStoragePaths({ projectRoot, env: process.env });

  const serverProcess = spawn(process.execPath, [path.join(projectRoot, "apps/api/src/server-0005.mjs")], {
    cwd: projectRoot,
    env: process.env,
    stdio: ["ignore", "inherit", "inherit"],
  });

  const stopServer = (signal) => {
    if (!serverProcess.killed) serverProcess.kill(signal);
  };
  process.on("SIGTERM", () => stopServer("SIGTERM"));
  process.on("SIGINT", () => stopServer("SIGINT"));
  serverProcess.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exit(code ?? 1);
  });

  // To‘liq viloyat importi deployment startini og‘irlashtirmasligi uchun
  // avtomatik import standart holatda O‘CHIQ. Administrator panelidagi
  // “Microsoft binolarini yuklash” tugmasi orqali boshqariladi.
  if (microsoftAutoImportEnabled()) {
    waitForHealth(`http://127.0.0.1:${port}/api/health`).then(async () => {
      const buildingRepository = new JsonBuildingRepository({
        buildingsFile: storage.buildingsFile,
        logFile: storage.buildingLogFile,
      });
      const manager = new MicrosoftImportProcessManager({
        buildingRepository,
        jwtSecret,
        projectRoot,
        getApiBase: () => `http://127.0.0.1:${port}/api`,
      });
      const result = await manager.start({ id: "system-import", fullName: "Microsoft avtomatik import", role: "admin" });
      if (result.started) console.log("Microsoft binolari avtomatik yuklanishi boshlandi.");
      else if (result.status?.message) console.log(result.status.message);
    }).catch((error) => {
      console.error("Microsoft binolarini avtomatik yuklash boshlanmadi:", error.message);
    });
  } else {
    console.log("Microsoft avtomatik import o‘chiq; administrator panelidan boshqariladi.");
  }
}

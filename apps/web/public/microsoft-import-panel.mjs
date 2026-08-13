const API_BASE = window.KOPRIK_CONFIG?.apiBase ?? "/api";
const TOKEN_KEY = "koprik_xarita_token";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function adminVisible() {
  return document.querySelector("#roleLabel")?.textContent?.includes("Administrator") === true;
}

async function request(path, options = {}) {
  const token = localStorage.getItem(TOKEN_KEY) ?? "";
  const headers = {
    ...(options.body ? { "content-type": "application/json" } : {}),
    ...(options.headers ?? {}),
  };
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message ?? `Server xatosi (${response.status})`);
  return body;
}

function statusText(status) {
  if (!status) return "Microsoft import holati noma’lum";
  if (status.state === "running") {
    const tile = status.totalTiles ? ` · tayl ${status.currentTile}/${status.totalTiles}` : "";
    return `Yuklanmoqda: ${status.imported ?? 0} ta bino${tile}`;
  }
  if (status.state === "failed") return `Import xatosi: ${status.error || "noma’lum xato"}`;
  if (status.state === "completed") return status.message || `Microsoft binolari tayyor: ${status.imported ?? 0} ta`;
  return "Microsoft binolari hali yuklanmagan";
}

function createPanel() {
  const buildingsPanel = document.querySelector("#buildingsPanel");
  if (!buildingsPanel || document.querySelector("#microsoftImportControls")) return null;

  const wrap = document.createElement("div");
  wrap.id = "microsoftImportControls";
  wrap.className = "microsoft-import-controls";
  wrap.hidden = true;
  wrap.style.display = "grid";
  wrap.style.gap = "8px";
  wrap.style.margin = "12px 0";

  const button = document.createElement("button");
  button.id = "microsoftImportButton";
  button.type = "button";
  button.className = "button button-secondary button-wide";
  button.textContent = "Microsoft binolarini yuklash";

  const status = document.createElement("p");
  status.id = "microsoftImportStatus";
  status.className = "helper-text";
  status.textContent = "Microsoft Building Footprints holati tekshirilmoqda…";

  wrap.append(button, status);
  const imagery = buildingsPanel.querySelector(".imagery-controls");
  if (imagery) imagery.before(wrap);
  else buildingsPanel.append(wrap);
  return { wrap, button, status };
}

async function boot() {
  const ui = createPanel();
  if (!ui) return;
  let lastState = "idle";
  let stopped = false;

  const setVisibility = () => {
    ui.wrap.hidden = !adminVisible();
  };

  async function refresh() {
    setVisibility();
    if (ui.wrap.hidden || stopped) return;
    try {
      const result = await request("/buildings/import-microsoft/status");
      const status = result.status ?? { state: "idle", imported: 0 };
      ui.status.textContent = statusText(status);
      ui.button.disabled = status.state === "running";
      ui.button.textContent = status.state === "running"
        ? "Microsoft binolari yuklanmoqda…"
        : "Microsoft binolarini yuklash";

      if (lastState === "running" && status.state === "completed") {
        const filter = document.querySelector("#buildingStatusFilter");
        if (filter) filter.value = "all";
        window.location.reload();
        return;
      }
      lastState = status.state;
      if (status.state === "running") {
        await sleep(1800);
        return refresh();
      }
    } catch (error) {
      ui.status.textContent = `Import holati olinmadi: ${error.message}`;
    }
  }

  ui.button.addEventListener("click", async () => {
    ui.button.disabled = true;
    try {
      const result = await request("/buildings/import-microsoft", {
        method: "POST",
        body: JSON.stringify({}),
      });
      const status = result.status ?? { state: result.started ? "running" : "idle" };
      ui.status.textContent = statusText(status);
      lastState = status.state;
      if (status.state === "running") refresh();
      else ui.button.disabled = false;
    } catch (error) {
      ui.status.textContent = `Import boshlanmadi: ${error.message}`;
      ui.button.disabled = false;
    }
  });

  const roleLabel = document.querySelector("#roleLabel");
  if (roleLabel) new MutationObserver(() => { setVisibility(); if (!ui.wrap.hidden) refresh(); }).observe(roleLabel, { childList: true, subtree: true, characterData: true });

  setVisibility();
  if (!ui.wrap.hidden) refresh();
  window.addEventListener("beforeunload", () => { stopped = true; });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
else boot();

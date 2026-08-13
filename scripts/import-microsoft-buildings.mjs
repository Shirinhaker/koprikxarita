#!/usr/bin/env node

const OLD_MANIFEST_URL = "https://minedbuildings.blob.core.windows.net/global-buildings/dataset-links.csv";
const CURRENT_MANIFEST_URL = "https://minedbuildings.z5.web.core.windows.net/global-buildings/dataset-links.csv";
const nativeFetch = globalThis.fetch;

globalThis.fetch = (input, init) => {
  const url = typeof input === "string" ? input : input?.url;
  if (url === OLD_MANIFEST_URL) return nativeFetch(CURRENT_MANIFEST_URL, init);
  return nativeFetch(input, init);
};

await import("./import-microsoft-buildings-legacy.mjs");

#!/usr/bin/env node
// Dublikat binolarni tozalash skripti.
//
// NIMA QILADI:
//   1. API'dan barcha binolarni oladi (admin token bilan).
//   2. IoU (ustma-ustlik) bo‘yicha dublikat guruhlarini topadi.
//   3. Har guruhdan eng yaxshisini qoldiradi, qolganlarini ARXIVLAYDI
//      (o‘chirmaydi — arxiv qaytariladigan; keyin tiklash mumkin).
//
//   Survivor tanlash ustunligi: nashr qilingan > tekshirilgan > qo‘lda >
//   OSM > Microsoft; keyin ishonch, nuqta soni, katta maydon.
//
// ISHLATISH:
//   node scripts/dedup-buildings.mjs --login admin:admin12345
//   yoki: node scripts/dedup-buildings.mjs --token <ADMIN_TOKEN>
//
//   Bayroqlar:
//     --api http://localhost:4100/api   (standart)
//     --status all                      (all | draft | published)
//     --threshold 0.5                   (IoU chegarasi: 0..1, kattaroq = qattiqroq)
//     --grid 64                         (IoU aniqligi; kattaroq = aniqroq, sekinroq)
//     --dry-run                         (arxivlamasdan faqat hisobot)

import {
  planDeduplication,
} from "../src/domain/dedup.mjs";

function parseArgs(argv) {
  const args = { api: "http://localhost:4100/api", status: "all", threshold: 0.5, grid: 64 };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (key === "--dry-run") { args.dryRun = true; continue; }
    const value = argv[i + 1];
    if (key === "--token") args.token = value;
    else if (key === "--api") args.api = value;
    else if (key === "--status") args.status = value;
    else if (key === "--threshold") args.threshold = Number(value);
    else if (key === "--grid") args.grid = Number(value);
    else if (key === "--login") args.login = value;
    else continue;
    i += 1;
  }
  return args;
}

async function loginForToken(api, login) {
  const [name, password] = login.split(":");
  const res = await fetch(`${api}/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ login: name, password }),
  });
  if (!res.ok) throw new Error("Login muvaffaqiyatsiz");
  return (await res.json()).token;
}

async function fetchBuildings(api, token, status) {
  const res = await fetch(`${api}/buildings?status=${encodeURIComponent(status)}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Binolarni olishda xato: HTTP ${res.status}`);
  return (await res.json()).buildings ?? [];
}

async function archiveBuilding(api, token, id) {
  const res = await fetch(`${api}/buildings/${id}`, {
    method: "DELETE", headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Arxivlashda xato (${id}): HTTP ${res.status}`);
}

function shortLabel(building) {
  const name = building.name || "Nomsiz";
  return `${name} [${building.source}/${building.status}${building.verified ? "/✓" : ""}]`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.token && args.login) args.token = await loginForToken(args.api, args.login);
  if (!args.token) {
    console.error("Xato: --token yoki --login kerak. Masalan: --login admin:admin12345");
    process.exit(1);
  }

  console.log(`Binolar olinmoqda (holat: ${args.status})…`);
  const buildings = await fetchBuildings(args.api, args.token, args.status);
  console.log(`Jami ${buildings.length} ta bino. IoU chegarasi: ${args.threshold}, to‘r: ${args.grid}.`);

  console.log("Dublikatlar aniqlanmoqda…");
  const plan = planDeduplication(buildings, { threshold: args.threshold, gridSteps: args.grid });
  console.log(`\nTopildi: ${plan.groupCount} ta dublikat guruh, jami ${plan.totalDuplicates} ta ortiqcha bino.\n`);

  if (plan.groupCount === 0) {
    console.log("Dublikat yo‘q. Hech narsa o‘zgartirilmadi.");
    return;
  }

  // Namuna sifatida dastlabki bir necha guruhni ko‘rsatish.
  const preview = plan.groups.slice(0, 8);
  for (const [i, group] of preview.entries()) {
    console.log(`Guruh ${i + 1}: qoldiriladi -> ${shortLabel(group.survivor)}`);
    for (const dup of group.duplicates) console.log(`         arxiv    -> ${shortLabel(dup)}`);
  }
  if (plan.groups.length > preview.length) console.log(`  … va yana ${plan.groups.length - preview.length} guruh.`);

  if (args.dryRun) {
    console.log(`\nDRY-RUN: ${plan.totalDuplicates} ta bino arxivlanardi (hech narsa o‘zgartirilmadi).`);
    return;
  }

  console.log(`\n${plan.totalDuplicates} ta dublikat arxivlanmoqda…`);
  let done = 0;
  let failed = 0;
  for (const group of plan.groups) {
    for (const dup of group.duplicates) {
      try { await archiveBuilding(args.api, args.token, dup.id); done += 1; }
      catch (error) { failed += 1; console.log(`  Xato: ${error.message}`); }
      process.stdout.write(`\r  ${done}/${plan.totalDuplicates} arxivlandi…   `);
    }
  }
  console.log(`\n\nTayyor. ${done} ta dublikat arxivlandi${failed ? `, ${failed} ta xato` : ""}.`);
  console.log("Arxivlangan binolar qaytariladi — kerak bo‘lsa ilovada tiklash mumkin.");
}

main().catch((error) => { console.error("\nXato:", error.message); process.exit(1); });

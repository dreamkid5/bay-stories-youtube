#!/usr/bin/env node
// Scans manual/ for folders prepared for manual-assemble.mjs (a video named 0, images,
// script.txt, timestamps.txt — see manual-assemble.mjs for the exact layout), assembles
// each into a finished video, and uploads it to YouTube as a private draft (same
// uploadToYouTube() the rest of the channel uses). A successfully uploaded folder is
// DELETED from the repo afterward — its record lives on in manual/.cf-uploaded.json and
// on YouTube itself — so nothing is ever uploaded twice and the repo never accumulates
// finished videos or old source footage.
//
// Usage: node worker/manual-publish.mjs
// Env: YT_CLIENT_ID, YT_CLIENT_SECRET, YT_REFRESH_TOKEN, CF_YT_PRIVACY (as the rest of
//      the channel); MANUAL_DIR overrides the manual/ folder location.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assembleManualVideo } from "./manual-assemble.mjs";
import { uploadToYouTube } from "./upload.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..");

export function titleFromFolderName(name) {
  return name.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export async function listPendingFolders(manualDir) {
  let entries;
  try { entries = await fs.readdir(manualDir, { withFileTypes: true }); }
  catch (e) { return []; }
  return entries
    .filter((e) => e.isDirectory() && e.name !== "published" && !e.name.startsWith("."))
    .map((e) => e.name)
    .sort();
}

export async function loadLedger(ledgerPath) {
  try { return JSON.parse(await fs.readFile(ledgerPath, "utf8")); }
  catch (e) { return {}; }
}

export async function saveLedger(ledgerPath, map) {
  await fs.mkdir(path.dirname(ledgerPath), { recursive: true });
  await fs.writeFile(ledgerPath, JSON.stringify(map, null, 2));
}

export async function publishPendingManualVideos(opts = {}) {
  const manualDir = opts.manualDir || process.env.MANUAL_DIR || path.join(REPO_ROOT, "manual");
  const ledgerPath = path.join(manualDir, ".cf-uploaded.json");
  const log = opts.log || ((m) => console.log("[manual-publish] " + m));

  const cfg = {
    ytClientId: process.env.YT_CLIENT_ID,
    ytClientSecret: process.env.YT_CLIENT_SECRET,
    ytRefreshToken: process.env.YT_REFRESH_TOKEN,
    ytPrivacy: process.env.CF_YT_PRIVACY || "private",
    ytTags: [],
    ytCategory: "22",
    input: manualDir,
    log
  };

  if (!cfg.ytClientId || !cfg.ytClientSecret || !cfg.ytRefreshToken) {
    log("YouTube is not connected (YT_REFRESH_TOKEN missing); nothing to do.");
    return { processed: [], failed: [] };
  }

  const pending = await listPendingFolders(manualDir);
  if (!pending.length) {
    log("no pending manual/ folders.");
    return { processed: [], failed: [] };
  }
  log(pending.length + " pending folder(s): " + pending.join(", "));

  const ledger = await loadLedger(ledgerPath);
  const processed = [];
  const failed = [];

  for (const name of pending) {
    const folder = path.join(manualDir, name);
    log("processing " + name);
    try {
      let title = titleFromFolderName(name);
      try {
        const t = (await fs.readFile(path.join(folder, "title.txt"), "utf8")).trim();
        if (t) title = t;
      } catch (e) { /* no title.txt; use the folder name */ }

      const script = (await fs.readFile(path.join(folder, "script.txt"), "utf8")).trim();
      const outFile = path.join(folder, "output.mp4");
      await assembleManualVideo(folder, outFile, { log: (m) => log("  " + m) });

      const videoId = await uploadToYouTube(outFile, { title, script }, cfg);
      ledger[name] = videoId;
      await saveLedger(ledgerPath, ledger);
      log("  uploaded: https://youtu.be/" + videoId);

      await fs.rm(folder, { recursive: true, force: true });
      log("  removed manual/" + name + " (its record lives on in the ledger and on YouTube)");
      processed.push(name);
    } catch (e) {
      log("  FAILED: " + e.message);
      failed.push(name);
    }
  }
  return { processed, failed };
}

async function main() {
  const { failed } = await publishPendingManualVideos();
  if (failed.length) {
    throw new Error(failed.length + " folder(s) failed and were left in manual/ for retry: " + failed.join(", "));
  }
}

if (import.meta.url === "file://" + process.argv[1]) {
  main().catch((e) => { console.error("[manual-publish] " + e.message); process.exit(1); });
}

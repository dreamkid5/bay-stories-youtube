#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { replaceYouTubeThumbnail } from "./upload.mjs";

const videoId = String(process.argv[2] || "").trim();
const requestedPath = String(process.argv[3] || "").trim();
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const allowedRoot = path.join(repoRoot, "worker", "assets", "replacement-thumbnails");
const thumbnailFile = path.resolve(repoRoot, requestedPath);

if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
  throw new Error("video id must be an 11-character YouTube id");
}
if (thumbnailFile !== allowedRoot && !thumbnailFile.startsWith(allowedRoot + path.sep)) {
  throw new Error("thumbnail path must be inside worker/assets/replacement-thumbnails");
}
if (!fs.existsSync(thumbnailFile)) {
  throw new Error("thumbnail file does not exist: " + requestedPath);
}

await replaceYouTubeThumbnail(videoId, thumbnailFile, {
  ytClientId: process.env.YT_CLIENT_ID || "",
  ytClientSecret: process.env.YT_CLIENT_SECRET || "",
  ytRefreshToken: process.env.YT_REFRESH_TOKEN || "",
  log: console.log
});

#!/usr/bin/env node
// Assembles a video from a user-supplied folder of assets: a video named "0" plays
// first with its OWN audio, then a single narration track (Brian, the channel's locked
// voice) plays under a sequence of user-supplied images (1, 2, 3, ...), each shown for
// exactly the on-screen time given in timestamps.txt, with a slow Ken Burns zoom
// in/out so a long-held image never looks static. Karaoke captions are burned over the
// narrated portion only (video 0 keeps its own sound, uncaptioned).
//
// Folder layout (all files sit directly in <folder>, any common extension):
//   0.<ext>          the intro video clip; keeps its own audio; plays before narration
//   1.<ext>          image 1 (jpg/png/webp)
//   2.<ext>          image 2
//   ... etc, one file per line in timestamps.txt
//   script.txt       the full narration text, read start to finish
//   timestamps.txt   one line per image: "1: 0:08-0:45"
//                    times are relative to when narration STARTS (0:00 = the instant
//                    video 0 ends), not the absolute start of the finished video.
//
// Usage:
//   node worker/manual-assemble.mjs <folder> [outFile]
//
// Env overrides: CF_FFMPEG, CF_FFPROBE, CF_WIDTH, CF_HEIGHT, CF_ZOOM,
//                CF_EDGE_RATE, CF_EDGE_PITCH

import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FONTS_DIR = path.join(HERE, "assets", "fonts");
const FFMPEG = process.env.CF_FFMPEG || "ffmpeg";
const FFPROBE = process.env.CF_FFPROBE || "ffprobe";

// Narration is permanently locked to the channel's Brian voice, same as every other
// video this tool makes. Rate/pitch match the production default unless overridden.
const LOCKED_VOICE = "en-US-BrianNeural";
const RATE = process.env.CF_EDGE_RATE || "-5%";
const PITCH = process.env.CF_EDGE_PITCH || "+0Hz";

const IMAGE_EXTS = [".jpg", ".jpeg", ".png", ".webp"];
const VIDEO_EXTS = [".mp4", ".mov", ".webm", ".mkv", ".m4v"];

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args);
    let err = "";
    p.stderr.on("data", (d) => { err += d.toString(); });
    p.on("error", reject);
    p.on("close", (code) => code === 0 ? resolve() : reject(new Error(cmd + " exited " + code + ": " + err.slice(-800))));
  });
}

function probeDuration(file) {
  return new Promise((resolve, reject) => {
    const p = spawn(FFPROBE, ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file]);
    let out = "";
    p.stdout.on("data", (d) => { out += d.toString(); });
    p.on("error", reject);
    p.on("close", () => {
      const n = parseFloat(out.trim());
      if (!isFinite(n) || n <= 0) reject(new Error("could not read duration of " + file));
      else resolve(n);
    });
  });
}

export function parseTimeToSeconds(raw) {
  const s = String(raw).trim();
  if (!s) throw new Error("bad timestamp: " + JSON.stringify(raw));
  const parts = s.split(":").map((p) => p.trim());
  if (parts.some((p) => p === "" || !isFinite(Number(p)))) throw new Error("bad timestamp: " + JSON.stringify(raw));
  const nums = parts.map(Number);
  if (nums.length === 3) return nums[0] * 3600 + nums[1] * 60 + nums[2];
  if (nums.length === 2) return nums[0] * 60 + nums[1];
  return nums[0];
}

export function parseTimestampsFile(raw) {
  const entries = [];
  for (const lineRaw of raw.split(/\r?\n/)) {
    const line = lineRaw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^(\d+)\s*:\s*([0-9:.]+)\s*-\s*([0-9:.]+)\s*$/);
    if (!m) throw new Error("timestamps.txt: could not parse line: " + JSON.stringify(lineRaw));
    const index = Number(m[1]);
    const start = parseTimeToSeconds(m[2]);
    const end = parseTimeToSeconds(m[3]);
    if (end <= start) throw new Error("timestamps.txt: image " + index + " has an end time at or before its start time");
    entries.push({ index, start, end });
  }
  if (!entries.length) throw new Error("timestamps.txt has no entries");
  entries.sort((a, b) => a.index - b.index);
  for (let i = 1; i < entries.length; i++) {
    if (entries[i].start < entries[i - 1].end) {
      throw new Error("timestamps.txt: image " + entries[i].index + " starts before image " + entries[i - 1].index + " ends");
    }
  }
  return entries;
}

async function findByIndex(folder, index, exts) {
  const entries = await fs.readdir(folder);
  const match = entries.find((e) => {
    const dot = e.lastIndexOf(".");
    if (dot < 0) return false;
    const base = e.slice(0, dot), ext = e.slice(dot).toLowerCase();
    return base === String(index) && exts.includes(ext);
  });
  return match ? path.join(folder, match) : null;
}

// Slow zoom that alternates in/out per image, scaled to that image's OWN on-screen
// duration (which can be long here) so it always reads as gentle drift, never a snap.
export function kenBurnsFilter(durationSec, index, width, height, zoomFraction) {
  const D = Math.max(0.1, durationSec);
  const zoomIn = index % 2 === 0;
  const hi = (1 + zoomFraction).toFixed(4);
  const z = zoomIn
    ? "(1+" + zoomFraction + "*t/" + D + ")"
    : "(" + hi + "-" + zoomFraction + "*t/" + D + ")";
  return "scale=" + width + ":" + height + ":force_original_aspect_ratio=increase,crop=" + width + ":" + height + "," +
    "scale=w='" + width + "*" + z + "':h='" + height + "*" + z + "':eval=frame,crop=" + width + ":" + height + ",setsar=1,format=yuv420p";
}

async function buildImageClip(imagePath, durationSec, index, outPath, width, height, zoomFraction) {
  const vf = kenBurnsFilter(durationSec, index, width, height, zoomFraction);
  await run(FFMPEG, [
    "-y", "-loop", "1", "-t", String(durationSec), "-i", imagePath,
    "-vf", vf, "-r", "30", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
    "-pix_fmt", "yuv420p", "-an", outPath
  ]);
}

async function normalizeVideoClip(inPath, outPath, width, height) {
  // Re-encode video 0 to the same resolution/fps/codec as the image clips, keeping its
  // own audio, so it concatenates cleanly with the narrated sequence that follows.
  await run(FFMPEG, [
    "-y", "-i", inPath,
    "-vf", "scale=" + width + ":" + height + ":force_original_aspect_ratio=increase,crop=" + width + ":" + height + ",setsar=1,format=yuv420p",
    "-r", "30", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "160k", "-ar", "24000", "-ac", "2",
    outPath
  ]);
}

async function concatClips(clips, outPath, workDir) {
  const listFile = path.join(workDir, "concat_" + path.basename(outPath) + ".txt");
  const lines = clips.map((c) => "file '" + path.resolve(c).replace(/'/g, "'\\''") + "'").join("\n");
  await fs.writeFile(listFile, lines);
  try {
    await run(FFMPEG, ["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", outPath]);
  } catch (e) {
    await run(FFMPEG, ["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-r", "30",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "160k", outPath]);
  }
}

function ffEscapePath(p) {
  return p.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

export async function assembleManualVideo(folder, outFile, opts = {}) {
  const width = opts.width || Number(process.env.CF_WIDTH) || 1920;
  const height = opts.height || Number(process.env.CF_HEIGHT) || 1080;
  const zoomFraction = opts.zoom != null ? opts.zoom : (Number(process.env.CF_ZOOM) || 0.08);
  const log = opts.log || ((m) => console.log("[manual-assemble] " + m));

  const workDir = await fs.mkdtemp(path.join(path.dirname(outFile), ".manual-assemble-"));
  try {
    const videoZero = await findByIndex(folder, "0", VIDEO_EXTS);
    if (!videoZero) throw new Error("no video named 0.<ext> found in " + folder);
    const script = (await fs.readFile(path.join(folder, "script.txt"), "utf8")).trim();
    if (!script) throw new Error("script.txt is empty");
    const timestampsRaw = await fs.readFile(path.join(folder, "timestamps.txt"), "utf8");
    const timestamps = parseTimestampsFile(timestampsRaw);

    const images = [];
    for (const t of timestamps) {
      const p = await findByIndex(folder, String(t.index), IMAGE_EXTS);
      if (!p) throw new Error("timestamps.txt references image " + t.index + " but no matching file was found");
      images.push({ ...t, path: p });
    }
    log(images.length + " image(s), video 0: " + path.basename(videoZero));

    // 1) Video 0, re-encoded to a consistent format, own audio kept.
    const clip0 = path.join(workDir, "clip0.mp4");
    await normalizeVideoClip(videoZero, clip0, width, height);
    const clip0Duration = await probeDuration(clip0);
    log("video 0 duration: " + clip0Duration.toFixed(1) + "s");

    // 2) Narration for the WHOLE script, once, in the locked voice.
    const narrationMp3 = path.join(workDir, "narration.mp3");
    const wordsJson = path.join(workDir, "narration.words.json");
    const scriptTxtFile = path.join(workDir, "script_for_tts.txt");
    await fs.writeFile(scriptTxtFile, script);
    await run("python3", [
      path.join(HERE, "tts_words.py"), scriptTxtFile, LOCKED_VOICE, narrationMp3, wordsJson, RATE, PITCH
    ]);
    const narrationDuration = await probeDuration(narrationMp3);
    log("narration duration: " + narrationDuration.toFixed(1) + "s (" + LOCKED_VOICE + ")");

    // 3) Your timestamps are authoritative, but reconcile any drift against the last
    //    image so picture and voice both end together instead of one cutting off early.
    const totalPlanned = images[images.length - 1].end;
    const drift = narrationDuration - totalPlanned;
    if (Math.abs(drift) > 1) {
      log("NOTE: narration is " + Math.abs(drift).toFixed(1) + "s " + (drift > 0 ? "longer" : "shorter") +
        " than your timestamps cover; stretching the last image to absorb the difference.");
      images[images.length - 1].end += drift;
      if (images[images.length - 1].end <= images[images.length - 1].start) {
        throw new Error("narration is far shorter than your timestamps cover; widen the gap or shorten the script");
      }
    }

    // 4) One silent Ken Burns clip per image, each exactly its own on-screen duration.
    const imageClipPaths = [];
    for (let i = 0; i < images.length; i++) {
      const im = images[i];
      const dur = im.end - im.start;
      const p = path.join(workDir, "img" + im.index + ".mp4");
      await buildImageClip(im.path, dur, i, p, width, height, zoomFraction);
      imageClipPaths.push(p);
      log("image " + im.index + ": " + dur.toFixed(1) + "s (" + (i % 2 === 0 ? "zoom in" : "zoom out") + ")");
    }

    // 5) Concatenate the silent image clips into one continuous picture track.
    const imagesSilent = path.join(workDir, "images_silent.mp4");
    await concatClips(imageClipPaths, imagesSilent, workDir);

    // 6) Karaoke captions from the narration's word timings.
    const captionsAss = path.join(workDir, "captions.ass");
    const fontSize = Math.round(height * 0.062);
    await run("python3", [
      path.join(HERE, "captions.py"),
      wordsJson, captionsAss, String(width), String(height),
      path.join(FONTS_DIR, "Montserrat-ExtraBold.ttf"), "Montserrat ExtraBold",
      String(fontSize), "#6A12C0", "4", "0.72"
    ]);

    // 7) Mux narration + captions onto the image sequence.
    const narratedImages = path.join(workDir, "narrated_images.mp4");
    await run(FFMPEG, [
      "-y", "-i", imagesSilent, "-i", narrationMp3,
      "-filter_complex", "[0:v]subtitles='" + ffEscapePath(captionsAss) + "':fontsdir='" + ffEscapePath(FONTS_DIR) + "'[v]",
      "-map", "[v]", "-map", "1:a:0",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "160k",
      "-shortest",
      narratedImages
    ]);

    // 8) Final: video 0 (own audio) followed by the narrated, captioned image sequence.
    await concatClips([clip0, narratedImages], outFile, workDir);
    log("done: " + outFile);
    return outFile;
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function main() {
  const folder = process.argv[2];
  const outFile = process.argv[3] || path.join(folder || ".", "final.mp4");
  if (!folder) {
    console.error("Usage: node worker/manual-assemble.mjs <folder> [outFile]");
    process.exit(1);
  }
  await assembleManualVideo(path.resolve(folder), path.resolve(outFile));
}

if (import.meta.url === "file://" + process.argv[1]) {
  main().catch((e) => { console.error("[manual-assemble] FAILED: " + e.message); process.exit(1); });
}

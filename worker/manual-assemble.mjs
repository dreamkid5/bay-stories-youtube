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
//   26a.<ext>        SPLIT: letter a slot's images "<N>a".."<N>d" (also accepted:
//   26b.<ext>        "26 a", "26(a)", "26 (a)") to tile 2-4 images into one frame for
//                    that slot: 2 = side-by-side face-off, 3 = a row, 4 = a 2x2 grid.
//   ... etc, one file (or a lettered 2-4 split) per line in timestamps.txt
//   script.txt       the full narration text, read start to finish
//   timestamps.txt   one line per image: "1: 0:08-0:45"
//                    times are relative to when narration STARTS (0:00 = the instant
//                    video 0 ends), not the absolute start of the finished video.
//                    Anything after the end time on a line (e.g. a note describing the
//                    scene) is ignored — it is never treated as narration.
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

// A colon time (m:ss, mm:ss, or h:mm:ss). Bare-second times aren't recognized here
// on purpose: prose is full of loose numbers, and requiring a colon is what lets the
// parser tell a real cue apart from "in 3 to 4 days".
const TIME = "\\d{1,3}:\\d{2}(?::\\d{2})?";
// The FIRST "time <dash|to> time" span on a line. Any dash (-, en –, em —), a tilde,
// an arrow, or the word "to" separates start from end. Whatever follows (" — SCENE 01",
// a mood note, a camera direction) is ignored.
const RANGE_RE = new RegExp("(" + TIME + ")\\s*(?:-|–|—|~|→|to)\\s*(" + TIME + ")", "i");
// An explicit image number written as SCENE/IMAGE/SHOT/SLIDE/FRAME/PIC N.
const SCENE_RE = /\b(?:scene|image|img|shot|slide|frame|pic(?:ture)?)\s*#?\s*(\d{1,3})\b/i;
// A line that plainly means to be a clean "N: start-end" entry: a number, a COLON, then
// NON-digit text ("1: not-a-range"). The non-digit tail is what separates a real typo
// from time-like prose such as "2:00 a.m." (digit after the colon) or a bare time cue —
// those are left to be ignored, not shouted about. Used only to decide whether a line
// with NO parseable range is a typo worth flagging vs. prose worth ignoring.
const LOOKS_LIKE_CLEAN_ENTRY_RE = /^\s*\d{1,3}\s*:\s*\D/;
// A line that is JUST a scene/image header with no time range of its own — e.g.
// "SCENE 07 — PRESTON VALE ARRIVES" sitting on the line above its "07:10 – 08:25". Its
// number is remembered and attached to the next range line that has no number of its own.
const SCENE_HEADER_RE = /^\s*(?:scene|image|img|shot|slide|frame|pic(?:ture)?)\s*#?\s*(\d{1,3})\b/i;

// Pull image cues out of a timestamps file that may ALSO contain a full shot list:
// narration notes, camera directions, image descriptions, ACT headers, blank lines.
// A line becomes a cue only if it holds a real time range; the image number comes from a
// leading "N:" or a "SCENE N" token. Range lines with no derivable number (a section
// sub-beat like "39:00–39:20 — THE FAMILY") are dropped once any numbered cue exists, so
// the shot list's prose can never sneak in as narration or as a phantom image.
export function parseTimestampsFile(raw, log) {
  const note = typeof log === "function" ? log : () => {};
  const candidates = []; // { index: number|null, start, end }
  let ignoredProse = 0;
  let pendingIndex = null; // a SCENE number seen on a header line, awaiting its range line

  for (const lineRaw of raw.split(/\r?\n/)) {
    const line = lineRaw.trim();
    if (!line || line.startsWith("#")) continue;

    const r = line.match(RANGE_RE);
    if (!r) {
      // No time range on this line. A bare "SCENE 07 — ..." header remembers its number
      // for the range line that follows it (shot lists that put the two on separate lines).
      const header = line.match(SCENE_HEADER_RE);
      if (header) { pendingIndex = Number(header[1]); continue; }
      // A botched clean entry ("1: not-a-range") is almost certainly a mistake the user
      // wants flagged — losing it would drop an image silently. Everything else (prose,
      // descriptions, "Image: Scene 3 — ...") is ignored.
      if (LOOKS_LIKE_CLEAN_ENTRY_RE.test(line)) {
        throw new Error("timestamps.txt: could not parse line: " + JSON.stringify(lineRaw));
      }
      ignoredProse++;
      continue;
    }

    const start = parseTimeToSeconds(r[1]);
    const end = parseTimeToSeconds(r[2]);
    if (end <= start) {
      throw new Error("timestamps.txt: a cue (" + JSON.stringify(line) +
        ") has an end time at or before its start time");
    }

    // Image number, in order of preference: a leading "N:" written before the range, a
    // SCENE/IMAGE token on the same line, or the number remembered from a header line
    // just above. Otherwise leave it unnumbered for now.
    let index = null;
    const before = line.slice(0, r.index);
    const lead = before.match(/(\d{1,3})\s*[:.]?\s*$/);
    if (lead) index = Number(lead[1]);
    else {
      const scene = line.match(SCENE_RE);
      if (scene) index = Number(scene[1]);
    }
    if (index == null && pendingIndex != null) index = pendingIndex;
    pendingIndex = null; // each range line consumes (or supersedes) a pending header
    candidates.push({ index, start, end });
  }

  if (!candidates.length) throw new Error("timestamps.txt has no entries");

  // If ANY cue carries an explicit number, that is the authoritative set — drop the
  // unnumbered ones (section sub-beats, stray ranges in prose). Only when NOTHING is
  // numbered do we fall back to numbering cues 1..N in the order they appear.
  const numbered = candidates.filter((c) => c.index != null);
  let picked;
  if (numbered.length) {
    const dropped = candidates.length - numbered.length;
    if (dropped) note("timestamps.txt: ignored " + dropped +
      " time range(s) with no image number (section markers / stray ranges).");
    picked = numbered;
  } else {
    picked = candidates.map((c, i) => ({ index: i + 1, start: c.start, end: c.end }));
    note("timestamps.txt: no image numbers found; numbering cues 1.." + picked.length +
      " in the order they appear.");
  }
  if (ignoredProse) note("timestamps.txt: ignored " + ignoredProse +
    " non-timing line(s) (notes, headers, descriptions).");

  // Merge duplicates (e.g. a face-off written as two "SCENE 26" lines) into one span.
  const byIndex = new Map();
  for (const c of picked) {
    const prev = byIndex.get(c.index);
    if (prev) {
      prev.start = Math.min(prev.start, c.start);
      prev.end = Math.max(prev.end, c.end);
      note("timestamps.txt: image " + c.index + " appears more than once; merged into one span.");
    } else {
      byIndex.set(c.index, { index: c.index, start: c.start, end: c.end });
    }
  }

  const entries = [...byIndex.values()].sort((a, b) => a.index - b.index);
  for (let i = 1; i < entries.length; i++) {
    if (entries[i].start < entries[i - 1].end) {
      throw new Error("timestamps.txt: image " + entries[i].index + " starts before image " + entries[i - 1].index + " ends");
    }
  }
  note("timestamps.txt: " + entries.length + " image cue(s) parsed.");
  return entries;
}

// Your timestamps are authoritative for RELATIVE pacing, but the actual narration
// almost never lands on exactly the total they add up to (TTS pace never matches a
// hand-written or AI-estimated shot list exactly). Reconciling that drift by dumping
// it all onto the last scene is fragile: a short final scene (a quick "call to
// action," say) can't absorb a large mismatch and goes negative — exactly what a
// 39-scene, ~40-minute video hit in production when narration ran 83s short and the
// last scene was only 32s long. Instead, scale EVERY image's start/end by the same
// factor, so a 3% narration/timestamp mismatch becomes a 3% shift on every scene
// instead of a fatal one on whichever scene happens to be shortest. Mutates `images`
// in place and always leaves every duration positive (unless the narration is so
// short that even a full-timeline scale cannot avoid a degenerate span, which is
// nearly impossible for a 200ms-fade clip since scale is strictly positive).
export function reconcileImageTimingToNarration(images, narrationDuration, log) {
  const totalPlanned = images[images.length - 1].end;
  const drift = narrationDuration - totalPlanned;
  if (Math.abs(drift) <= 1 || totalPlanned <= 0) return images;
  const scale = narrationDuration / totalPlanned;
  if (log) {
    log("NOTE: narration is " + Math.abs(drift).toFixed(1) + "s " + (drift > 0 ? "longer" : "shorter") +
      " than your timestamps cover; scaling every image's timing by " + (scale * 100).toFixed(1) +
      "% so picture and voice finish together.");
  }
  for (const im of images) {
    im.start *= scale;
    im.end *= scale;
  }
  return images;
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

// An image slot is either a solo file ("26.jpg") or a face-off PAIR ("26a.jpg" +
// "26b.jpg", also accepting "26 a", "26(a)", "26 (a)" for either half) that gets
// combined into one split-screen frame. Returns null if the slot has nothing at all,
// and throws a clear error for a half-finished pair or a solo+pair clash, rather than
// silently picking one.
export async function findImageAsset(folder, index, exts) {
  const entries = await fs.readdir(folder);
  const parsed = entries
    .map((e) => {
      const dot = e.lastIndexOf(".");
      if (dot < 0) return null;
      return { base: e.slice(0, dot), ext: e.slice(dot).toLowerCase(), full: e };
    })
    .filter((e) => e && exts.includes(e.ext));

  const solo = parsed.find((e) => e.base === String(index));

  // A slot can be split across 2-4 images lettered a, b, c, d (a face-off is just the
  // 2-image case). "30a", "30 a", "30(a)", "30 (a)" all count; letters are case-insensitive.
  const SPLIT_LETTERS = ["a", "b", "c", "d"];
  const letterRe = new RegExp("^" + index + "\\s*\\(?([a-d])\\)?$", "i");
  const byLetter = new Map();
  for (const e of parsed) {
    const m = e.base.match(letterRe);
    if (m) byLetter.set(m[1].toLowerCase(), e.full);
  }

  if (solo && byLetter.size) {
    throw new Error("image " + index + " has both a solo file (" + solo.full + ") and a lettered split file; use one or the other, not both");
  }
  if (byLetter.size) {
    if (byLetter.size === 1) {
      const only = [...byLetter.values()][0];
      throw new Error("image " + index + " has only one half of a face-off pair (" +
        only + "); both " + index + "a and " + index + "b are required");
    }
    // The letters used must run consecutively from 'a' (a,b or a,b,c or a,b,c,d) — a gap
    // like a+c means the missing image would silently vanish, so it's flagged instead.
    const need = SPLIT_LETTERS.slice(0, byLetter.size);
    const missing = need.find((l) => !byLetter.has(l));
    if (missing) {
      throw new Error("image " + index + " uses split letters " +
        [...byLetter.keys()].sort().join(", ") + " but " + index + missing +
        " is missing; letter the split images consecutively from a (a, b, c, d)");
    }
    const paths = need.map((l) => path.join(folder, byLetter.get(l)));
    // Keep pathA/pathB on the 2-image case so existing callers/tests still read a "pair".
    if (paths.length === 2) return { type: "pair", pathA: paths[0], pathB: paths[1], paths };
    return { type: "group", paths };
  }
  if (solo) return { type: "single", path: path.join(folder, solo.full) };
  return null;
}

// Scales+crops ANY input to exactly fill widthxheight, no zoom yet.
function fitFrame(width, height) {
  return "scale=" + width + ":" + height + ":force_original_aspect_ratio=increase,crop=" + width + ":" + height + ",setsar=1";
}

// Applies the slow alternating zoom to a frame that is ALREADY widthxheight.
function zoomOnly(durationSec, index, width, height, zoomFraction) {
  const D = Math.max(0.1, durationSec);
  const zoomIn = index % 2 === 0;
  const hi = (1 + zoomFraction).toFixed(4);
  const z = zoomIn
    ? "(1+" + zoomFraction + "*t/" + D + ")"
    : "(" + hi + "-" + zoomFraction + "*t/" + D + ")";
  return "scale=w='" + width + "*" + z + "':h='" + height + "*" + z + "':eval=frame,crop=" + width + ":" + height + ",setsar=1,format=yuv420p";
}

// Slow zoom that alternates in/out per image, scaled to that image's OWN on-screen
// duration (which can be long here) so it always reads as gentle drift, never a snap.
export function kenBurnsFilter(durationSec, index, width, height, zoomFraction) {
  return fitFrame(width, height) + "," + zoomOnly(durationSec, index, width, height, zoomFraction);
}

// Dip-to-black transitions: every clip fades in from black at its own start and fades
// out to black at its own end. Concatenated with the existing fast stream-copy concat
// (no per-boundary crossfade blending, which would force a slow re-encode at every
// join), this reads as a dip-to-black transition at every boundary for free. Fade
// length is capped relative to the clip's own duration so a very short slot never
// spends most of its on-screen time fading rather than being seen. Mirrors the same
// helpers in render.mjs; kept local since this script is deliberately standalone.
// CF_TRANSITION_FADE_MS=0 disables it.
export function transitionFadeSeconds(durationSec) {
  const requested = Number(process.env.CF_TRANSITION_FADE_MS != null ? process.env.CF_TRANSITION_FADE_MS : 200) / 1000;
  if (!(requested > 0)) return 0;
  return Math.max(0, Math.min(requested, durationSec * 0.15));
}

export function dipToBlackVideo(durationSec) {
  const f = transitionFadeSeconds(durationSec);
  if (f <= 0) return "";
  const outStart = Math.max(0, durationSec - f);
  return ",fade=t=in:st=0:d=" + f.toFixed(3) + ":color=black," +
    "fade=t=out:st=" + outStart.toFixed(3) + ":d=" + f.toFixed(3) + ":color=black";
}

export function dipToBlackAudio(durationSec) {
  const f = transitionFadeSeconds(durationSec);
  if (f <= 0) return "";
  const outStart = Math.max(0, durationSec - f);
  return ",afade=t=in:st=0:d=" + f.toFixed(3) + ",afade=t=out:st=" + outStart.toFixed(3) + ":d=" + f.toFixed(3);
}

async function buildImageClip(imagePath, durationSec, index, outPath, width, height, zoomFraction) {
  const vf = kenBurnsFilter(durationSec, index, width, height, zoomFraction) + dipToBlackVideo(durationSec);
  await run(FFMPEG, [
    "-y", "-loop", "1", "-t", String(durationSec), "-i", imagePath,
    "-vf", vf, "-r", "30", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
    "-pix_fmt", "yuv420p", "-an", outPath
  ]);
}

// Lays out 2-4 images tiled into ONE widthxheight frame: 2 side by side (the classic
// face-off), 3 in a row, 4 in a 2x2 grid. Each cell is scale+cropped to fill exactly,
// then the COMBINED frame gets the same alternating zoom and dip-to-black as a solo image
// so a split never looks static either. Returns the cell filters + the label of the tiled
// frame, so the caller only appends the shared zoom/dip.
function splitLayout(count, width, height) {
  const cells = []; // { w, h } per input, in order
  let tile;
  if (count === 2) {
    const lw = Math.floor(width / 2);
    cells.push({ w: lw, h: height }, { w: width - lw, h: height });
    tile = "[c0][c1]hstack=inputs=2[grid];";
  } else if (count === 3) {
    const w = Math.floor(width / 3);
    cells.push({ w, h: height }, { w, h: height }, { w: width - 2 * w, h: height });
    tile = "[c0][c1][c2]hstack=inputs=3[grid];";
  } else {
    const lw = Math.floor(width / 2), rw = width - lw;
    const th = Math.floor(height / 2), bh = height - th;
    cells.push({ w: lw, h: th }, { w: rw, h: th }, { w: lw, h: bh }, { w: rw, h: bh });
    tile = "[c0][c1]hstack=inputs=2[top];[c2][c3]hstack=inputs=2[bot];[top][bot]vstack=inputs=2[grid];";
  }
  const cellFilters = cells.map((c, i) => "[" + i + ":v]" + fitFrame(c.w, c.h) + "[c" + i + "];").join("");
  return cellFilters + tile;
}

async function buildSplitClip(paths, durationSec, index, outPath, width, height, zoomFraction) {
  const count = paths.length; // 2, 3, or 4
  const filter = splitLayout(count, width, height) +
    "[grid]" + zoomOnly(durationSec, index, width, height, zoomFraction) + dipToBlackVideo(durationSec) + "[out]";
  const inputs = [];
  for (const p of paths) inputs.push("-loop", "1", "-t", String(durationSec), "-i", p);
  await run(FFMPEG, [
    "-y", ...inputs,
    "-filter_complex", filter, "-map", "[out]",
    "-r", "30", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
    "-pix_fmt", "yuv420p", "-an", outPath
  ]);
}

async function normalizeVideoClip(inPath, outPath, width, height, durationSec) {
  // Re-encode video 0 to the same resolution/fps/codec as the image clips, keeping its
  // own audio, so it concatenates cleanly with the narrated sequence that follows. Gets
  // its own dip-to-black too, so the video0 -> narration boundary matches every other
  // cut instead of being a hard cut on its own.
  await run(FFMPEG, [
    "-y", "-i", inPath,
    "-vf", "scale=" + width + ":" + height + ":force_original_aspect_ratio=increase,crop=" + width + ":" + height +
      ",setsar=1,format=yuv420p" + dipToBlackVideo(durationSec),
    "-af", "anull" + dipToBlackAudio(durationSec),
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
    // Video 0 is an OPTIONAL cold-open clip (with its own audio) that plays before the
    // narration. If the folder has no file named 0.<ext>, the video simply starts on the
    // narrated image sequence.
    const videoZero = await findByIndex(folder, "0", VIDEO_EXTS);
    const script = (await fs.readFile(path.join(folder, "script.txt"), "utf8")).trim();
    if (!script) throw new Error("script.txt is empty");
    const timestampsRaw = await fs.readFile(path.join(folder, "timestamps.txt"), "utf8");
    const timestamps = parseTimestampsFile(timestampsRaw, log);

    const images = [];
    for (const t of timestamps) {
      const asset = await findImageAsset(folder, t.index, IMAGE_EXTS);
      if (!asset) throw new Error("timestamps.txt references image " + t.index + " but no matching file(s) were found");
      images.push({ ...t, asset });
    }
    log(images.length + " image slot(s), video 0: " + (videoZero ? path.basename(videoZero) : "none (starts on images)"));

    // 1) Video 0 (optional), re-encoded to a consistent format, own audio kept. Its
    //    duration is probed from the SOURCE first (not the re-encoded output) because the
    //    fade-out timing has to be known before encoding starts.
    let clip0 = null;
    if (videoZero) {
      clip0 = path.join(workDir, "clip0.mp4");
      const sourceClip0Duration = await probeDuration(videoZero);
      await normalizeVideoClip(videoZero, clip0, width, height, sourceClip0Duration);
      const clip0Duration = await probeDuration(clip0);
      log("video 0 duration: " + clip0Duration.toFixed(1) + "s");
    }

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

    // 3) Your timestamps are authoritative, but reconcile any drift against the whole
    //    sequence so picture and voice finish together instead of one cutting off early.
    reconcileImageTimingToNarration(images, narrationDuration, log);

    // 4) One silent Ken Burns clip per slot, each exactly its own on-screen duration.
    //    A paired slot (26a + 26b) becomes one combined face-off frame first.
    const imageClipPaths = [];
    for (let i = 0; i < images.length; i++) {
      const im = images[i];
      const dur = im.end - im.start;
      const p = path.join(workDir, "img" + im.index + ".mp4");
      const zoomWord = i % 2 === 0 ? "zoom in" : "zoom out";
      if (im.asset.type === "pair" || im.asset.type === "group") {
        await buildSplitClip(im.asset.paths, dur, i, p, width, height, zoomFraction);
        const names = im.asset.paths.map((x) => path.basename(x));
        const label = im.asset.paths.length === 2 ? "FACE-OFF" : im.asset.paths.length + "-UP SPLIT";
        log("image " + im.index + ": " + dur.toFixed(1) + "s " + label + " (" +
          names.join(" | ") + ", " + zoomWord + ")");
      } else {
        await buildImageClip(im.asset.path, dur, i, p, width, height, zoomFraction);
        log("image " + im.index + ": " + dur.toFixed(1) + "s (" + zoomWord + ")");
      }
      imageClipPaths.push(p);
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
    //    With no video 0, the narrated image sequence IS the whole video.
    if (clip0) {
      await concatClips([clip0, narratedImages], outFile, workDir);
    } else {
      await concatClips([narratedImages], outFile, workDir);
    }
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

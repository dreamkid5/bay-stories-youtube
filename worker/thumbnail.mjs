// Automatic thumbnail generation.
// Storytime look (matches the reference the user gave): the SAME presenter photo from
// the video on the RIGHT, and the story's hook on the LEFT in bold Montserrat ExtraBold
// with each clause in a punchy colour. Drawn by thumbnail.py (Pillow) — all free.
// If Pillow/the presenter are unavailable, falls back to the older ffmpeg design.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { styleKeywords, buildPrompt } from "./csv.mjs";
import { generateUniqueFemalePresenter } from "./presenter.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FONTS_DIR = path.join(HERE, "assets", "fonts");
const MONTSERRAT = path.join(FONTS_DIR, "Montserrat-ExtraBold.ttf");
// Anton: a heavy condensed display font, used only by the legacy fallback.
const ANTON = path.join(FONTS_DIR, "Anton-Regular.ttf");

// The hook that goes on the thumbnail: the opening of the story, trimmed to a punchy
// length that ends on a sentence boundary where possible.
export function makeHook(job) {
  // Thumbnail text may come only from an explicit hook or the opening hook of the
  // script. Never substitute the title, SEO copy, or an AI-written headline.
  let t = String(job.hook || job.script || "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  const words = t.split(" ");
  if (words.length > 46) t = words.slice(0, 46).join(" ") + "...";
  // prefer to end on a full sentence if one lands reasonably far in
  const m = t.match(/^[\s\S]*?[.!?…](?=\s|$)/g);
  if (m) {
    let acc = "";
    for (const s of m) {
      const next = (acc ? acc + " " : "") + s.trim();
      if (next.split(" ").length > 46) break;
      acc = next;
      if (acc.split(" ").length >= 18) break;
    }
    if (acc.split(" ").length >= 10) t = acc;
  }
  return t.trim();
}

// The reference-style thumbnail: presenter on the right, coloured hook on the left.
async function buildStoryThumbnail(job, cfg, workDir, outFile, deps) {
  if (!fs.existsSync(MONTSERRAT)) return null;

  // Reuse this video's presenter. If the video could not make one earlier, use
  // the same uniqueness ledger while trying again for the thumbnail.
  let portrait = job.presenterFile && fs.existsSync(job.presenterFile) ? job.presenterFile : null;
  if (!portrait) {
    const generated = await generateUniqueFemalePresenter({
      job,
      cfg,
      workDir,
      fetchImage: deps.fetchImage
    });
    portrait = generated && generated.file;
    if (portrait) job.presenterFile = portrait;
  }
  if (!portrait) return null;

  const hook = makeHook(job);
  if (!hook) return null;

  await deps.run(cfg.edgeCmd || "python3", [
    path.join(HERE, "thumbnail.py"),
    portrait, hook, outFile, "1280", "720", MONTSERRAT
  ]);
  return fs.existsSync(outFile) ? outFile : null;
}

export async function buildThumbnail(job, cfg, workDir, outFile, deps) {
  // Preferred: the storytime reference look.
  try {
    const t = await buildStoryThumbnail(job, cfg, workDir, outFile, deps);
    if (t) return t;
  } catch (e) {
    cfg.log && cfg.log("  thumbnail: story style failed (" + e.message + "), using fallback");
  }
  // Fallback: the older dramatic-image + headline design.
  return buildLegacyThumbnail(job, cfg, workDir, outFile, deps);
}

// ---------------------------------------------------------------------------
// Legacy fallback: a fresh dramatic image with a short bold headline.
// ---------------------------------------------------------------------------
function extractJSON(text) {
  if (!text) return null;
  const s = text.indexOf("{"), e = text.lastIndexOf("}");
  if (s < 0 || e <= s) return null;
  try { return JSON.parse(text.slice(s, e + 1)); } catch (x) { return null; }
}

async function thumbnailPlan(job, cfg) {
  if (!cfg.anthropicKey) return null;
  const hook = makeHook(job);
  if (!hook) return null;
  const prompt =
    "You are designing a YouTube thumbnail for this video. Return ONLY JSON: " +
    '{"imagePrompt":"..."}\n' +
    "- imagePrompt: one vivid, dramatic single scene that captures the hook of the video, described for an illustrator. One clear subject, strong emotion or action, close or medium shot, no text in the image.\n\n" +
    "Base it only on this hook:\n" + hook;
  for (let a = 0; a < 3; a++) {
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": cfg.anthropicKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model: cfg.seoModel, max_tokens: 400, messages: [{ role: "user", content: prompt }] })
      });
      if (r.status === 429 || r.status === 529) { await new Promise((s) => setTimeout(s, 4000 * (a + 1))); continue; }
      if (!r.ok) return null;
      const j = await r.json();
      const data = extractJSON(j && j.content && j.content[0] && j.content[0].text);
      if (!data) return null;
      return { imagePrompt: String(data.imagePrompt || "").trim() };
    } catch (e) { await new Promise((s) => setTimeout(s, 2500 * (a + 1))); }
  }
  return null;
}

function findFont(cfg) {
  const list = [
    cfg.font, ANTON,
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/Library/Fonts/Arial Bold.ttf"
  ].filter(Boolean);
  for (const f of list) { try { if (fs.existsSync(f)) return f; } catch (e) {} }
  return null;
}

function toLines(hook) {
  const h = (hook || "").toUpperCase().replace(/[^A-Z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  const words = h.split(" ").filter(Boolean).slice(0, 5);
  if (!words.length) return [];
  if (words.length <= 2 || h.length <= 12) return [words.join(" ")];
  let best = 1, bestDiff = 1e9;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(" ").length, b = words.slice(i).join(" ").length;
    if (Math.abs(a - b) < bestDiff) { bestDiff = Math.abs(a - b); best = i; }
  }
  return [words.slice(0, best).join(" "), words.slice(best).join(" ")];
}

async function buildLegacyThumbnail(job, cfg, workDir, outFile, deps) {
  const hook = makeHook(job);
  if (!hook) return null;
  const plan = await thumbnailPlan(job, cfg);
  const style = styleKeywords[job.style] ? job.style : cfg.style;
  const subject = (plan && plan.imagePrompt) || hook;
  const imgPrompt = buildPrompt(subject + ", dramatic, cinematic, bold, high contrast, striking, eye catching", style);
  const src = path.join(workDir, "thumb_src.jpg");
  if (!(await deps.fetchImage(imgPrompt, 9182, src, cfg))) return null;

  const lines = toLines(hook);
  const font = findFont(cfg);
  const maxLen = Math.max(...lines.map((l) => l.length));
  const fontsize = maxLen <= 10 ? 122 : maxLen <= 16 ? 100 : maxLen <= 22 ? 82 : 66;
  const lh = Math.round(fontsize * 1.14);
  const gradStart = 720 - (lines.length > 1 ? 340 : 240);

  let fc = "[1]format=rgba,geq=r=0:g=0:b=0:a='min(235,max(0,235*(Y-" + gradStart + ")/" + (720 - gradStart) + "))'[g];";
  fc += "[0:v]scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720[v];";
  fc += "[v][g]overlay=format=auto";
  if (font && lines.length) {
    const draws = lines.map((ln, i) => {
      const fromBottom = 56 + (lines.length - 1 - i) * lh + fontsize;
      return "drawtext=fontfile='" + font + "':text='" + ln + "':fontcolor=white:fontsize=" + fontsize +
        ":borderw=9:bordercolor=black:shadowcolor=black@0.5:shadowx=5:shadowy=7:x=(w-text_w)/2:y=h-" + fromBottom;
    });
    fc += "," + draws.join(",");
  }
  fc += "[out]";
  await deps.run(cfg.ffmpeg, ["-y", "-i", src, "-f", "lavfi", "-i", "color=black:s=1280x720", "-filter_complex", fc, "-map", "[out]", "-frames:v", "1", "-update", "1", "-q:v", "3", outFile]);
  return fs.existsSync(outFile) ? outFile : null;
}

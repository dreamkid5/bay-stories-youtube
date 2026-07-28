// Rendering engine for the worker. Uses ffmpeg to turn scene images plus
// optional narration and music into a finished MP4. No browser required.

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { splitScript, buildPrompt, styleKeywords } from "./csv.mjs";
import { buildCharacterBible, sceneCharacterNote } from "./characters.mjs";
import { buildSceneVisuals } from "./visuals.mjs";
import { buildThumbnail } from "./thumbnail.mjs";
import { generateUniqueFemalePresenter } from "./presenter.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FONTS_DIR = path.join(HERE, "assets", "fonts");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// This channel has one immutable narrator voice. Keep the compatibility helper
// so older callers still work, but ignore every provider and voice override.
export const LOCKED_NARRATOR_VOICE = "en-US-JennyNeural";

export function femaleVoice() {
  return LOCKED_NARRATOR_VOICE;
}

// Escape a file path for use inside the ffmpeg subtitles filter argument.
function ffEscapePath(p) {
  return p.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

function run(cmd, args) {
  return new Promise((res, rej) => {
    const p = spawn(cmd, args);
    let err = "";
    p.stderr.on("data", (d) => { err += d.toString(); });
    p.on("error", rej);
    p.on("close", (code) => code === 0 ? res() : rej(new Error(cmd + " exited " + code + ": " + err.slice(-600))));
  });
}

function probeDuration(file, cfg) {
  return new Promise((res) => {
    const p = spawn(cfg.ffprobe, ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file]);
    let out = "";
    p.stdout.on("data", (d) => { out += d.toString(); });
    p.on("error", () => res(null));
    p.on("close", () => { const n = parseFloat(out.trim()); res(isFinite(n) && n > 0 ? n : null); });
  });
}

// ---------- asset fetching ----------
async function fetchImage(prompt, seed, outPath, cfg, opts = {}) {
  const token = cfg.imageToken ? "&token=" + encodeURIComponent(cfg.imageToken) : "";
  const w = Number(opts.width) || Number(cfg.width) || 1920;
  const h = Number(opts.height) || Number(cfg.height) || 1080;
  const attempts = Number(opts.attempts) || 6;
  const configuredTimeoutMs = Number(process.env.CF_IMAGE_REQUEST_TIMEOUT_MS || 90000);
  const requestTimeoutMs = Number.isFinite(configuredTimeoutMs)
    ? Math.max(10000, configuredTimeoutMs)
    : 90000;
  // Prompt enhancement improves the first try but adds a step that can fail. So we use
  // it only on the FIRST attempt (best quality) and drop it on retries (more reliable),
  // which lifts the success rate without losing quality when things go smoothly.
  const enhanceOn = opts.enhance !== undefined ? opts.enhance : (cfg.imageEnhance !== false);
  for (let attempt = 0; attempt < attempts; attempt++) {
    // Vary the seed on every attempt so a retry generates a genuinely NEW image for
    // this scene, rather than re-requesting the same one that just failed.
    const s = seed + attempt * 104729;
    const enhance = (enhanceOn && attempt === 0) ? "&enhance=true" : "";
    const url = cfg.imageBase + "/" + encodeURIComponent(prompt) +
      "?width=" + w + "&height=" + h + "&nologo=true" + enhance + "&model=" + cfg.imageModel + "&seed=" + s + token;
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(requestTimeoutMs) });
      if (r.ok) {
        const buf = Buffer.from(await r.arrayBuffer());
        if (buf.length > 1000) { await fs.writeFile(outPath, buf); return true; }
      } else if (r.status === 429 || r.status === 503) {
        // rate limited or busy, wait longer and try again
        const ra = parseInt(r.headers.get("retry-after") || "0", 10);
        await sleep(ra > 0 ? Math.min(60000, ra * 1000) : Math.min(45000, 6000 * (attempt + 1)));
        continue;
      }
    } catch (e) { /* network hiccup, retry */ }
    await sleep(2500 * (attempt + 1));
  }
  return false;
}

function xmlEscape(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

async function fetchTTS(script, voice, outPath, cfg) {
  try {
    // edge-tts: free Microsoft neural voices, no key and no card. Female voices only.
    // Text is passed via a temp file to avoid arg limits.
    if (cfg.ttsProvider === "edge") {
      const name = femaleVoice("edge", voice, cfg);
      const txt = outPath + ".txt";
      // tts_words.py writes the mp3 AND a sidecar of per-word timings (outPath.words.json)
      // that the caption engine uses to highlight each word as it is spoken.
      const wordsFile = outPath + ".words.json";
      await fs.writeFile(txt, script);
      try {
        await run(cfg.edgeCmd || "python3", [
          path.join(HERE, "tts_words.py"),
          txt, name, outPath, wordsFile,
          (cfg.edgeRate || "+0%"), (cfg.edgePitch || "+0Hz")
        ]);
      } finally {
        await fs.rm(txt, { force: true }).catch(() => {});
      }
      const st = await fs.stat(outPath).catch(() => null);
      return !!(st && st.size > 1000);
    }
    // Local voice server: free, no card, no key, runs on your machine
    if (cfg.ttsProvider === "local" && cfg.localTtsUrl) {
      const r = await fetch(cfg.localTtsUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: script }) });
      if (r.ok && (r.headers.get("content-type") || "").includes("audio")) { await fs.writeFile(outPath, Buffer.from(await r.arrayBuffer())); return true; }
      return false;
    }
    // Azure Speech: 500k characters a month free, no card needed
    if (cfg.ttsProvider === "azure" && cfg.azureKey) {
      const name = femaleVoice("azure", voice, cfg);
      const lang = name.slice(0, 5);
      // Wrap the narration in a warm, measured storytelling cadence (griot pace).
      const rate = cfg.azureRate || "0%";
      const pitch = cfg.azurePitch || "0%";
      const inner = "<prosody rate='" + rate + "' pitch='" + pitch + "'>" + xmlEscape(script) + "</prosody>";
      const ssml = "<speak version='1.0' xmlns:mstts='https://www.w3.org/2001/mstts' xml:lang='" + lang + "'><voice xml:lang='" + lang + "' name='" + name + "'>" + inner + "</voice></speak>";
      const r = await fetch("https://" + cfg.azureRegion + ".tts.speech.microsoft.com/cognitiveservices/v1", {
        method: "POST",
        headers: {
          "Ocp-Apim-Subscription-Key": cfg.azureKey,
          "Content-Type": "application/ssml+xml",
          "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
          "User-Agent": "creatorflow-worker"
        },
        body: ssml
      });
      if (r.ok) { await fs.writeFile(outPath, Buffer.from(await r.arrayBuffer())); return true; }
      return false;
    }
    // Google Cloud Text to Speech: large free tier, great for volume
    if (cfg.ttsProvider === "google" && cfg.googleKey) {
      const name = femaleVoice("google", voice, cfg);
      const lang = name.slice(0, 5);
      const r = await fetch("https://texttospeech.googleapis.com/v1/text:synthesize?key=" + cfg.googleKey, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: { text: script }, voice: { languageCode: lang, name }, audioConfig: { audioEncoding: "MP3" } })
      });
      if (r.ok) { const j = await r.json(); if (j.audioContent) { await fs.writeFile(outPath, Buffer.from(j.audioContent, "base64")); return true; } }
      return false;
    }
    // ElevenLabs: top quality, smaller free tier
    if (cfg.ttsProvider === "elevenlabs" && cfg.elevenKey) {
      const voiceId = femaleVoice("elevenlabs", voice, cfg);
      const r = await fetch("https://api.elevenlabs.io/v1/text-to-speech/" + voiceId, {
        method: "POST",
        headers: { "Content-Type": "application/json", "xi-api-key": cfg.elevenKey, "Accept": "audio/mpeg" },
        body: JSON.stringify({ text: script, model_id: "eleven_multilingual_v2" })
      });
      if (r.ok && (r.headers.get("content-type") || "").includes("audio")) { await fs.writeFile(outPath, Buffer.from(await r.arrayBuffer())); return true; }
      return false;
    }
    // OpenAI compatible
    if (cfg.ttsKey) {
      const v = femaleVoice("openai", voice, cfg);
      const r = await fetch(cfg.ttsUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + cfg.ttsKey },
        body: JSON.stringify({ model: cfg.ttsModel, voice: v, input: script, response_format: "mp3" })
      });
      const ct = r.headers.get("content-type") || "";
      if (r.ok && ct.includes("audio")) { await fs.writeFile(outPath, Buffer.from(await r.arrayBuffer())); return true; }
    }
  } catch (e) { /* skip narration */ }
  return false;
}

async function fetchMusic(url, outPath) {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const ct = r.headers.get("content-type") || "";
    if (!ct.includes("audio") && !/\.(mp3|m4a|ogg|wav)($|\?)/i.test(url)) return null;
    await fs.writeFile(outPath, Buffer.from(await r.arrayBuffer()));
    return outPath;
  } catch (e) { return null; }
}

// ---------- ffmpeg steps ----------
// A single still becomes a gently drifting clip (Ken Burns).
// Uses a scale based zoom rather than the zoompan filter, which is dozens of
// times faster, so videos with many scenes render in minutes, not hours.
// The zoom is kept subtle (default 6%) and alternates direction per scene so the
// motion feels natural and cinematic rather than pushed in too far. Tune with CF_ZOOM.
function kenBurnsVf(dur, cfg, idx) {
  const D = Math.max(0.1, dur);
  const W = Number(cfg.width) || 1920, H = Number(cfg.height) || 1080;
  const zoom = Math.min(0.2, Math.max(0, Number(cfg.zoom) || 0.06));
  const hi = (1 + zoom).toFixed(3);
  const z = (idx % 2 === 0) ? "(1+" + zoom + "*t/" + D + ")" : "(" + hi + "-" + zoom + "*t/" + D + ")";
  return "scale=" + W + ":" + H + ":force_original_aspect_ratio=increase,crop=" + W + ":" + H + "," +
    "scale=w='" + W + "*" + z + "':h='" + H + "*" + z + "':eval=frame,crop=" + W + ":" + H + ",format=yuv420p";
}

function kenBurnsClip(imgPath, outPath, dur, cfg, idx = 0) {
  const crf = String(Number(cfg.crf) || 20);
  return run(cfg.ffmpeg, ["-y", "-loop", "1", "-t", String(dur), "-i", imgPath, "-vf", kenBurnsVf(dur, cfg, idx), "-r", "30", "-c:v", "libx264", "-preset", "veryfast", "-crf", crf, "-pix_fmt", "yuv420p", outPath]);
}

// A self-contained scene clip: the image (with Ken Burns motion) plus THIS scene's
// own narration muxed in, both the same length. Because each image and its narration
// live in the same clip, they can never drift apart when the clips are joined, so the
// pictures stay locked to the voice for the whole video. If a scene has no narration,
// a matching stretch of silence is used so every clip has an identical audio layout.
function sceneClipWithAudio(imgPath, audioPath, outPath, dur, cfg, idx = 0) {
  const crf = String(Number(cfg.crf) || 20);
  const args = ["-y", "-loop", "1", "-t", String(dur), "-i", imgPath];
  if (audioPath) args.push("-i", audioPath);
  else args.push("-f", "lavfi", "-t", String(dur), "-i", "anullsrc=channel_layout=mono:sample_rate=24000");
  args.push(
    "-vf", kenBurnsVf(dur, cfg, idx),
    "-r", "30", "-c:v", "libx264", "-preset", "veryfast", "-crf", crf, "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "160k", "-ar", "24000", "-ac", "1",
    "-map", "0:v:0", "-map", "1:a:0", "-t", String(dur), outPath
  );
  return run(cfg.ffmpeg, args);
}

// Ken Burns filter for an arbitrary panel size (used for the story panel that sits
// beside the presenter, so it is narrower than the full frame).
function kenBurnsVfSize(dur, cfg, idx, W, H) {
  const D = Math.max(0.1, dur);
  const zoom = Math.min(0.2, Math.max(0, Number(cfg.zoom) || 0.06));
  const hi = (1 + zoom).toFixed(3);
  const z = (idx % 2 === 0) ? "(1+" + zoom + "*t/" + D + ")" : "(" + hi + "-" + zoom + "*t/" + D + ")";
  return "scale=" + W + ":" + H + ":force_original_aspect_ratio=increase,crop=" + W + ":" + H + "," +
    "scale=w='" + W + "*" + z + "':h='" + H + "*" + z + "':eval=frame,crop=" + W + ":" + H + ",setsar=1";
}

// The presenter panel. By default it is STILL (zoom 0) — only the scene photos zoom.
// If CF_PRESENTER_ZOOM is set it gets a gentle centred Ken Burns push-in that alternates
// direction per scene (like the story panel) so the zoom level carries across hard cuts.
function presenterKenBurns(dur, cfg, idx, W, H) {
  const D = Math.max(0.1, dur);
  const zoom = Math.min(0.12, Math.max(0, cfg.presenterZoom == null ? 0 : Number(cfg.presenterZoom)));
  if (!zoom) return "scale=" + W + ":" + H + ":force_original_aspect_ratio=increase,crop=" + W + ":" + H + ",setsar=1";
  const hi = (1 + zoom).toFixed(3);
  const z = (idx % 2 === 0) ? "(1+" + zoom + "*t/" + D + ")" : "(" + hi + "-" + zoom + "*t/" + D + ")";
  return "scale=" + W + ":" + H + ":force_original_aspect_ratio=increase,crop=" + W + ":" + H + "," +
    "scale=w='" + W + "*" + z + "':h='" + H + "*" + z + "':eval=frame,crop=" + W + ":" + H + ",setsar=1";
}

// A storytime scene clip: a presenter portrait on the LEFT (with subtle camera motion),
// the scene photo on the RIGHT (with gentle motion), this scene's narration, and karaoke
// captions burned on top that highlight each word as it is spoken. presenter and assPath
// are optional; without a presenter it falls back to a full-frame image.
function sceneClipComposite(presenter, story, audioPath, assPath, outPath, dur, cfg, idx = 0) {
  const crf = String(Number(cfg.crf) || 20);
  const W = Number(cfg.width) || 1920, H = Number(cfg.height) || 1080;
  const Pw = Math.round(W * (Number(cfg.presenterFrac) || 0.38)); // presenter panel width
  const Sw = W - Pw;                                              // story panel width
  const args = ["-y"];
  const useComposite = !!presenter;
  if (useComposite) args.push("-loop", "1", "-t", String(dur), "-i", presenter);
  args.push("-loop", "1", "-t", String(dur), "-i", story);
  const audioIdx = useComposite ? 2 : 1;
  if (audioPath) args.push("-i", audioPath);
  else args.push("-f", "lavfi", "-t", String(dur), "-i", "anullsrc=channel_layout=mono:sample_rate=24000");

  const subs = assPath ? ",subtitles='" + ffEscapePath(assPath) + "':fontsdir='" + ffEscapePath(FONTS_DIR) + "'" : "";
  let filter;
  if (useComposite) {
    filter =
      "[0:v]" + presenterKenBurns(dur, cfg, idx, Pw, H) + "[L];" +
      "[1:v]" + kenBurnsVfSize(dur, cfg, idx, Sw, H) + "[R];" +
      "[L][R]hstack=inputs=2,format=yuv420p" + subs + "[v]";
  } else {
    filter = "[1:v]" + kenBurnsVf(dur, cfg, idx) + ",format=yuv420p" + subs + "[v]";
  }
  args.push(
    "-filter_complex", filter, "-map", "[v]", "-map", audioIdx + ":a:0",
    "-r", "30", "-c:v", "libx264", "-preset", "veryfast", "-crf", crf, "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "160k", "-ar", "24000", "-ac", "1", "-t", String(dur), outPath
  );
  return run(cfg.ffmpeg, args);
}

// Generate the per-scene ASS caption file from that scene's word timings.
async function buildSceneCaptions(wordsFile, assPath, cfg) {
  const W = Number(cfg.width) || 1920, H = Number(cfg.height) || 1080;
  const fontSize = Math.round(H * (Number(cfg.capSizeFrac) || 0.062));
  await run(cfg.edgeCmd || "python3", [
    path.join(HERE, "captions.py"),
    wordsFile, assPath, String(W), String(H),
    path.join(FONTS_DIR, cfg.capFontFile || "Montserrat-ExtraBold.ttf"),
    cfg.capFontName || "Montserrat ExtraBold",
    String(fontSize), cfg.capHighlight || "#6A12C0",
    String(Number(cfg.capMaxWords) || 4), String(Number(cfg.capYFrac) || 0.72)
  ]);
}

// Mix looping background music UNDER a video that already has a narration track.
async function mixMusicUnder(videoWithNarration, music, total, outPath, cfg) {
  const args = ["-y", "-i", videoWithNarration, "-stream_loop", "-1", "-i", music,
    "-filter_complex", "[1:a]volume=0.3[m];[0:a][m]amix=inputs=2:duration=first:dropout_transition=0[a]",
    "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-t", String(total), outPath];
  await run(cfg.ffmpeg, args);
  const st = await fs.stat(outPath).catch(() => null);
  if (!st || st.size < 1000) throw new Error("music mix produced no output");
  return outPath;
}

// Join clips with clean hard cuts, no re-encode. Scales to any number of clips.
async function fastConcat(clips, outPath, cfg) {
  // keep only clips that actually exist and are non trivial
  const good = [];
  for (const c of clips) { try { const st = await fs.stat(c); if (st.size > 1000) good.push(c); } catch (e) {} }
  if (!good.length) throw new Error("no valid clips to join");
  const listFile = path.join(path.dirname(outPath), "concat_list.txt");
  // absolute paths so the concat demuxer resolves them correctly regardless of cwd
  await fs.writeFile(listFile, good.map((c) => "file '" + path.resolve(c).replace(/'/g, "'\\''") + "'").join("\n"));
  try {
    await run(cfg.ffmpeg, ["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", outPath]);
  } catch (e) {
    // fallback: re-encode on join, which tolerates any small differences between clips.
    // Keep the audio track (scene clips carry narration) so sound is never dropped.
    cfg.log("  fast join fell back to a re-encode");
    await run(cfg.ffmpeg, ["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-r", "30", "-c:v", "libx264", "-preset", "veryfast", "-crf", String(Number(cfg.crf) || 20), "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", outPath]);
  }
  const st = await fs.stat(outPath).catch(() => null);
  if (!st || st.size < 1000) throw new Error("join produced no output");
  return outPath;
}

// Chain the clips together. Crossfades for a handful of scenes; clean hard cuts
// for many short scenes, which is fast, reliable, and the standard punchy look.
async function crossfadeConcat(clips, outPath, dur, TR, cfg) {
  if (clips.length === 1) return run(cfg.ffmpeg, ["-y", "-i", clips[0], "-c", "copy", outPath]);
  const maxXfade = Number(process.env.CF_MAX_CROSSFADE || 60);
  if (clips.length > maxXfade) return fastConcat(clips, outPath, cfg);
  const args = ["-y"];
  clips.forEach((c) => args.push("-i", c));
  let filter = "", last = "";
  for (let k = 0; k < clips.length - 1; k++) {
    const off = ((k + 1) * (dur - TR)).toFixed(3);
    const outLbl = "vx" + k;
    const inLbl = k === 0 ? "[0:v][1:v]" : "[" + last + "][" + (k + 1) + ":v]";
    filter += inLbl + "xfade=transition=fade:duration=" + TR + ":offset=" + off + "[" + outLbl + "];";
    last = outLbl;
  }
  filter = filter.replace(/;$/, "");
  args.push("-filter_complex", filter, "-map", "[" + last + "]", "-r", "30", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", outPath);
  try {
    await run(cfg.ffmpeg, args);
  } catch (e) {
    // if the crossfade graph ever errors, fall back to the simple, always-works join
    cfg.log("  crossfade failed, using the simple join instead");
    return fastConcat(clips, outPath, cfg);
  }
  const st = await fs.stat(outPath).catch(() => null);
  if (!st || st.size < 1000) return fastConcat(clips, outPath, cfg);
  return outPath;
}

// True only if the file has an audio stream.
function hasAudioStream(file, cfg) {
  return new Promise((res) => {
    const p = spawn(cfg.ffprobe, ["-v", "error", "-select_streams", "a", "-show_entries", "stream=codec_type", "-of", "csv=p=0", file]);
    let out = "";
    p.stdout.on("data", (d) => { out += d.toString(); });
    p.on("error", () => res(false));
    p.on("close", () => res(out.includes("audio")));
  });
}

// Lay narration and music under the finished visuals. A narrated documentary MUST
// end up with audio, so this retries with a re-encode and then verifies the output
// truly has an audio stream. If narration cannot be attached, it throws, and the
// caller fails the video (to be retried) rather than ever saving a silent one.
async function muxAudio(video, narration, music, outPath, total, cfg) {
  function build(reencode) {
    const args = ["-y", "-i", video];
    if (narration) args.push("-i", narration);
    if (music) args.push("-stream_loop", "-1", "-i", music);
    const nIdx = narration ? 1 : null;
    const mIdx = music ? (narration ? 2 : 1) : null;
    let filter = null, audioMap = null;
    if (narration && music) {
      filter = "[" + mIdx + ":a]volume=0.35[m];[" + nIdx + ":a][m]amix=inputs=2:duration=first:dropout_transition=0[aout]";
      audioMap = "[aout]";
    } else if (narration) {
      audioMap = nIdx + ":a";
    } else if (music) {
      filter = "[" + mIdx + ":a]volume=0.5[aout]";
      audioMap = "[aout]";
    }
    if (filter) args.push("-filter_complex", filter);
    args.push("-map", "0:v");
    if (audioMap) args.push("-map", audioMap);
    args.push("-c:v", reencode ? "libx264" : "copy");
    if (reencode) args.push("-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p");
    if (audioMap) args.push("-c:a", "aac", "-b:a", "160k");
    args.push("-t", String(total), outPath);
    return args;
  }
  try {
    await run(cfg.ffmpeg, build(false));
  } catch (e) {
    cfg.log("  audio step retrying with a re-encode");
    await run(cfg.ffmpeg, build(true));
  }
  const st = await fs.stat(outPath).catch(() => null);
  if (!st || st.size < 1000) throw new Error("the audio step produced no output");
  // a narrated video with no audio is useless, so treat that as a failure
  if (narration && !(await hasAudioStream(outPath, cfg))) {
    throw new Error("the narration did not attach to the video");
  }
  return outPath;
}

// Produce a deterministic render plan without fetching images or invoking ffmpeg.
// This keeps the 35-minute/one-hour production contract directly testable.
function splitIntoWordScenes(script, targetWords) {
  const words = script.trim().replace(/[ \t]+/g, " ").replace(/\n+/g, " ").split(/\s+/).filter(Boolean);
  const scenes = [];
  for (let i = 0; i < words.length; i += targetWords) {
    scenes.push(words.slice(i, i + targetWords).join(" "));
  }
  return scenes.length ? scenes : [script.trim()];
}

export function planVideoScenes(script, cfg = {}, env = process.env) {
  const wps = Number(cfg.wps) || 2.4;
  const totalWords = script.trim().split(/\s+/).filter(Boolean).length;
  const estMinutes = totalWords / wps / 60;
  const hdMaxMinutes = Number(env.CF_HD_MAX_MINUTES || 35);
  // Exactly 35 minutes belongs to the long-form 720p profile.
  const isShort = estMinutes < hdMaxMinutes;
  const targetSec = Math.max(1.5, isShort
    ? Number(env.CF_SHORT_SCENE_SECONDS || 5)
    : (Number(cfg.sceneSeconds) || 5));
  const maxScenes = Math.max(20, Number(env.CF_MAX_SCENES || 720));
  let targetWords = Math.max(3, Math.round(targetSec * wps));
  if (Math.ceil(totalWords / targetWords) > maxScenes) {
    targetWords = Math.ceil(totalWords / maxScenes);
  }
  // At the five-second production cadence, fixed word groups avoid clause-length
  // overshoot and keep the visual changes very close to the requested timing.
  const makeScenes = targetSec <= 5
    ? (text, words) => splitIntoWordScenes(text, words)
    : (text, words) => splitScript(text, words);
  let scenes = makeScenes(script, targetWords);
  // Scenes are built from whole clauses, so they always land a little OVER the word
  // target. Measure the real average and correct once.
  const firstAvg = scenes.length ? totalWords / wps / scenes.length : targetSec;
  if (firstAvg > targetSec * 1.12) {
    targetWords = Math.max(3, Math.round(targetWords * (targetSec / firstAvg)));
    scenes = makeScenes(script, targetWords);
  }
  // Enforce the scene budget by stretching scenes, never by truncating narration.
  if (scenes.length > maxScenes) {
    targetWords = Math.ceil(targetWords * (scenes.length / maxScenes) + 1);
    scenes = makeScenes(script, targetWords);
  }
  const avgSec = scenes.length ? (totalWords / wps / scenes.length) : targetSec;
  return { scenes, totalWords, estMinutes, isShort, targetSec, maxScenes, avgSec, hdMaxMinutes };
}

// ---------- orchestration ----------
export async function renderJob(job, cfg, workDir, outFile) {
  await fs.mkdir(workDir, { recursive: true });
  const style = styleKeywords[job.style] ? job.style : cfg.style;

  // The final duration of each scene comes from its narration, so pictures stay
  // locked to the voice. The plan only controls visual cadence and resolution.
  const plan = planVideoScenes(job.script, cfg);
  const { scenes, totalWords, estMinutes, isShort, targetSec, maxScenes, avgSec, hdMaxMinutes } = plan;
  cfg.log("  ~" + estMinutes.toFixed(0) + " min video: " + (isShort
    ? "1080p, aiming for " + targetSec + "s scenes"
    : "long video, 720p, aiming for " + targetSec + "s scenes"));
  if (scenes.length >= maxScenes) {
    cfg.log("  long script (" + totalWords + " words): stretching scenes so the whole story fits in " + maxScenes + " scenes");
  }
  cfg.log("  " + scenes.length + " scenes, about " + avgSec.toFixed(1) + "s each, synced to the voice");

  // Resolution follows the same tier: 1080p below 35 minutes, 720p from 35 minutes.
  if (!isShort && (Number(cfg.width) || 1920) > 1280) {
    cfg = { ...cfg, width: 1280, height: 720 };
    cfg.log("  " + hdMaxMinutes + " min or longer: rendering at 720p so it finishes safely");
  }

  // Channel lock: every video is rendered in storytime mode with one fresh female
  // presenter on the left. Style values and configuration must not bypass this.
  const storyMode = true;
  let presenter = null;
  if (storyMode) {
    const generatedPresenter = await generateUniqueFemalePresenter({
      job,
      cfg,
      workDir,
      fetchImage
    });
    if (!generatedPresenter || !generatedPresenter.file) {
      throw new Error("female presenter generation failed; refusing to render without a female presenter");
    }
    presenter = generatedPresenter.file;
    job.presenterFile = presenter;
    job.gender = "female";
    cfg.log("  presenter: new female identity " + generatedPresenter.identity + " (left)");
  }

  // Character bible: keep the main characters looking the same across scenes.
  let bible = null;
  if (cfg.anthropicKey && cfg.characters !== false) {
    bible = await buildCharacterBible(job.script, cfg);
    if (bible && bible.characters.length) cfg.log("  character bible: " + bible.characters.map((c) => c.name).join(", "));
  }

  // Scene matching: turn each stretch of narration into a concrete VISUAL prompt so
  // the image matches the meaning, not the literal words. Falls back to raw text.
  let visuals = null;
  if (cfg.anthropicKey && cfg.sceneVisuals !== false) {
    visuals = await buildSceneVisuals(scenes, bible, cfg);
    if (visuals) cfg.log("  scene matching: on (" + visuals.filter(Boolean).length + "/" + scenes.length + " scenes visualized)");
  }
  // Build each scene's image prompt first (sequentially, so the character carry
  // forward stays correct), then fetch the images several at a time for speed.
  const charState = { active: null };
  const prompts = scenes.map((s, i) =>
    (visuals && visuals[i]) ? visuals[i] : (s + sceneCharacterNote(s, bible, charState)));

  const results = new Array(scenes.length).fill(null);
  const CONC = Math.max(1, Number(process.env.CF_IMG_CONCURRENCY || 2));
  let next = 0, done = 0;
  async function imgWorker() {
    while (true) {
      const i = next++;
      if (i >= scenes.length) return;
      const p = path.join(workDir, "img" + i + ".jpg");
      if (await fetchImage(buildPrompt(prompts[i], style), 3000 + i * 7, p, cfg)) results[i] = p;
      done++;
      if (done % 20 === 0 || done === scenes.length) cfg.log("  images " + done + "/" + scenes.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONC, scenes.length) }, imgWorker));

  // Regeneration pass: any scene whose image failed is generated fresh, with a NEW
  // seed each time (never a reused neighbour). Runs one at a time to be gentle on the
  // image service; later rounds fall back to 720p, which it almost never refuses, so
  // every scene ends up with its OWN generated picture.
  const repairRounds = Number(process.env.CF_IMG_REPAIR_ROUNDS || 8);
  for (let round = 1; round <= repairRounds; round++) {
    const missing = [];
    for (let i = 0; i < scenes.length; i++) if (!results[i]) missing.push(i);
    if (!missing.length) break;
    // After the first couple of rounds, drop to 720p, which the service almost never
    // refuses, so stragglers still get their own freshly generated picture quickly.
    const lowRes = round > 2 ? { width: 1280, height: 720 } : {};
    cfg.log("  regenerating " + missing.length + " image(s) (round " + round + (round > 2 ? ", 720p" : "") + ")");
    for (const i of missing) {
      const p = path.join(workDir, "img" + i + ".jpg");
      const seed = 500000 + i * 131 + round * 91193;
      // retries skip enhance for reliability
      if (await fetchImage(buildPrompt(prompts[i], style), seed, p, cfg, { ...lowRes, attempts: 4, enhance: false })) results[i] = p;
    }
  }
  const imgs = results.filter(Boolean);
  if (!imgs.length) throw new Error("no images were generated");
  const stillMissing = results.filter((r) => !r).length;
  if (stillMissing) cfg.log("  note: " + stillMissing + " scene(s) could not get an image and will be skipped");

  let music = null;
  if (job.music) music = await fetchMusic(job.music, path.join(workDir, "music.bin"));
  else if (cfg.music) music = cfg.music;

  // Per-scene narration: narrate EACH scene on its own so we know exactly how long
  // its line takes to speak. That per-scene length becomes the scene's on-screen time,
  // which is what keeps every picture in step with the audio, with no drift.
  const audios = new Array(scenes.length).fill(null);
  const durs = new Array(scenes.length).fill(targetSec);
  if (cfg.ttsEnabled) {
    const TCONC = Math.max(1, Number(process.env.CF_TTS_CONCURRENCY || 4));
    let tn = 0, td = 0;
    async function ttsWorker() {
      while (true) {
        const i = tn++;
        if (i >= scenes.length) return;
        // Narrate every scene. By now the regeneration pass has given each scene its
        // own image, so every narrated line has a matching, freshly generated picture.
        const ap = path.join(workDir, "voice" + i + ".mp3");
        if (await fetchTTS(scenes[i], job.voice, ap, cfg)) {
          const d = await probeDuration(ap, cfg);
          if (d) { audios[i] = ap; durs[i] = Math.max(1.0, d); }
        }
        td++;
        if (td % 20 === 0 || td === scenes.length) cfg.log("  narration " + td + "/" + scenes.length);
      }
    }
    await Promise.all(Array.from({ length: Math.min(TCONC, scenes.length) }, ttsWorker));
  }
  const haveAudio = cfg.ttsEnabled;

  // Build one self-contained clip per scene (its OWN image + its own narration), then
  // join. Each scene uses the image generated for it; the regeneration pass above makes
  // sure that image exists, so no scene ever borrows another scene's picture.
  cfg.log("  rendering " + scenes.length + " scenes at " + (cfg.width || 1920) + "x" + (cfg.height || 1080) +
    (storyMode ? " (presenter + captions)" : ""));
  const clips = [];
  let total = 0;
  for (let i = 0; i < scenes.length; i++) {
    const img = results[i];
    if (!img) continue; // extremely rare: this one scene could not be generated, skip it
    const c = path.join(workDir, "clip" + i + ".mp4");
    try {
      if (storyMode) {
        // Build this scene's captions from its own word timings, then composite
        // presenter (left) + scene photo (right) + captions in one pass.
        let ass = null;
        const wf = audios[i] ? audios[i] + ".words.json" : null;
        if (wf && await fs.stat(wf).catch(() => null)) {
          ass = path.join(workDir, "cap" + i + ".ass");
          try { await buildSceneCaptions(wf, ass, cfg); } catch (e) { ass = null; cfg.log("  captions skipped scene " + (i + 1) + ": " + String(e.message).slice(0, 80)); }
        }
        await sceneClipComposite(presenter, img, audios[i], ass, c, durs[i], cfg, i);
      } else if (haveAudio) {
        await sceneClipWithAudio(img, audios[i], c, durs[i], cfg, i);
      } else {
        await kenBurnsClip(img, c, durs[i], cfg, i);
      }
      const st = await fs.stat(c);
      if (st.size > 1000) { clips.push(c); total += durs[i]; }
    } catch (e) {
      cfg.log("  scene clip " + (i + 1) + " skipped: " + String(e.message).slice(0, 90));
    }
  }
  if (!clips.length) throw new Error("no clips were rendered");

  if (haveAudio) {
    // Each clip already carries its own narration, so a plain hard-cut join keeps the
    // voice perfectly in sync. Then mix any background music under the whole thing.
    const joined = music ? path.join(workDir, "joined.mp4") : outFile;
    await fastConcat(clips, joined, cfg);
    if (music) await mixMusicUnder(joined, music, total, outFile, cfg);
    if (!(await hasAudioStream(outFile, cfg))) throw new Error("the narration did not attach to the video");
  } else {
    // No narration: use gentle crossfades and lay any music underneath.
    const silent = path.join(workDir, "silent.mp4");
    await crossfadeConcat(clips, silent, durs[0] || targetSec, 0.6, cfg);
    if (music) await muxAudio(silent, null, music, outFile, total, cfg);
    else await fs.copyFile(silent, outFile);
  }

  // Auto thumbnail: a bold, professional 1280x720 image that matches the video.
  if (cfg.thumbnails) {
    try {
      const thumbFile = outFile.replace(/\.(mp4|webm)$/i, "-thumbnail.jpg");
      const t = await buildThumbnail(job, cfg, workDir, thumbFile, { fetchImage, run });
      if (t) { job.thumbnailFile = thumbFile; cfg.log("  thumbnail: " + path.basename(thumbFile)); }
    } catch (e) { cfg.log("  thumbnail skipped: " + e.message); }
  }

  return outFile;
}

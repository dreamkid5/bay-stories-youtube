// Griot Studio background worker.
// Watches an input folder for CSV files and renders a finished MP4 for every
// row, saving them to an output folder. Run continuously, or once from cron.
//
//   node watch.mjs            watch the folder on an interval
//   node watch.mjs --once     process any new CSVs once, then exit (use with cron)
//
// Requires Node 18 or newer and ffmpeg (with ffprobe) on the PATH.

import fs from "node:fs/promises";
import path from "node:path";
import { jobsFromCSV, slug } from "./csv.mjs";
import { LOCKED_NARRATOR_VOICE, renderJob } from "./render.mjs";
import { uploadToYouTube } from "./upload.mjs";
import { generateSEO } from "./seo.mjs";

// Load worker/.env if present, so keys live in one file.
try { process.loadEnvFile(); } catch (e) { /* no .env, that is fine */ }

const cfg = {
  input: process.env.CF_INPUT || "./input",
  output: process.env.CF_OUTPUT || "./output",
  style: process.env.CF_STYLE || "story",
  sceneSeconds: Number(process.env.CF_SCENE_SECONDS || 4.2),
  // Ken Burns zoom strength. Subtle by default so shots feel natural, not pushed in.
  zoom: Number(process.env.CF_ZOOM || 0.06),
  // Presenter panel stays still by default (only the scene photos zoom). Set
  // CF_PRESENTER_ZOOM to a small value like 0.05 to give the presenter a gentle push-in.
  presenterZoom: Number(process.env.CF_PRESENTER_ZOOM || 0),
  // Output resolution and quality. 1080p with a low CRF for crisp video.
  width: Number(process.env.CF_WIDTH || 1920),
  height: Number(process.env.CF_HEIGHT || 1080),
  crf: Number(process.env.CF_CRF || 20),
  // Words per second, used only to estimate how many words make one ~target-second scene.
  wps: Number(process.env.CF_WPS || 2.4),
  imageBase: process.env.CF_IMAGE_BASE || "https://image.pollinations.ai/prompt",
  imageModel: process.env.CF_IMAGE_MODEL || "flux",
  imageToken: process.env.CF_IMAGE_TOKEN || "",
  // Prompt enhancement: nicer first try, but a bit more likely to fail. CF_IMAGE_ENHANCE=0 to disable.
  imageEnhance: process.env.CF_IMAGE_ENHANCE === "0" ? false : true,
  ttsKey: process.env.TTS_API_KEY || "",
  ttsUrl: process.env.CF_TTS_URL || "https://api.openai.com/v1/audio/speech",
  ttsModel: process.env.CF_TTS_MODEL || "gpt-4o-mini-tts",
  ttsVoice: process.env.CF_TTS_VOICE || "nova",
  // edge-tts: free Microsoft neural voices, NO key, NO card. Female-only narration.
  // Invoked as: python3 -m edge_tts. Install once with: pip install edge-tts
  edgeCmd: process.env.CF_EDGE_CMD || "python3",
  edgeVoice: LOCKED_NARRATOR_VOICE,
  edgeRate: process.env.CF_EDGE_RATE || "-5%",
  edgePitch: process.env.CF_EDGE_PITCH || "+0Hz",
  femaleVoice: LOCKED_NARRATOR_VOICE,
  // local voice server, free and no card
  localTtsUrl: process.env.LOCAL_TTS_URL || "",
  // premium voice providers, choose by which key is set
  azureKey: process.env.AZURE_SPEECH_KEY || "",
  azureRegion: process.env.AZURE_SPEECH_REGION || "eastus",
  // Nigerian English female storyteller.
  azureVoice: process.env.CF_AZURE_VOICE || "en-NG-EzinneNeural",
  // Storytelling cadence: a measured, warm griot pace and a touch of pitch warmth.
  azureRate: process.env.CF_AZURE_RATE || "-6%",
  azurePitch: process.env.CF_AZURE_PITCH || "-2%",
  googleKey: process.env.GOOGLE_TTS_KEY || "",
  googleVoice: process.env.CF_GOOGLE_VOICE || "en-US-Studio-O",
  elevenKey: process.env.ELEVENLABS_API_KEY || "",
  elevenVoice: process.env.CF_ELEVEN_VOICE || "21m00Tcm4TlvDq8ikWAM",
  music: process.env.CF_MUSIC || "",
  ffmpeg: process.env.CF_FFMPEG || "ffmpeg",
  ffprobe: process.env.CF_FFPROBE || "ffprobe",
  interval: Number(process.env.CF_INTERVAL || 30),
  // YouTube upload
  ytClientId: process.env.YT_CLIENT_ID || "",
  ytClientSecret: process.env.YT_CLIENT_SECRET || "",
  ytRefreshToken: process.env.YT_REFRESH_TOKEN || "",
  ytPrivacy: process.env.CF_YT_PRIVACY || "private",
  ytCategory: process.env.CF_YT_CATEGORY || "27",
  ytTags: (process.env.CF_YT_TAGS || "").split(",").map((s) => s.trim()).filter(Boolean),
  ytFooter: process.env.CF_YT_FOOTER || "",
  // SEO metadata via the Claude API
  anthropicKey: process.env.ANTHROPIC_API_KEY || "",
  seoModel: process.env.CF_SEO_MODEL || "claude-haiku-4-5-20251001",
  log: (m) => console.log(m)
};
cfg.ytUpload = process.env.CF_YT_UPLOAD === "0" ? false : !!(cfg.ytClientId && cfg.ytClientSecret && cfg.ytRefreshToken);
// Automated publishing is permanently locked to Microsoft's Jenny voice.
// Environment variables, CSV fields, and configured premium providers cannot
// change the narrator.
cfg.ttsProvider = "edge";
cfg.edgeVoice = LOCKED_NARRATOR_VOICE;
cfg.femaleVoice = LOCKED_NARRATOR_VOICE;
cfg.ttsEnabled = true;
// auto SEO (Claude writes titles, descriptions, tags): disabled with CF_SEO=0
cfg.seoEnabled = process.env.CF_SEO === "0" ? false : !!cfg.anthropicKey;
// character consistency: on by default when a Claude key is set, disable with CF_CHARACTERS=0
cfg.characters = process.env.CF_CHARACTERS === "0" ? false : true;
// scene matching: Claude turns narration into visual prompts so images fit. CF_SCENE_VISUALS=0 to disable
cfg.sceneVisuals = process.env.CF_SCENE_VISUALS === "0" ? false : true;
// auto thumbnail: on by default, disable with CF_THUMBNAILS=0
cfg.thumbnails = process.env.CF_THUMBNAILS === "0" ? false : true;
// archive published scripts to the published/ folder. Set CF_ARCHIVE=0 for a pure
// "generate only" run that re-renders every time (used by the generate workflow).
cfg.archive = process.env.CF_ARCHIVE === "0" ? false : true;
cfg.font = process.env.CF_FONT || "";

const stamp = () => new Date().toISOString().replace("T", " ").slice(0, 19);
const log = (m) => console.log("[" + stamp() + "] " + m);

// Time budget. CI runners kill a job at a hard limit (GitHub: 6 hours), which would
// throw away hours of work and leave the script unpublished, so it retries forever.
// Instead we stop STARTING new videos once the budget is spent and leave the rest for
// the next run. CF_TIME_BUDGET_MIN=0 (the default) means no limit, for local runs.
const RUN_START = Date.now();
const TIME_BUDGET_MIN = Number(process.env.CF_TIME_BUDGET_MIN || 0);
const REQUIRE_INPUT = process.env.CF_REQUIRE_INPUT === "1";
const minsElapsed = () => (Date.now() - RUN_START) / 60000;
function outOfTime() {
  return TIME_BUDGET_MIN > 0 && minsElapsed() > TIME_BUDGET_MIN;
}

async function ensureDirs() {
  await fs.mkdir(cfg.input, { recursive: true });
  await fs.mkdir(cfg.output, { recursive: true });
}

async function loadProcessed() {
  try { return new Set(JSON.parse(await fs.readFile(path.join(cfg.output, ".cf-processed.json"), "utf8"))); }
  catch (e) { return new Set(); }
}
async function saveProcessed(set) {
  await fs.writeFile(path.join(cfg.output, ".cf-processed.json"), JSON.stringify([...set], null, 2));
}

async function listNewCSVs(processed) {
  const entries = await fs.readdir(cfg.input, { withFileTypes: true });
  // names already rendered in a previous run, so we never make the same video twice
  let done = new Set();
  try { done = new Set(await fs.readdir(path.join(cfg.input, "published"))); } catch (e) {}
  const out = [];
  for (const e of entries) {
    if (!e.isFile() || !/\.(csv|txt)$/i.test(e.name)) continue;
    if (e.name.startsWith("_") || e.name.startsWith(".")) continue; // helper and hidden files
    if (done.has(e.name)) continue; // already published, skip to avoid a duplicate
    const st = await fs.stat(path.join(cfg.input, e.name));
    const key = e.name + ":" + Math.round(st.mtimeMs);
    if (!processed.has(key)) out.push({ name: e.name, key });
  }
  return out;
}

function jobFromText(name, text) {
  const script = text.replace(/\r/g, "").trim();
  if (!script) return [];
  const title = name.replace(/\.txt$/i, "").replace(/[_-]+/g, " ").trim();
  return [{ title: title || "Video", script, style: cfg.style, voice: "", music: cfg.music }];
}

async function processCSV(file, processed) {
  const text = await fs.readFile(path.join(cfg.input, file.name), "utf8");
  const jobs = /\.txt$/i.test(file.name) ? jobFromText(file.name, text) : jobsFromCSV(text);
  if (!jobs.length) {
    throw new Error(file.name + " is empty or contains no usable video rows");
  }
  log("processing " + file.name + " with " + jobs.length + " video(s)");

  let fileOk = true;
  for (let i = 0; i < jobs.length; i++) {
    // Never start a video we cannot finish inside the run's time budget.
    if (i > 0 && outOfTime()) {
      log("  time budget reached, stopping before the next video in this file");
      fileOk = false;
      break;
    }
    const job = jobs[i];
    // Channel rule: every video uses a female presenter and female narrator.
    // Ignore CSV voice/gender values so a male voice cannot slip into automation.
    job.gender = "female";
    job.voice = cfg.femaleVoice;
    log("  female presenter, narrator " + job.voice);
    const base = slug(job.title) || ("video_" + (i + 1));
    const outFile = path.join(cfg.output, base + ".mp4");
    const workDir = path.join(cfg.output, ".work", base);
    log('video "' + job.title + '"');
    try {
      await renderJob(job, cfg, workDir, outFile);
      log("  saved " + path.relative(process.cwd(), outFile));

      // SEO metadata from Claude: description and tags. Your title (from the file
      // name or CSV) is always kept; Claude's title idea is saved as a suggestion.
      if (cfg.seoEnabled) {
        const seo = await generateSEO(job.script, cfg);
        if (seo) {
          job.seoDescription = seo.description;
          job.seoTags = seo.tags;
          const metaText =
            "TITLE\n" + job.title +
            "\n\nCLAUDE TITLE SUGGESTION\n" + (seo.title || "") +
            "\n\nDESCRIPTION\n" + (seo.description || "") +
            "\n\nTAGS\n" + (seo.tags || []).join(", ") + "\n";
          try { await fs.writeFile(path.join(cfg.output, base + ".txt"), metaText); } catch (e) {}
          log("  SEO ready (title kept as: " + job.title + ")");
        } else {
          log("  SEO skipped (check the Claude key)");
        }
      }

      if (cfg.ytUpload) {
        try {
          const id = await uploadToYouTube(outFile, job, cfg);
          log("  uploaded to YouTube: https://youtu.be/" + id + " (" + cfg.ytPrivacy + ")");
        } catch (e) {
          log("  YouTube upload failed: " + e.message);
          fileOk = false;
        }
      }
    } catch (e) {
      log("  failed: " + e.message);
      fileOk = false;
    } finally {
      try { await fs.rm(workDir, { recursive: true, force: true }); } catch (e) {}
    }
  }

  // Archive only fully successful scripts. If a render or upload failed, keep the
  // script in the content folder so it is retried on the next run, never lost.
  // In generate-only mode (CF_ARCHIVE=0) nothing is archived, so scripts re-render
  // every run and you can tweak and regenerate freely.
  if (!cfg.archive) {
    log("  generate-only mode: " + file.name + " left in place (not archived)");
  } else if (fileOk) {
    try {
      const pub = path.join(cfg.input, "published");
      await fs.mkdir(pub, { recursive: true });
      await fs.rename(path.join(cfg.input, file.name), path.join(pub, file.name));
      log("  archived " + file.name);
    } catch (e) {
      log("  archive move failed: " + e.message);
      fileOk = false;
    }
  } else {
    log("  kept " + file.name + " to retry next run (a step failed)");
  }
  if (fileOk) processed.add(file.key);
  await saveProcessed(processed);
  log("finished " + file.name);
  return fileOk;
}

async function runOnce() {
  await ensureDirs();
  const processed = await loadProcessed();
  const news = await listNewCSVs(processed);
  if (!news.length) {
    const message = "no new .txt or .csv scripts in " + cfg.input;
    if (REQUIRE_INPUT) throw new Error(message + "; put a script directly in content/, not content/published/");
    log(message);
    return;
  }
  const failures = [];
  for (const f of news) {
    if (outOfTime()) {
      log("time budget reached after " + minsElapsed().toFixed(0) + " min, leaving the remaining script(s) for the next run");
      break;
    }
    try {
      const ok = await processCSV(f, processed);
      if (!ok) failures.push(f.name);
    } catch (error) {
      log("failed " + f.name + ": " + error.message);
      failures.push(f.name);
    }
  }
  if (failures.length) {
    throw new Error(
      failures.length + " script(s) failed and were left in content/ for retry: " + failures.join(", ")
    );
  }
}

async function main() {
  const once = process.argv.includes("--once");
  log("Griot Studio worker starting");
  log("input:  " + path.resolve(cfg.input));
  log("output: " + path.resolve(cfg.output));
  log("narration: " + (cfg.ttsEnabled ? "on, provider " + cfg.ttsProvider : "off (set AZURE_SPEECH_KEY, GOOGLE_TTS_KEY, ELEVENLABS_API_KEY, or TTS_API_KEY)"));
  log("seo: " + (cfg.seoEnabled ? "on, Claude writes titles, descriptions, and tags" : "off"));
  log("characters: " + (cfg.anthropicKey && cfg.characters ? "on, Claude keeps main characters consistent" : "off"));
  log("scene matching: " + (cfg.anthropicKey && cfg.sceneVisuals ? "on, Claude matches each image to the narration" : "off"));
  log("thumbnails: " + (cfg.thumbnails ? "on, a bold thumbnail is made for each video" : "off"));
  log("youtube: " + (cfg.ytUpload ? "on, privacy " + cfg.ytPrivacy : "off (set YT_CLIENT_ID, YT_CLIENT_SECRET, YT_REFRESH_TOKEN to enable)"));
  await runOnce();
  if (once) { log("done"); return; }
  log("watching, checking every " + cfg.interval + "s");
  // re-arm only after each run finishes, so a long render never overlaps the next check
  const loop = () => runOnce()
    .catch((e) => log("run error: " + e.message))
    .finally(() => setTimeout(loop, cfg.interval * 1000));
  setTimeout(loop, cfg.interval * 1000);
}

main().catch((e) => { console.error(e); process.exit(1); });

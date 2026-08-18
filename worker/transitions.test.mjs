import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import { transitionFadeSeconds, dipToBlackVideo, dipToBlackAudio } from "./render.mjs";

test("transitionFadeSeconds defaults to 200ms", () => {
  assert.equal(transitionFadeSeconds(5.5, {}), 0.2);
});

test("transitionFadeSeconds is capped at 15% of a short clip's own duration, never eating most of it", () => {
  // A 1s clip: 15% = 0.15s, well under the 0.2s default, so the cap applies.
  assert.equal(transitionFadeSeconds(1, {}), 0.15);
  // A long clip: the 0.2s default applies, uncapped.
  assert.equal(transitionFadeSeconds(30, {}), 0.2);
});

test("transitionFadeSeconds honors cfg.transitionFadeMs, then CF_TRANSITION_FADE_MS, then the 200ms default", () => {
  assert.equal(transitionFadeSeconds(30, { transitionFadeMs: 100 }), 0.1);
  const original = process.env.CF_TRANSITION_FADE_MS;
  process.env.CF_TRANSITION_FADE_MS = "50";
  try {
    assert.equal(transitionFadeSeconds(30, {}), 0.05);
  } finally {
    if (original === undefined) delete process.env.CF_TRANSITION_FADE_MS;
    else process.env.CF_TRANSITION_FADE_MS = original;
  }
});

test("transitionFadeSeconds is disabled by CF_TRANSITION_FADE_MS=0 or a negative/zero cfg override", () => {
  assert.equal(transitionFadeSeconds(30, { transitionFadeMs: 0 }), 0);
  const original = process.env.CF_TRANSITION_FADE_MS;
  process.env.CF_TRANSITION_FADE_MS = "0";
  try {
    assert.equal(transitionFadeSeconds(30, {}), 0);
  } finally {
    if (original === undefined) delete process.env.CF_TRANSITION_FADE_MS;
    else process.env.CF_TRANSITION_FADE_MS = original;
  }
});

test("dipToBlackVideo fades in from black at 0 and out to black ending exactly at the clip's duration", () => {
  const vf = dipToBlackVideo("in", "out", 5.5, {});
  assert.match(vf, /fade=t=in:st=0:d=0\.200:color=black/);
  assert.match(vf, /fade=t=out:st=5\.300:d=0\.200:color=black/); // 5.5 - 0.2
  assert.match(vf, /^\[in\]/);
  assert.match(vf, /\[out\]$/);
});

test("dipToBlackVideo becomes a plain passthrough when fading is disabled", () => {
  const vf = dipToBlackVideo("in", "out", 5.5, { transitionFadeMs: 0 });
  assert.equal(vf, "[in]null[out]");
});

test("dipToBlackAudio mirrors the same fade timing with afade so there is never a click at the cut", () => {
  const af = dipToBlackAudio("in", "out", 5.5, {});
  assert.match(af, /afade=t=in:st=0:d=0\.200/);
  assert.match(af, /afade=t=out:st=5\.300:d=0\.200/);
});

test("dipToBlackAudio becomes a plain passthrough when fading is disabled", () => {
  const af = dipToBlackAudio("in", "out", 5.5, { transitionFadeMs: 0 });
  assert.equal(af, "[in]anull[out]");
});

test("both scene-clip functions wire every clip's own dip-to-black into their filter graph and output map", async () => {
  const source = await fs.readFile(new URL("./render.mjs", import.meta.url), "utf8");
  // sceneClipOverlay (the active production layout).
  assert.match(source, /dipToBlackVideo\("vs", "v", dur, cfg\)/);
  assert.match(source, /dipToBlackAudio\("aout", "a", dur, cfg\)/);
  assert.match(source, /"-map", "\[v\]", "-map", "\[a\]"/);
  // sceneClipComposite (the split-screen fallback layout) gets the same treatment.
  assert.match(source, /dipToBlackVideo\("vs", "v", dur, cfg\);/);
  assert.match(source, /dipToBlackAudio\(audioIdx \+ ":a:0", "a", dur, cfg\)/);
});

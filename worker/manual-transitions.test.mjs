import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import { transitionFadeSeconds, dipToBlackVideo, dipToBlackAudio } from "./manual-assemble.mjs";

test("transitionFadeSeconds defaults to 200ms, capped at 15% of a short slot's own duration", () => {
  assert.equal(transitionFadeSeconds(30), 0.2);
  assert.equal(transitionFadeSeconds(1), 0.15);
});

test("transitionFadeSeconds is disabled by CF_TRANSITION_FADE_MS=0", () => {
  const original = process.env.CF_TRANSITION_FADE_MS;
  process.env.CF_TRANSITION_FADE_MS = "0";
  try {
    assert.equal(transitionFadeSeconds(30), 0);
  } finally {
    if (original === undefined) delete process.env.CF_TRANSITION_FADE_MS;
    else process.env.CF_TRANSITION_FADE_MS = original;
  }
});

test("dipToBlackVideo is an appendable filter fragment (leading comma) fading in at 0 and out ending at the duration", () => {
  const vf = dipToBlackVideo(6);
  assert.match(vf, /^,fade=t=in:st=0:d=0\.200:color=black,fade=t=out:st=5\.800:d=0\.200:color=black$/);
});

test("dipToBlackVideo is empty (no fragment at all) when fading is disabled", () => {
  const original = process.env.CF_TRANSITION_FADE_MS;
  process.env.CF_TRANSITION_FADE_MS = "0";
  try {
    assert.equal(dipToBlackVideo(6), "");
  } finally {
    if (original === undefined) delete process.env.CF_TRANSITION_FADE_MS;
    else process.env.CF_TRANSITION_FADE_MS = original;
  }
});

test("dipToBlackAudio mirrors the same fade timing with afade", () => {
  const af = dipToBlackAudio(6);
  assert.match(af, /^,afade=t=in:st=0:d=0\.200,afade=t=out:st=5\.800:d=0\.200$/);
});

test("buildImageClip, buildFaceOffClip, and video 0 all get their own dip-to-black, and video 0's duration is probed before it is re-encoded", async () => {
  const source = await fs.readFile(new URL("./manual-assemble.mjs", import.meta.url), "utf8");
  assert.match(source, /kenBurnsFilter\([^)]*\) \+ dipToBlackVideo\(durationSec\)/); // buildImageClip
  assert.match(source, /zoomOnly\([^)]*\) \+ dipToBlackVideo\(durationSec\) \+ "\[out\]"/); // buildFaceOffClip
  assert.match(source, /dipToBlackAudio\(durationSec\)/); // video 0's own audio dip
  assert.match(source, /const sourceClip0Duration = await probeDuration\(videoZero\);/);
  assert.match(source, /normalizeVideoClip\(videoZero, clip0, width, height, sourceClip0Duration\)/);
});

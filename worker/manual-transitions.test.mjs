import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import { transitionFadeSeconds, dipToBlackVideo, dipToBlackAudio, reconcileImageTimingToNarration } from "./manual-assemble.mjs";

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

test("buildImageClip, buildSplitClip, and video 0 all get their own dip-to-black, and video 0's duration is probed before it is re-encoded", async () => {
  const source = await fs.readFile(new URL("./manual-assemble.mjs", import.meta.url), "utf8");
  assert.match(source, /kenBurnsFilter\([^)]*\) \+ dipToBlackVideo\(durationSec\)/); // buildImageClip
  assert.match(source, /zoomOnly\([^)]*\) \+ dipToBlackVideo\(durationSec\) \+ "\[out\]"/); // buildSplitClip (tiled frame)
  assert.match(source, /dipToBlackAudio\(durationSec\)/); // video 0's own audio dip
  assert.match(source, /const sourceClip0Duration = await probeDuration\(videoZero\);/);
  assert.match(source, /normalizeVideoClip\(videoZero, clip0, width, height, sourceClip0Duration\)/);
});

test("split layout tiles 2/3/4 images: 2 = hstack, 3 = hstack of 3, 4 = 2x2 (two hstacks + a vstack)", async () => {
  const source = await fs.readFile(new URL("./manual-assemble.mjs", import.meta.url), "utf8");
  assert.match(source, /hstack=inputs=2\[grid\]/);   // 2-up
  assert.match(source, /hstack=inputs=3\[grid\]/);   // 3-up
  assert.match(source, /hstack=inputs=2\[top\];\[c2\]\[c3\]hstack=inputs=2\[bot\];\[top\]\[bot\]vstack=inputs=2\[grid\]/); // 4-up grid
});

test("video 0 is OPTIONAL: no throw when absent, its build is guarded, and the final concat drops it", async () => {
  const source = await fs.readFile(new URL("./manual-assemble.mjs", import.meta.url), "utf8");
  // No hard failure when a folder has no 0.<ext>.
  assert.doesNotMatch(source, /throw new Error\("no video named 0/);
  // Both the normalize step and the final concat are conditional on clip0 existing.
  assert.match(source, /if \(videoZero\) \{/);
  assert.match(source, /if \(clip0\) \{\s*\n\s*await concatClips\(\[clip0, narratedImages\]/);
  assert.match(source, /await concatClips\(\[narratedImages\], outFile, workDir\);/);
});

test("reconcileImageTimingToNarration reproduces and fixes the real production failure: a 39-scene, 40-minute video where narration runs 83s short and the LAST scene is only 32s", () => {
  // Mirrors the actual shot list that failed: scenes 1-38 sum to 2368s, scene 39
  // runs 2368-2400 (32s). Real narration duration measured: 2316.7s (83.3s short).
  const images = [
    { index: 1, start: 0, end: 94 },
    { index: 38, start: 2312, end: 2368 },
    { index: 39, start: 2368, end: 2400 }
  ];
  const narrationDuration = 2316.7;
  // The old design (stretch only the last image) would compute a negative duration
  // here: 2400 + (2316.7 - 2400) = 2316.7 end vs 2368 start = -51.3s. Assert the new
  // design keeps every scene positive instead.
  reconcileImageTimingToNarration(images, narrationDuration, () => {});
  for (const im of images) {
    assert.ok(im.end > im.start, "image " + im.index + " must have a positive duration, got " +
      (im.end - im.start).toFixed(1) + "s");
  }
  // The whole sequence now ends exactly when the narration does.
  assert.ok(Math.abs(images[images.length - 1].end - narrationDuration) < 1e-6);
});

test("reconcileImageTimingToNarration scales every scene by the same factor, preserving relative pacing", () => {
  const images = [
    { index: 1, start: 0, end: 10 },
    { index: 2, start: 10, end: 30 }, // twice as long as scene 1
    { index: 3, start: 30, end: 40 }
  ];
  reconcileImageTimingToNarration(images, 20, () => {}); // half the planned 40s total
  assert.equal(images[0].end - images[0].start, 5); // 10 * 0.5
  assert.equal(images[1].end - images[1].start, 10); // 20 * 0.5
  assert.equal(images[2].end - images[2].start, 5); // 10 * 0.5
  assert.equal(images[images.length - 1].end, 20);
});

test("reconcileImageTimingToNarration leaves timing untouched when narration matches within 1s", () => {
  const images = [{ index: 1, start: 0, end: 10 }, { index: 2, start: 10, end: 20 }];
  reconcileImageTimingToNarration(images, 20.4, () => {});
  assert.deepEqual(images, [{ index: 1, start: 0, end: 10 }, { index: 2, start: 10, end: 20 }]);
});

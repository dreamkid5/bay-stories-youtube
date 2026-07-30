import assert from "node:assert/strict";
import test from "node:test";
import { planVideoScenes } from "./render.mjs";

const env = {
  CF_HD_MAX_MINUTES: "35",
  CF_SHORT_SCENE_SECONDS: "5.5",
  CF_MAX_SCENES: "720"
};
const cfg = { wps: 2.4, sceneSeconds: 5.5 };

function scriptWithWords(count) {
  return Array.from({ length: count }, (_, i) =>
    "word" + i + ((i + 1) % 7 === 0 ? "." : "")
  ).join(" ");
}

function countWords(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

test("a 23-minute story remains 1080p with a fair visual cadence", () => {
  const plan = planVideoScenes(scriptWithWords(3333), cfg, env);
  assert.equal(plan.isShort, true);
  assert.equal(plan.targetSec, 5.5);
  assert.equal(plan.scenes.length, 253);
  assert.ok(plan.avgSec >= 5.4 && plan.avgSec <= 5.5);
});

test("the exact 35-minute boundary switches to the 720p profile", () => {
  const plan = planVideoScenes(scriptWithWords(5040), cfg, env);
  assert.equal(plan.estMinutes, 35);
  assert.equal(plan.isShort, false);
  assert.equal(plan.targetSec, 5.5);
  assert.equal(plan.scenes.length, 382);
});

test("a one-hour script keeps every word at the 5.5-second cadence", () => {
  const script = scriptWithWords(8640);
  const plan = planVideoScenes(script, cfg, env);
  assert.equal(plan.estMinutes, 60);
  assert.equal(plan.isShort, false);
  assert.equal(plan.scenes.length, 655);
  assert.ok(plan.avgSec >= 5.4 && plan.avgSec <= 5.5);
  assert.equal(countWords(plan.scenes.join(" ")), countWords(script));
});

test("the current 35.5-minute vineyard story uses 387 scenes", () => {
  const plan = planVideoScenes(scriptWithWords(5106), cfg, env);
  assert.equal(plan.isShort, false);
  assert.equal(plan.scenes.length, 387);
  assert.ok(plan.avgSec >= 5.49 && plan.avgSec <= 5.5);
});

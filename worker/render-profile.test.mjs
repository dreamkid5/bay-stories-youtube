import assert from "node:assert/strict";
import test from "node:test";
import { planVideoScenes } from "./render.mjs";

const env = {
  CF_HD_MAX_MINUTES: "35",
  CF_SHORT_SCENE_SECONDS: "12",
  CF_MAX_SCENES: "180"
};
const cfg = { wps: 2.4, sceneSeconds: 20 };

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
  assert.equal(plan.targetSec, 12);
  assert.ok(plan.scenes.length >= 110 && plan.scenes.length <= 130);
  assert.ok(plan.avgSec >= 11 && plan.avgSec <= 13);
});

test("the exact 35-minute boundary switches to the 720p profile", () => {
  const plan = planVideoScenes(scriptWithWords(5040), cfg, env);
  assert.equal(plan.estMinutes, 35);
  assert.equal(plan.isShort, false);
  assert.equal(plan.targetSec, 20);
  assert.ok(plan.scenes.length <= 180);
});

test("a one-hour script keeps every word and never exceeds 180 scenes", () => {
  const script = scriptWithWords(8640);
  const plan = planVideoScenes(script, cfg, env);
  assert.equal(plan.estMinutes, 60);
  assert.equal(plan.isShort, false);
  assert.ok(plan.scenes.length <= 180);
  assert.ok(plan.avgSec >= 20);
  assert.equal(countWords(plan.scenes.join(" ")), countWords(script));
});

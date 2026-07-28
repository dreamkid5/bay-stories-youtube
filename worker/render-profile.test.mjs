import assert from "node:assert/strict";
import test from "node:test";
import { planVideoScenes } from "./render.mjs";

const env = {
  CF_HD_MAX_MINUTES: "35",
  CF_SHORT_SCENE_SECONDS: "5",
  CF_MAX_SCENES: "720"
};
const cfg = { wps: 2.4, sceneSeconds: 5 };

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
  assert.equal(plan.targetSec, 5);
  assert.ok(plan.scenes.length >= 275 && plan.scenes.length <= 280);
  assert.ok(plan.avgSec >= 4.9 && plan.avgSec <= 5.1);
});

test("the exact 35-minute boundary switches to the 720p profile", () => {
  const plan = planVideoScenes(scriptWithWords(5040), cfg, env);
  assert.equal(plan.estMinutes, 35);
  assert.equal(plan.isShort, false);
  assert.equal(plan.targetSec, 5);
  assert.equal(plan.scenes.length, 420);
});

test("a one-hour script keeps every word in 720 five-second scenes", () => {
  const script = scriptWithWords(8640);
  const plan = planVideoScenes(script, cfg, env);
  assert.equal(plan.estMinutes, 60);
  assert.equal(plan.isShort, false);
  assert.equal(plan.scenes.length, 720);
  assert.equal(plan.avgSec, 5);
  assert.equal(countWords(plan.scenes.join(" ")), countWords(script));
});

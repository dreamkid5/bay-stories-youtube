import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const WORKER_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(WORKER_DIR, "..");

async function workflow(name) {
  return fs.readFile(path.join(ROOT, ".github", "workflows", name), "utf8");
}

function quotedNumber(source, name) {
  const match = source.match(new RegExp(`^\\s*${name}:\\s*"([0-9.]+)"\\s*$`, "m"));
  assert.ok(match, `${name} must be set explicitly`);
  return Number(match[1]);
}

for (const name of ["publish.yml", "generate.yml"]) {
  test(`${name} uses the agreed 35-minute and one-hour render profile`, async () => {
    const source = await workflow(name);
    assert.equal(quotedNumber(source, "CF_HD_MAX_MINUTES"), 35);
    assert.equal(quotedNumber(source, "CF_SHORT_SCENE_SECONDS"), 5.5);
    assert.equal(quotedNumber(source, "CF_SCENE_SECONDS"), 5.5);
    assert.equal(quotedNumber(source, "CF_MAX_SCENES"), 720);
    assert.equal(quotedNumber(source, "CF_IMAGE_REQUEST_TIMEOUT_MS"), 90000);
    // Long videos (400+ scenes) must finish generating images inside the 350m
    // job timeout: keep several requests in flight and pace starts modestly.
    assert.equal(quotedNumber(source, "CF_IMG_CONCURRENCY"), 6);
    assert.equal(quotedNumber(source, "CF_IMAGE_MIN_INTERVAL_MS"), 600);
    assert.equal(quotedNumber(source, "CF_IMG_REPAIR_CONCURRENCY"), 3);
    assert.equal(quotedNumber(source, "CF_IMG_REPAIR_ROUNDS"), 6);
    assert.equal(quotedNumber(source, "CF_IMAGE_ENHANCE"), 0);
    assert.match(source, /^\s*timeout-minutes:\s*350\s*$/m);
  });

  test(`${name} permanently locks narration to Brian's male voice`, async () => {
    const source = await workflow(name);
    assert.match(source, /^\s*CF_EDGE_VOICE:\s*en-US-BrianNeural\s*$/m);
    assert.doesNotMatch(source, /CF_EDGE_VOICE:\s*en-US-JennyNeural/);
  });

  test(`${name} visibly locks every presenter and thumbnail to male`, async () => {
    const source = await workflow(name);
    assert.match(source, /^\s*CF_PRESENTER_GENDER:\s*male\s*$/m);
    assert.doesNotMatch(source, /CF_PRESENTER_GENDER:\s*female/);
  });

  test(`${name} locks the channel host to the committed portrait`, async () => {
    const source = await workflow(name);
    assert.match(source, /^\s*CF_LOCKED_PRESENTER:\s*\$\{\{\s*github\.workspace\s*\}\}\/worker\/assets\/presenter\/host\.jpg\s*$/m);
  });
}

test("the locked channel host portrait is committed to the repo", async () => {
  const host = path.join(ROOT, "worker", "assets", "presenter", "host.jpg");
  const stat = await fs.stat(host);
  assert.ok(stat.isFile(), "worker/assets/presenter/host.jpg must exist");
  assert.ok(stat.size > 5000, "the host portrait must be a real image, not a placeholder");
});

test("publish jobs check out the latest branch tip after waiting in the queue", async () => {
  const source = await workflow("publish.yml");
  assert.match(source, /^\s*ref:\s*\$\{\{\s*github\.ref_name\s*\}\}\s*$/m);
  assert.match(source, /^\s*cancel-in-progress:\s*false\s*$/m);
  assert.equal(quotedNumber(source, "CF_MAX_FILES_PER_RUN"), 1);
  assert.doesNotMatch(source, /\[skip ci\]/);
});

test("publish runs every six hours so 3+ pending scripts render per day", async () => {
  const source = await workflow("publish.yml");
  // One video per run, four runs a day (00/06/12/18 UTC), rendered one at a time.
  assert.match(source, /^\s*-\s*cron:\s*"\d+\s+0,6,12,18\s+\*\s+\*\s+\*"\s*$/m);
  assert.equal(quotedNumber(source, "CF_MAX_FILES_PER_RUN"), 1);
});

test("thumbnail replacement uses the existing YouTube OAuth route without re-uploading video", async () => {
  const source = await workflow("replace-thumbnail.yml");
  assert.match(source, /video_id:/);
  assert.match(source, /thumbnail_path:/);
  assert.match(source, /YT_REFRESH_TOKEN:\s*\$\{\{\s*secrets\.YT_REFRESH_TOKEN\s*\}\}/);
  assert.match(source, /node worker\/replace-thumbnail\.mjs/);
  assert.doesNotMatch(source, /watch\.mjs|videos\.insert|Render folktales/);
});

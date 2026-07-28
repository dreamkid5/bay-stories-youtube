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
    assert.equal(quotedNumber(source, "CF_SHORT_SCENE_SECONDS"), 5);
    assert.equal(quotedNumber(source, "CF_SCENE_SECONDS"), 5);
    assert.equal(quotedNumber(source, "CF_MAX_SCENES"), 720);
    assert.ok(quotedNumber(source, "CF_IMAGE_REQUEST_TIMEOUT_MS") <= 90000);
    assert.match(source, /^\s*timeout-minutes:\s*350\s*$/m);
  });
}

test("publish jobs check out the latest branch tip after waiting in the queue", async () => {
  const source = await workflow("publish.yml");
  assert.match(source, /^\s*ref:\s*\$\{\{\s*github\.ref_name\s*\}\}\s*$/m);
  assert.match(source, /^\s*cancel-in-progress:\s*false\s*$/m);
  assert.equal(quotedNumber(source, "CF_MAX_FILES_PER_RUN"), 1);
  assert.doesNotMatch(source, /\[skip ci\]/);
});

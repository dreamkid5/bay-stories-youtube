import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  effectiveImageConcurrency,
  fetchImage,
  repairImageSize,
  validImageBuffer
} from "./render.mjs";

function imageBytes(kind = "jpeg") {
  const bytes = Buffer.alloc(1400, 0);
  if (kind === "jpeg") bytes.set([0xff, 0xd8, 0xff], 0);
  if (kind === "png") bytes.set([0x89, 0x50, 0x4e, 0x47], 0);
  if (kind === "webp") {
    bytes.write("RIFF", 0, "ascii");
    bytes.write("WEBP", 8, "ascii");
  }
  return bytes;
}

test("image validation rejects large HTML or JSON error bodies", () => {
  assert.equal(validImageBuffer(imageBytes("jpeg")), true);
  assert.equal(validImageBuffer(imageBytes("png")), true);
  assert.equal(validImageBuffer(imageBytes("webp")), true);
  assert.equal(validImageBuffer(Buffer.alloc(1400, 0x7b)), false);
  assert.equal(validImageBuffer(Buffer.alloc(500, 0xff)), false);
});

test("unauthenticated image traffic is capped while keyed traffic uses configured concurrency", () => {
  assert.equal(effectiveImageConcurrency(5, false), 2);
  assert.equal(effectiveImageConcurrency(3, true), 3);
  assert.equal(effectiveImageConcurrency(0, false), 2);
});

test("repair images use progressively smaller 16:9 source sizes", () => {
  const cfg = { width: 1280, height: 720 };
  assert.deepEqual(repairImageSize(1, cfg), { width: 1024, height: 576 });
  assert.deepEqual(repairImageSize(2, cfg), { width: 1024, height: 576 });
  assert.deepEqual(repairImageSize(3, cfg), { width: 768, height: 432 });
});

test("the unified image API uses Bearer auth and only writes real images", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bay-image-test-"));
  const outPath = path.join(tempDir, "scene.jpg");
  const originalFetch = globalThis.fetch;
  const originalInterval = process.env.CF_IMAGE_MIN_INTERVAL_MS;
  let request = null;
  globalThis.fetch = async (url, options) => {
    request = { url: String(url), options };
    const bytes = imageBytes("jpeg");
    return {
      ok: true,
      status: 200,
      headers: { get: () => "image/jpeg" },
      async arrayBuffer() {
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      }
    };
  };
  process.env.CF_IMAGE_MIN_INTERVAL_MS = "0";

  try {
    const ok = await fetchImage("a vineyard", 42, outPath, {
      imageBase: "https://gen.pollinations.ai/image",
      imageModel: "zimage",
      imageToken: "test-secret",
      width: 1280,
      height: 720
    }, { attempts: 1 });
    assert.equal(ok, true);
    assert.match(request.url, /^https:\/\/gen\.pollinations\.ai\/image\//);
    assert.match(request.url, /model=zimage/);
    assert.doesNotMatch(request.url, /token=/);
    assert.equal(request.options.headers.Authorization, "Bearer test-secret");
    assert.equal(validImageBuffer(await fs.readFile(outPath)), true);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalInterval === undefined) delete process.env.CF_IMAGE_MIN_INTERVAL_MS;
    else process.env.CF_IMAGE_MIN_INTERVAL_MS = originalInterval;
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("non-retryable authentication failures stop immediately", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bay-image-test-"));
  const outPath = path.join(tempDir, "scene.jpg");
  const originalFetch = globalThis.fetch;
  const originalInterval = process.env.CF_IMAGE_MIN_INTERVAL_MS;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return {
      ok: false,
      status: 401,
      headers: { get: () => null }
    };
  };
  process.env.CF_IMAGE_MIN_INTERVAL_MS = "0";

  try {
    const ok = await fetchImage("a vineyard", 42, outPath, {
      imageBase: "https://gen.pollinations.ai/image",
      imageModel: "zimage",
      imageToken: "bad-secret"
    }, { attempts: 5 });
    assert.equal(ok, false);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalInterval === undefined) delete process.env.CF_IMAGE_MIN_INTERVAL_MS;
    else process.env.CF_IMAGE_MIN_INTERVAL_MS = originalInterval;
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("production refuses to skip scenes whose images are still missing", async () => {
  const source = await fs.readFile(new URL("./render.mjs", import.meta.url), "utf8");
  assert.match(source, /refusing to skip narrated scenes/);
  assert.doesNotMatch(source, /scene\\(s\\) could not get an image and will be skipped/);
  assert.match(source, /" checked, " \+ repaired \+ " recovered"/);
});

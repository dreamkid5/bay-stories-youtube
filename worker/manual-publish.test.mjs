import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  titleFromFolderName,
  listPendingFolders,
  loadLedger,
  saveLedger,
  publishPendingManualVideos
} from "./manual-publish.mjs";

test("titleFromFolderName turns a folder name into a readable title", () => {
  assert.equal(titleFromFolderName("my-fiance-story"), "My Fiance Story");
  assert.equal(titleFromFolderName("my_wife_left_me"), "My Wife Left Me");
  assert.equal(titleFromFolderName("already Title Cased"), "Already Title Cased");
});

test("listPendingFolders lists only pending subfolders, excluding published/ and dotfiles", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "griot-manual-publish-"));
  try {
    await fs.mkdir(path.join(dir, "story-a"));
    await fs.mkdir(path.join(dir, "story-b"));
    await fs.mkdir(path.join(dir, "published"));
    await fs.mkdir(path.join(dir, ".hidden"));
    await fs.writeFile(path.join(dir, "readme.txt"), "not a folder");
    const pending = await listPendingFolders(dir);
    assert.deepEqual(pending, ["story-a", "story-b"]);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("listPendingFolders returns an empty list when manual/ does not exist yet", async () => {
  const pending = await listPendingFolders("/no/such/manual/dir");
  assert.deepEqual(pending, []);
});

test("loadLedger/saveLedger round-trip, and a missing ledger loads as empty", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "griot-manual-publish-"));
  try {
    const ledgerPath = path.join(dir, ".cf-uploaded.json");
    assert.deepEqual(await loadLedger(ledgerPath), {});
    await saveLedger(ledgerPath, { "my-story": "abc123XYZ90" });
    assert.deepEqual(await loadLedger(ledgerPath), { "my-story": "abc123XYZ90" });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("publishPendingManualVideos is a safe no-op when YouTube credentials are missing", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "griot-manual-publish-"));
  try {
    await fs.mkdir(path.join(dir, "some-story"));
    const originalId = process.env.YT_CLIENT_ID;
    const originalSecret = process.env.YT_CLIENT_SECRET;
    const originalToken = process.env.YT_REFRESH_TOKEN;
    delete process.env.YT_CLIENT_ID;
    delete process.env.YT_CLIENT_SECRET;
    delete process.env.YT_REFRESH_TOKEN;
    try {
      const result = await publishPendingManualVideos({ manualDir: dir, log: () => {} });
      assert.deepEqual(result, { processed: [], failed: [] });
      // Nothing should have been touched: the folder is still there, untouched.
      const remaining = await listPendingFolders(dir);
      assert.deepEqual(remaining, ["some-story"]);
    } finally {
      if (originalId !== undefined) process.env.YT_CLIENT_ID = originalId;
      if (originalSecret !== undefined) process.env.YT_CLIENT_SECRET = originalSecret;
      if (originalToken !== undefined) process.env.YT_REFRESH_TOKEN = originalToken;
    }
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("after a successful upload, output.mp4 is kept on disk (not deleted with the rest of the folder) so the workflow's separate artifact-archive step can still find it", async () => {
  const source = await fs.readFile(new URL("./manual-publish.mjs", import.meta.url), "utf8");
  // The old bug: fs.rm(folder, {...}) deleted output.mp4 along with everything else,
  // inside THIS script -- before the separate "Save ... artifact" workflow step
  // (which runs after this script exits) ever got a chance to archive the file.
  assert.doesNotMatch(source, /fs\.rm\(folder, \{ recursive: true, force: true \}\)/);
  // The fix: delete every entry except output.mp4.
  assert.match(source, /if \(entry === "output\.mp4"\) continue;/);
  assert.match(source, /await fs\.rm\(path\.join\(folder, entry\), \{ recursive: true, force: true \}\)/);
});

test("publishPendingManualVideos reports nothing to do when manual/ has no pending folders", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "griot-manual-publish-"));
  try {
    process.env.YT_CLIENT_ID = "test";
    process.env.YT_CLIENT_SECRET = "test";
    process.env.YT_REFRESH_TOKEN = "test";
    const result = await publishPendingManualVideos({ manualDir: dir, log: () => {} });
    assert.deepEqual(result, { processed: [], failed: [] });
  } finally {
    delete process.env.YT_CLIENT_ID;
    delete process.env.YT_CLIENT_SECRET;
    delete process.env.YT_REFRESH_TOKEN;
    await fs.rm(dir, { recursive: true, force: true });
  }
});

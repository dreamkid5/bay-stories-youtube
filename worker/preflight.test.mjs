import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { runPreflight } from "./preflight.mjs";

const execFileAsync = promisify(execFile);

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "griot-preflight-test-"));
  const contentDir = path.join(root, "content");
  await fs.mkdir(path.join(contentDir, "published"), { recursive: true });
  await fs.writeFile(path.join(contentDir, ".cf-uploaded.json"), "{}\n");
  return { root, contentDir };
}

test("a newly added script in published is automatically recovered", async () => {
  const { root, contentDir } = await fixture();
  const name = "New Story.txt";
  const source = path.join(contentDir, "published", name);
  const eventPath = path.join(root, "event.json");
  await fs.writeFile(source, "A complete story.");
  await fs.writeFile(eventPath, JSON.stringify({
    commits: [{ added: [`content/published/${name}`] }]
  }));

  try {
    const messages = [];
    const result = await runPreflight({
      contentDir,
      eventName: "push",
      eventPath,
      requireInput: true,
      requireAnthropic: true,
      anthropicKey: "test-key",
      log: (message) => messages.push(message)
    });
    assert.equal(result.hasInput, true);
    assert.deepEqual(result.recovered, [name]);
    assert.equal(await fs.readFile(path.join(contentDir, name), "utf8"), "A complete story.");
    await assert.rejects(fs.access(source));
    assert.match(messages.join("\n"), /Recovered New Story\.txt/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("a required run fails clearly when no active script exists", async () => {
  const { root, contentDir } = await fixture();
  try {
    await assert.rejects(
      runPreflight({ contentDir, requireInput: true, anthropicKey: "test-key" }),
      /Put a \.txt file directly in content/
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("presenter verification fails before rendering when its key is missing", async () => {
  const { root, contentDir } = await fixture();
  await fs.writeFile(path.join(contentDir, "Waiting Story.txt"), "A complete story.");
  try {
    await assert.rejects(
      runPreflight({
        contentDir,
        requireInput: true,
        requireAnthropic: true,
        anthropicKey: ""
      }),
      /ANTHROPIC_API_KEY is missing/
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("historical published scripts are never recovered by a scheduled check", async () => {
  const { root, contentDir } = await fixture();
  const source = path.join(contentDir, "published", "Old Story.txt");
  await fs.writeFile(source, "Already archived.");
  try {
    const result = await runPreflight({
      contentDir,
      eventName: "schedule",
      requireInput: false,
      requireAnthropic: true,
      anthropicKey: ""
    });
    assert.equal(result.hasInput, false);
    assert.equal(await fs.readFile(source, "utf8"), "Already archived.");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("the worker exits nonzero instead of reporting success when required input is absent", async () => {
  const { root, contentDir } = await fixture();
  const outputDir = path.join(root, "output");
  try {
    await assert.rejects(
      execFileAsync(process.execPath, [fileURLToPath(new URL("./watch.mjs", import.meta.url)), "--once"], {
        env: {
          ...process.env,
          CF_INPUT: contentDir,
          CF_OUTPUT: outputDir,
          CF_REQUIRE_INPUT: "1"
        }
      }),
      (error) => {
        assert.notEqual(error.code, 0);
        assert.match(error.stderr, /no new \.txt or \.csv scripts/);
        return true;
      }
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

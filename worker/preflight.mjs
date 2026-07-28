import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { slug } from "./csv.mjs";

const SCRIPT_PATTERN = /\.(csv|txt)$/i;

function isEligibleScriptName(name) {
  return SCRIPT_PATTERN.test(name) && !name.startsWith("_") && !name.startsWith(".");
}

async function readJSON(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    return fallback;
  }
}

async function addedPathsFromEvent(eventPath) {
  if (!eventPath) return [];
  const event = await readJSON(eventPath, {});
  const commits = Array.isArray(event.commits) ? event.commits : [];
  const added = commits.flatMap((commit) => Array.isArray(commit.added) ? commit.added : []);
  if (event.head_commit && Array.isArray(event.head_commit.added)) {
    added.push(...event.head_commit.added);
  }
  return [...new Set(added.map((item) => String(item).replaceAll("\\", "/")))];
}

async function activeScripts(contentDir) {
  const entries = await fs.readdir(contentDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && isEligibleScriptName(entry.name))
    .map((entry) => entry.name)
    .sort();
}

async function recoverNewlyMisplacedScripts({ contentDir, eventName, eventPath, log }) {
  if (eventName !== "push") return [];

  const added = await addedPathsFromEvent(eventPath);
  const publishedPrefix = "content/published/";
  const candidates = added.filter((item) => {
    if (!item.startsWith(publishedPrefix)) return false;
    const relative = item.slice(publishedPrefix.length);
    return relative && !relative.includes("/") && isEligibleScriptName(relative);
  });
  if (!candidates.length) return [];

  const ledger = await readJSON(path.join(contentDir, ".cf-uploaded.json"), {});
  const recovered = [];
  for (const repositoryPath of candidates) {
    const name = repositoryPath.slice(publishedPrefix.length);
    const source = path.join(contentDir, "published", name);
    const destination = path.join(contentDir, name);

    try {
      await fs.access(source);
    } catch (error) {
      continue;
    }
    try {
      await fs.access(destination);
      throw new Error(
        `Cannot recover ${repositoryPath}: content/${name} already exists. Remove one copy and push again.`
      );
    } catch (error) {
      if (error && error.code !== "ENOENT") throw error;
    }

    if (/\.txt$/i.test(name)) {
      const title = name.replace(/\.txt$/i, "").replace(/[_-]+/g, " ").trim();
      const key = slug(title);
      if (key && ledger[key]) {
        throw new Error(
          `${repositoryPath} is already recorded as uploaded (${ledger[key]}). ` +
          "Delete that YouTube video or remove its ledger entry intentionally before regenerating."
        );
      }
    }

    await fs.rename(source, destination);
    recovered.push(name);
    log(
      `::warning file=${repositoryPath}::Recovered ${name} from content/published/. ` +
      "New scripts belong directly in content/."
    );
  }
  return recovered;
}

export async function runPreflight({
  contentDir,
  eventName = "",
  eventPath = "",
  requireInput = false,
  requireAnthropic = false,
  anthropicKey = "",
  log = console.log
}) {
  await fs.mkdir(contentDir, { recursive: true });
  const recovered = await recoverNewlyMisplacedScripts({ contentDir, eventName, eventPath, log });
  const scripts = await activeScripts(contentDir);

  if (!scripts.length && requireInput) {
    throw new Error(
      "No new script was found. Put a .txt file directly in content/ (not content/published/) and commit it."
    );
  }
  if (scripts.length && requireAnthropic && !String(anthropicKey).trim()) {
    throw new Error(
      "ANTHROPIC_API_KEY is missing. It is required only to visually verify that the generated presenter is a white adult woman. " +
      "The workflow stops here so it cannot create a video with the wrong presenter."
    );
  }

  if (scripts.length) log(`Preflight found ${scripts.length} new script(s): ${scripts.join(", ")}`);
  else log("No new scripts are waiting; the scheduled check can finish normally.");
  return { hasInput: scripts.length > 0, scripts, recovered };
}

async function writeOutputs(result) {
  if (!process.env.GITHUB_OUTPUT) return;
  await fs.appendFile(
    process.env.GITHUB_OUTPUT,
    `has_input=${result.hasInput ? "true" : "false"}\nrecovered_count=${result.recovered.length}\n`
  );
}

async function main() {
  const contentDir = path.resolve(process.env.CF_INPUT || path.join(process.cwd(), "..", "content"));
  const result = await runPreflight({
    contentDir,
    eventName: process.env.GITHUB_EVENT_NAME || "",
    eventPath: process.env.GITHUB_EVENT_PATH || "",
    requireInput: process.env.CF_REQUIRE_INPUT === "1",
    requireAnthropic: process.env.CF_REQUIRE_ANTHROPIC === "1",
    anthropicKey: process.env.ANTHROPIC_API_KEY || ""
  });
  await writeOutputs(result);
}

const isEntrypoint = process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntrypoint) {
  main().catch((error) => {
    console.error(`::error title=Griot Studio preflight failed::${error.message}`);
    process.exit(1);
  });
}

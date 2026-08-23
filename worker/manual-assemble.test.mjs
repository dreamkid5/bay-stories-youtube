import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parseTimeToSeconds, parseTimestampsFile, kenBurnsFilter, findImageAsset, sceneMarkerIndex, parseScriptScenes } from "./manual-assemble.mjs";

test("sceneMarkerIndex recognises SCENE/[n]/#n/n./bare-n markers and ignores prose", () => {
  assert.equal(sceneMarkerIndex("SCENE 7"), 7);
  assert.equal(sceneMarkerIndex("Scene 07 — THE BOARDROOM"), 7); // trailing title ignored
  assert.equal(sceneMarkerIndex("[3]"), 3);
  assert.equal(sceneMarkerIndex("#5"), 5);
  assert.equal(sceneMarkerIndex("2."), 2);
  assert.equal(sceneMarkerIndex("9"), 9);
  assert.equal(sceneMarkerIndex("The scene was quiet."), null);
  assert.equal(sceneMarkerIndex("He walked into the room."), null);
});

test("parseScriptScenes splits a script into per-scene narration by SCENE markers, dropping the marker/title lines", () => {
  const doc = [
    "SCENE 1", "The boardroom was silent.", "Everyone waited.", "",
    "SCENE 2 — THREE WEEKS EARLIER", "It began with a letter.", "",
    "SCENE 3", "She said no.",
  ].join("\n");
  assert.deepEqual(parseScriptScenes(doc), [
    { index: 1, text: "The boardroom was silent.\nEveryone waited." },
    { index: 2, text: "It began with a letter." },
    { index: 3, text: "She said no." },
  ]);
});

test("parseScriptScenes folds any text before the first marker into scene 1, and returns null when there are no markers", () => {
  assert.equal(parseScriptScenes("Intro line.\nSCENE 1\nHello.")[0].text, "Intro line.\nHello.");
  assert.equal(parseScriptScenes("Just a plain script.\nNo markers here at all."), null);
});

test("parseScriptScenes throws if a marked scene has no narration text beneath it", () => {
  assert.throws(() => parseScriptScenes("SCENE 1\nSCENE 2\nonly two has text"), /SCENE 1 has no narration/);
});

test("parseTimeToSeconds understands M:SS, MM:SS and H:MM:SS", () => {
  assert.equal(parseTimeToSeconds("8"), 8);
  assert.equal(parseTimeToSeconds("0:08"), 8);
  assert.equal(parseTimeToSeconds("1:30"), 90);
  assert.equal(parseTimeToSeconds("12:05"), 725);
  assert.equal(parseTimeToSeconds("1:02:03"), 3723);
});

test("parseTimeToSeconds rejects garbage instead of silently returning 0", () => {
  assert.throws(() => parseTimeToSeconds("abc"), /bad timestamp/);
  assert.throws(() => parseTimeToSeconds(""), /bad timestamp/);
});

test("parseTimestampsFile parses one 'index: start-end' line per image, sorted by index", () => {
  const entries = parseTimestampsFile([
    "2: 0:06-0:12",
    "1: 0:00-0:06",
    "# a comment line, ignored",
    "",
    "3: 0:12-0:18"
  ].join("\n"));
  assert.deepEqual(entries.map((e) => e.index), [1, 2, 3]);
  assert.equal(entries[0].start, 0);
  assert.equal(entries[0].end, 6);
  assert.equal(entries[2].end, 18);
});

test("parseTimestampsFile rejects an end time at or before its start time", () => {
  assert.throws(() => parseTimestampsFile("1: 0:10-0:05"), /end <= start|end time at or before/);
});

test("parseTimestampsFile rejects overlapping image windows", () => {
  assert.throws(
    () => parseTimestampsFile("1: 0:00-0:10\n2: 0:05-0:20"),
    /starts before image 1 ends/
  );
});

test("parseTimestampsFile rejects an unparseable line with a clear error, not a silent skip", () => {
  assert.throws(() => parseTimestampsFile("1: not-a-range"), /could not parse line/);
});

test("parseTimestampsFile requires at least one entry", () => {
  assert.throws(() => parseTimestampsFile("# only a comment\n"), /no entries/);
});

test("kenBurns alternates zoom-in and zoom-out by image index, so consecutive images never repeat direction", () => {
  const a = kenBurnsFilter(6, 0, 1280, 720, 0.08);
  const b = kenBurnsFilter(6, 1, 1280, 720, 0.08);
  assert.match(a, /1\+0\.08\*t\/6/); // even index: zoom IN, starts at 1x and grows
  assert.match(b, /1\.0800-0\.08\*t\/6/); // odd index: zoom OUT, starts at 1.08x and shrinks
});

test("kenBurns scales the zoom to the image's OWN duration, so a long-held image zooms slowly", () => {
  const short = kenBurnsFilter(3, 0, 1280, 720, 0.08);
  const long = kenBurnsFilter(60, 0, 1280, 720, 0.08);
  assert.match(short, /t\/3\)/);
  assert.match(long, /t\/60\)/);
});

test("parseTimestampsFile ignores a trailing note after the time range, never treating it as narration", () => {
  const entries = parseTimestampsFile("26: 1:10-1:20 she opens the door and finds him there");
  assert.deepEqual(entries, [{ index: 26, start: 70, end: 80 }]);
});

test("parseTimestampsFile connects a SCENE header to the time range on the NEXT line (numbers and ranges split across lines)", () => {
  // The other common shot-list shape: "SCENE 07 — TITLE" on one line, "07:10 – 08:25"
  // below it, with narration prose (including a stray "2:00 a.m.") in between.
  const doc = [
    "SCENE 01 — THE BOARDROOM REVEAL",
    "00:00 – 01:15",
    "Narration: the meeting opens.",
    "",
    "SCENE 02 — THREE WEEKS EARLIER",
    "It was 2:00 a.m. when the letter arrived.",
    "01:15 – 02:25",
    "SCENE 03 — ELIAS AND HIS DAUGHTER",
    "02:25 – 03:30",
  ].join("\n");
  assert.deepEqual(parseTimestampsFile(doc), [
    { index: 1, start: 0, end: 75 },
    { index: 2, start: 75, end: 145 },
    { index: 3, start: 145, end: 210 },
  ]);
});

test("parseTimestampsFile does not mistake a time-of-day line like '2:00 a.m.' for a botched entry", () => {
  // Prior behavior threw "could not parse line" on this; it must simply be ignored.
  assert.deepEqual(parseTimestampsFile("1: 0:00-0:10\n2:00 a.m. the phone rang\n2: 0:10-0:20"), [
    { index: 1, start: 0, end: 10 },
    { index: 2, start: 10, end: 20 },
  ]);
});

test("parseTimestampsFile reads a full shot-list doc: keeps the SCENE cues, drops every prose/notes/header line", () => {
  // The exact shape of a real uploaded planning file: en-dash time ranges, image number
  // in a "SCENE NN" token, and paragraphs of narration notes and camera directions between.
  const doc = [
    "ACT 1 — THE NIGHT THAT STARTED EVERYTHING",
    "00:00–01:00 — SCENE 01",
    "THE NIGHT STOP",
    "",
    "Narration section:",
    '"The night I met Sergeant Cole Radley..."',
    "Image: Scene 1 — Route 9 traffic stop.",
    "Camera treatment: Very slow push-in toward Desmond.",
    "",
    "01:00–02:00 — SCENE 02",
    "Mood: Threatening, controlled, uncomfortable.",
    "02:00–03:00 — SCENE 03",
  ].join("\n");
  const entries = parseTimestampsFile(doc);
  assert.deepEqual(entries, [
    { index: 1, start: 0, end: 60 },
    { index: 2, start: 60, end: 120 },
    { index: 3, start: 120, end: 180 },
  ]);
});

test("parseTimestampsFile drops a section sub-beat (a time range with no image number) once numbered cues exist", () => {
  // "39:00–39:20 — THE FAMILY" is a titled sub-beat, not a numbered image: it must not
  // become a phantom image 41.
  const entries = parseTimestampsFile([
    "39:00–40:00 — SCENE 40",
    "39:00–39:20 — THE FAMILY",
    "39:20–39:40 — REBUILDING",
  ].join("\n"));
  assert.deepEqual(entries, [{ index: 40, start: 2340, end: 2400 }]);
});

test("parseTimestampsFile numbers unnumbered cues 1..N in order only when NOTHING is numbered", () => {
  assert.deepEqual(parseTimestampsFile("0:00-0:06\n0:06-0:12"), [
    { index: 1, start: 0, end: 6 },
    { index: 2, start: 6, end: 12 },
  ]);
});

test("parseTimestampsFile merges a repeated image number (e.g. a face-off written twice) into one span", () => {
  assert.deepEqual(parseTimestampsFile("SCENE 26 0:00-0:10\nSCENE 26 0:10-0:20"), [
    { index: 26, start: 0, end: 20 },
  ]);
});

test("parseTimestampsFile still shouts about a botched clean entry rather than silently dropping an image", () => {
  // A line that clearly meant to be "1: <range>" but is malformed is a mistake, not prose.
  assert.throws(() => parseTimestampsFile("1: 0:00-0:10\n2: not-a-range"), /could not parse line/);
});

test("findImageAsset finds a plain solo image by index", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "griot-manual-asset-"));
  try {
    await fs.writeFile(path.join(dir, "5.jpg"), "x");
    const asset = await findImageAsset(dir, 5, [".jpg", ".png"]);
    assert.equal(asset.type, "single");
    assert.equal(asset.path, path.join(dir, "5.jpg"));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("findImageAsset combines '26a' + '26b' into a face-off pair", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "griot-manual-asset-"));
  try {
    await fs.writeFile(path.join(dir, "26a.jpg"), "x");
    await fs.writeFile(path.join(dir, "26b.png"), "x");
    const asset = await findImageAsset(dir, 26, [".jpg", ".png"]);
    assert.equal(asset.type, "pair");
    assert.equal(asset.pathA, path.join(dir, "26a.jpg"));
    assert.equal(asset.pathB, path.join(dir, "26b.png"));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("findImageAsset also accepts '26 (a)' / '26 (b)' spacing and parens", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "griot-manual-asset-"));
  try {
    await fs.writeFile(path.join(dir, "26 (a).jpg"), "x");
    await fs.writeFile(path.join(dir, "26 (b).jpg"), "x");
    const asset = await findImageAsset(dir, 26, [".jpg", ".png"]);
    assert.equal(asset.type, "pair");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("findImageAsset tiles 3 lettered images (a,b,c) into one split group, in order", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "griot-manual-asset-"));
  try {
    for (const n of ["7a.jpg", "7b.jpg", "7c.jpg"]) await fs.writeFile(path.join(dir, n), "x");
    const asset = await findImageAsset(dir, 7, [".jpg"]);
    assert.equal(asset.type, "group");
    assert.deepEqual(asset.paths.map((p) => path.basename(p)), ["7a.jpg", "7b.jpg", "7c.jpg"]);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("findImageAsset tiles 4 lettered images '30 (a..d)' into one split group, in a,b,c,d order", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "griot-manual-asset-"));
  try {
    for (const l of ["a", "b", "c", "d"]) await fs.writeFile(path.join(dir, "30 (" + l + ").jpeg"), "x");
    const asset = await findImageAsset(dir, 30, [".jpeg"]);
    assert.equal(asset.type, "group");
    assert.deepEqual(asset.paths.map((p) => path.basename(p)),
      ["30 (a).jpeg", "30 (b).jpeg", "30 (c).jpeg", "30 (d).jpeg"]);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("findImageAsset rejects a gap in the split letters (a + c, no b) instead of dropping an image", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "griot-manual-asset-"));
  try {
    await fs.writeFile(path.join(dir, "9a.jpg"), "x");
    await fs.writeFile(path.join(dir, "9c.jpg"), "x");
    await assert.rejects(findImageAsset(dir, 9, [".jpg"]), /9b is missing|consecutively/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("findImageAsset throws a clear error when only one half of a pair exists", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "griot-manual-asset-"));
  try {
    await fs.writeFile(path.join(dir, "26a.jpg"), "x");
    await assert.rejects(findImageAsset(dir, 26, [".jpg"]), /only one half/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("findImageAsset throws when a solo file AND a paired file both claim the same index", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "griot-manual-asset-"));
  try {
    await fs.writeFile(path.join(dir, "26.jpg"), "x");
    await fs.writeFile(path.join(dir, "26a.jpg"), "x");
    await fs.writeFile(path.join(dir, "26b.jpg"), "x");
    await assert.rejects(findImageAsset(dir, 26, [".jpg"]), /both a solo file/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("findImageAsset returns null when nothing matches the index", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "griot-manual-asset-"));
  try {
    const asset = await findImageAsset(dir, 99, [".jpg"]);
    assert.equal(asset, null);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import { parseTimeToSeconds, parseTimestampsFile, kenBurnsFilter } from "./manual-assemble.mjs";

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

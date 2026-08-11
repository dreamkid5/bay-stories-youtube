import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  generateUniquePresenter,
  newFemalePresenterIdentity,
  newMalePresenterIdentity,
  presenterAgeProfile,
  presenterAssessmentApproved,
  validateFemalePresenterImage,
  LOCKED_PRESENTER_GENDER
} from "./presenter.mjs";
import {
  approvedNarratorVoice,
  femaleVoice,
  LOCKED_MALE_NARRATOR_VOICE,
  LOCKED_NARRATOR_VOICE
} from "./render.mjs";

test("every presenter prompt requires a white adult woman and excludes men", () => {
  for (let i = 0; i < 12; i++) {
    const profile = newFemalePresenterIdentity({
      title: "Regression check " + i,
      script: "A story whose characters must never determine the presenter."
    });
    assert.match(profile.prompt, /adult white European woman presenter/i);
    assert.match(profile.prompt, /white female presenter only/i);
    assert.match(profile.prompt, /no man, no male person/i);
  }
});

test("the approved male presenter prompt excludes women", () => {
  const profile = newMalePresenterIdentity({
    title: "I Raised My Daughter",
    script: "A father tells his own story."
  });
  assert.match(profile.prompt, /adult white American man presenter/i);
  assert.match(profile.prompt, /white male presenter only/i);
  assert.match(profile.prompt, /no woman, no female person/i);
});

test("male presenter age matches the narrator's explicit numeric age", () => {
  const job = {
    title: "A family betrayal",
    script: "My sister is 24 years old. I am 52 years old, and I never expected this from her."
  };
  const age = presenterAgeProfile(job);
  const profile = newMalePresenterIdentity(job);
  assert.equal(age.years, 52);
  assert.equal(age.matched, true);
  assert.match(profile.prompt, /exactly 52 years old/i);
  assert.doesNotMatch(profile.prompt, /24 years old/i);
});

test("male presenter age understands written ages and ignores past narrator ages", () => {
  const age = presenterAgeProfile({
    script: "When I was nineteen, I left home. I am now forty-seven years old and finally ready to tell the truth."
  });
  assert.equal(age.years, 47);
  assert.equal(age.matched, true);
});

test("male presenter age understands first-person name introductions", () => {
  const age = presenterAgeProfile({
    script: "I'm Daniel, sixty-three years old, and this is the story of the house I inherited."
  });
  assert.equal(age.years, 63);
  assert.equal(age.matched, true);
});

test("male presenter age understands narrator decade descriptions", () => {
  const age = presenterAgeProfile({ script: "I'm in my late sixties, and this happened to me last winter." });
  const profile = newMalePresenterIdentity({ script: "I'm in my late sixties, and this happened to me last winter." });
  assert.equal(age.min, 67);
  assert.equal(age.max, 69);
  assert.match(profile.prompt, /in his late sixties/i);
});

test("unstated narrator ages use an explicit adult fallback", () => {
  const age = presenterAgeProfile({ script: "My sister betrayed me at dinner." });
  assert.equal(age.matched, false);
  assert.match(age.label, /default/i);
});

test("an underage narrator fails closed instead of receiving the wrong adult image", () => {
  assert.throws(
    () => newMalePresenterIdentity({ script: "I am seventeen years old, and this is my story." }),
    /conflicts with the channel's verified adult male presenter requirement/i
  );
});

test("visual validation rejects a presenter outside the script age", () => {
  const age = presenterAgeProfile({ script: "I am 61 years old and recently retired." });
  const base = {
    person_count: 1,
    adult_man: true,
    white_presenting: true,
    woman_present: false,
    photorealistic: true,
    face_visible: true,
    presenter_framing: true,
    age_match: true
  };
  assert.equal(presenterAssessmentApproved({ ...base, estimated_age: 62 }, "male", age), true);
  assert.equal(presenterAssessmentApproved({ ...base, estimated_age: 32 }, "male", age), false);
  assert.equal(presenterAssessmentApproved({ ...base, estimated_age: 62, age_match: false }, "male", age), false);
});

test("every narration request resolves to the locked Brian male voice", () => {
  assert.equal(LOCKED_NARRATOR_VOICE, "en-US-BrianNeural");
  assert.equal(LOCKED_MALE_NARRATOR_VOICE, "en-US-BrianNeural");
  for (const requested of [
    "male",
    "en-US-GuyNeural",
    "en-US-JennyNeural",
    "",
    undefined
  ]) {
    assert.equal(femaleVoice("edge", requested, {}), LOCKED_NARRATOR_VOICE);
    assert.equal(approvedNarratorVoice(requested), LOCKED_NARRATOR_VOICE);
  }
});

test("visual validation accepts only one verified white adult woman", () => {
  const approved = {
    person_count: 1,
    adult_woman: true,
    white_presenting: true,
    man_present: false,
    photorealistic: true,
    face_visible: true,
    presenter_framing: true
  };
  assert.equal(presenterAssessmentApproved(approved, "female"), true);

  for (const invalid of [
    { ...approved, person_count: 2 },
    { ...approved, adult_woman: false },
    { ...approved, white_presenting: false },
    { ...approved, man_present: true },
    { ...approved, photorealistic: false },
    { ...approved, face_visible: false },
    { ...approved, presenter_framing: false }
  ]) {
    assert.equal(presenterAssessmentApproved(invalid, "female"), false);
  }
});

test("visual validation accepts only one verified white adult man for production", () => {
  const approved = {
    person_count: 1,
    adult_man: true,
    white_presenting: true,
    woman_present: false,
    photorealistic: true,
    face_visible: true,
    presenter_framing: true
  };
  assert.equal(presenterAssessmentApproved(approved, "male"), true);
  for (const invalid of [
    { ...approved, person_count: 2 },
    { ...approved, adult_man: false },
    { ...approved, woman_present: true },
    { ...approved, white_presenting: false }
  ]) {
    assert.equal(presenterAssessmentApproved(invalid, "male"), false);
  }
});

test("the image itself must pass two independent API inspections", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "griot-presenter-test-"));
  const imagePath = path.join(tempDir, "presenter.jpg");
  await fs.writeFile(imagePath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return {
      status: 200,
      ok: true,
      async json() {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              person_count: 1,
              adult_woman: true,
              white_presenting: true,
              man_present: false,
              photorealistic: true,
              face_visible: true,
              presenter_framing: true,
              reason: "verified"
            })
          }]
        };
      }
    };
  };

  try {
    const result = await validateFemalePresenterImage(imagePath, {
      anthropicKey: "test-key",
      seoModel: "test-model"
    });
    assert.equal(result.approved, true);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("validator outages are treated as infrastructure failures, not bad presenters", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "griot-presenter-test-"));
  const imagePath = path.join(tempDir, "presenter.jpg");
  await fs.writeFile(imagePath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ status: 401, ok: false });

  try {
    const result = await validateFemalePresenterImage(imagePath, {
      anthropicKey: "invalid-test-key",
      seoModel: "test-model"
    });
    assert.equal(result.approved, false);
    assert.equal(result.infrastructureFailure, true);
    assert.match(result.reason, /validator HTTP 401/);
  } finally {
    globalThis.fetch = originalFetch;
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("every video and thumbnail is permanently locked to a male presenter", async () => {
  const watchSource = await fs.readFile(new URL("./watch.mjs", import.meta.url), "utf8");
  const renderSource = await fs.readFile(new URL("./render.mjs", import.meta.url), "utf8");
  const thumbnailSource = await fs.readFile(new URL("./thumbnail.mjs", import.meta.url), "utf8");
  const presenterSource = await fs.readFile(new URL("./presenter.mjs", import.meta.url), "utf8");
  const overrides = JSON.parse(
    await fs.readFile(new URL("../content/.cf-video-overrides.json", import.meta.url), "utf8")
  );
  assert.deepEqual(overrides["I Raised My Daughter"], {
    forceReupload: true
  });
  assert.equal(LOCKED_PRESENTER_GENDER, "male");
  assert.match(watchSource, /job\.gender = LOCKED_PRESENTER_GENDER/);
  assert.doesNotMatch(watchSource, /override\.presenterGender/);
  assert.match(renderSource, /const presenterGender = LOCKED_PRESENTER_GENDER/);
  assert.doesNotMatch(renderSource, /job\.gender === "male"/);
  assert.match(presenterSource, /const presenterGender = LOCKED_PRESENTER_GENDER/);
  assert.doesNotMatch(thumbnailSource, /job\.gender === "male"/);
  assert.match(watchSource, /job\.voice = cfg\.narratorVoice/);
  assert.doesNotMatch(watchSource, /job\.voice\s*=\s*override/);
});

test("rendering fails closed when the configured presenter cannot be generated", async () => {
  const renderSource = await fs.readFile(new URL("./render.mjs", import.meta.url), "utf8");
  assert.match(renderSource, /const storyMode = true/);
  assert.match(renderSource, /refusing to render with the wrong presenter/);
});

test("presenter generation requires two visual checks and remembers rejected images", async () => {
  const presenterSource = await fs.readFile(new URL("./presenter.mjs", import.meta.url), "utf8");
  assert.match(presenterSource, /const VALIDATION_PASSES = 2/);
  assert.match(presenterSource, /ANTHROPIC_API_KEY is required to verify every configured presenter/);
  assert.match(presenterSource, /presenter verification could not run/);
  assert.match(presenterSource, /rejectedHashes/);
  assert.match(presenterSource, /validatePresenterImage/);
});

test("a locked host is reused verbatim, without generating or verifying a presenter", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "griot-locked-host-"));
  const workDir = path.join(tempDir, "work");
  await fs.mkdir(workDir, { recursive: true });
  const hostPath = path.join(tempDir, "host.jpg");
  const hostBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0xff, 0xd9]);
  await fs.writeFile(hostPath, hostBytes);
  const originalLocked = process.env.CF_LOCKED_PRESENTER;
  process.env.CF_LOCKED_PRESENTER = hostPath;
  // No anthropicKey and a fetchImage that would throw: the locked path must touch neither.
  const fetchImage = async () => { throw new Error("image API must not be called for a locked host"); };
  try {
    const result = await generateUniquePresenter({
      job: { title: "Any", script: "Any story." },
      cfg: { output: tempDir, log: () => {} },
      workDir,
      fetchImage
    });
    assert.equal(result.identity, "locked-host");
    assert.deepEqual(await fs.readFile(result.file), hostBytes);
  } finally {
    if (originalLocked === undefined) delete process.env.CF_LOCKED_PRESENTER;
    else process.env.CF_LOCKED_PRESENTER = originalLocked;
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("a missing locked host fails loudly instead of falling back to a random presenter", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "griot-locked-missing-"));
  const workDir = path.join(tempDir, "work");
  await fs.mkdir(workDir, { recursive: true });
  const originalLocked = process.env.CF_LOCKED_PRESENTER;
  process.env.CF_LOCKED_PRESENTER = path.join(tempDir, "does-not-exist.jpg");
  try {
    await assert.rejects(
      generateUniquePresenter({
        job: { title: "Any", script: "Any story." },
        cfg: { anthropicKey: "k", seoModel: "m", output: tempDir, log: () => {} },
        workDir,
        fetchImage: async () => { throw new Error("should not reach generation"); }
      }),
      /CF_LOCKED_PRESENTER is set .* could not be read/
    );
  } finally {
    if (originalLocked === undefined) delete process.env.CF_LOCKED_PRESENTER;
    else process.env.CF_LOCKED_PRESENTER = originalLocked;
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("an age-only mismatch falls back to the closest verified man instead of aborting the video", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "griot-presenter-fallback-"));
  const workDir = path.join(tempDir, "work");
  await fs.mkdir(workDir, { recursive: true });
  const originalFetch = globalThis.fetch;
  // Every candidate is a flawless white adult man, but the visual check keeps
  // reporting an apparent age that misses the 61-year narrator.
  globalThis.fetch = async () => ({
    status: 200,
    ok: true,
    async json() {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            person_count: 1,
            adult_man: true,
            white_presenting: true,
            woman_present: false,
            photorealistic: true,
            face_visible: true,
            presenter_framing: true,
            estimated_age: 34,
            age_match: false,
            reason: "clearly a man in his mid-thirties, not 61"
          })
        }]
      };
    }
  });
  const fetchImage = async (prompt, seed, outPath) => {
    await fs.writeFile(outPath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    return true;
  };
  try {
    const result = await generateUniquePresenter({
      job: { title: "A family betrayal", script: "I am 61 years old and recently retired." },
      cfg: { anthropicKey: "test-key", seoModel: "test-model", output: tempDir, log: () => {} },
      workDir,
      fetchImage
    });
    assert.ok(result && result.file, "should return a fallback presenter rather than null");
  } finally {
    globalThis.fetch = originalFetch;
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("a silent image service surfaces a clear, retryable error instead of a blank failure", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "griot-presenter-empty-"));
  const workDir = path.join(tempDir, "work");
  await fs.mkdir(workDir, { recursive: true });
  process.env.CF_PRESENTER_EMPTY_BACKOFF_MS = "0"; // no waiting between empty attempts in tests
  const fetchImage = async () => null; // the image service returns nothing every time
  try {
    await assert.rejects(
      generateUniquePresenter({
        job: { title: "A quiet service", script: "My sister betrayed me at dinner." },
        cfg: { anthropicKey: "test-key", seoModel: "test-model", output: tempDir, log: () => {} },
        workDir,
        fetchImage
      }),
      /image service|can be retried/i
    );
  } finally {
    delete process.env.CF_PRESENTER_EMPTY_BACKOFF_MS;
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("a corrected version bypasses duplicate guards without deleting the existing draft", async () => {
  const uploadSource = await fs.readFile(new URL("./upload.mjs", import.meta.url), "utf8");
  assert.match(uploadSource, /if \(!job\.forceReupload\)/);
  assert.match(uploadSource, /preserving the existing private draft/);
});

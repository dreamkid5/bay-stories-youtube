import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  newFemalePresenterIdentity,
  newMalePresenterIdentity,
  presenterAssessmentApproved,
  validateFemalePresenterImage
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
  assert.match(profile.prompt, /adult white European man presenter/i);
  assert.match(profile.prompt, /white male presenter only/i);
  assert.match(profile.prompt, /no woman, no female person/i);
});

test("narration accepts only the two repository-locked voices", () => {
  assert.equal(LOCKED_NARRATOR_VOICE, "en-US-JennyNeural");
  assert.equal(LOCKED_MALE_NARRATOR_VOICE, "en-US-BrianNeural");
  for (const requested of ["male", "en-US-GuyNeural", "", undefined]) {
    assert.equal(femaleVoice("edge", requested, {}), LOCKED_NARRATOR_VOICE);
    assert.equal(approvedNarratorVoice(requested), LOCKED_NARRATOR_VOICE);
  }
  assert.equal(
    approvedNarratorVoice(LOCKED_MALE_NARRATOR_VOICE),
    LOCKED_MALE_NARRATOR_VOICE
  );
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
  assert.equal(presenterAssessmentApproved(approved), true);

  for (const invalid of [
    { ...approved, person_count: 2 },
    { ...approved, adult_woman: false },
    { ...approved, white_presenting: false },
    { ...approved, man_present: true },
    { ...approved, photorealistic: false },
    { ...approved, face_visible: false },
    { ...approved, presenter_framing: false }
  ]) {
    assert.equal(presenterAssessmentApproved(invalid), false);
  }
});

test("visual validation accepts only one verified white adult man for the exception", () => {
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

test("only the repository override can select the locked male exception", async () => {
  const watchSource = await fs.readFile(new URL("./watch.mjs", import.meta.url), "utf8");
  const overrides = JSON.parse(
    await fs.readFile(new URL("../content/.cf-video-overrides.json", import.meta.url), "utf8")
  );
  assert.deepEqual(overrides["I Raised My Daughter"], {
    presenterGender: "male",
    voice: LOCKED_MALE_NARRATOR_VOICE,
    forceReupload: true
  });
  assert.match(watchSource, /override\.presenterGender === "male"/);
  assert.match(watchSource, /job\.gender = maleException \? "male" : "female"/);
  assert.match(watchSource, /job\.voice = maleException \? LOCKED_MALE_NARRATOR_VOICE : cfg\.femaleVoice/);
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

test("a corrected version bypasses duplicate guards without deleting the existing draft", async () => {
  const uploadSource = await fs.readFile(new URL("./upload.mjs", import.meta.url), "utf8");
  assert.match(uploadSource, /if \(!job\.forceReupload\)/);
  assert.match(uploadSource, /preserving the existing private draft/);
});

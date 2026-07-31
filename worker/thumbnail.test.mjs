import assert from "node:assert/strict";
import test from "node:test";
import { makeHook } from "./thumbnail.mjs";

test("explicit thumbnail hooks remain authoritative and support dense wording", () => {
  const hook = '"You have been replaced," he said. I stayed calm, packed everything that was legally mine, and left. The next morning he learned the truth and called me screaming.';
  assert.equal(makeHook({ hook, script: "ignored" }), hook);
});

test("plain-text stories choose the dramatic opening paragraph instead of weak scene setting", () => {
  const script = [
    "There is a particular sound a vineyard makes at dawn. If you have never stood in the middle of one at five in the morning, you would not know it. My grandfather taught it to me before I could ride a bike.",
    "So on the morning a stranger called to tell me that men in yellow vests were tearing the vines out with an excavator, I heard silence. I heard forty years of my grandfather's life being ripped out by the roots, and my mother standing at the road with a check in her purse.",
    "My name is Ethan Cole, and this is the story of how the woman who raised me sold the one thing that was legally mine, handed the money to my sister, and how I answered her with one envelope that changed everything.",
  ].join("\n\n");

  const hook = makeHook({ script });
  assert.match(hook, /tearing the vines/i);
  assert.match(hook, /mother standing .* check/i);
  assert.doesNotMatch(hook, /^There is a particular sound/i);
  assert.ok(hook.split(/\s+/).length >= 42);
  assert.ok(hook.split(/\s+/).length <= 70);
});

test("dense hooks cap at seventy words without collapsing to a weak first sentence", () => {
  const script = [
    "A calm opening sentence that is deliberately not the payoff.",
    "My husband sold my house, stole my savings, replaced me, lied to the police, and handed everything to his secret lover. " +
      Array.from({ length: 90 }, (_, i) => `word${i + 1}`).join(" "),
  ].join("\n\n");

  const hook = makeHook({ script });
  assert.match(hook, /sold my house/i);
  assert.equal(hook.split(/\s+/).length, 70);
});

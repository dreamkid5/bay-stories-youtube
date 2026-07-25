// Scene matching. Turns each stretch of narration into a concrete VISUAL image
// prompt, so the picture matches what is being said rather than the literal
// words. Claude reads the narration in batches, keeps the main characters
// consistent using the character bible, and returns one image prompt per scene.
// Needs ANTHROPIC_API_KEY. Returns null to fall back to plain per-scene prompts.

function extractJSON(text) {
  if (!text) return null;
  const s = text.indexOf("{"), e = text.lastIndexOf("}");
  if (s < 0 || e <= s) return null;
  try { return JSON.parse(text.slice(s, e + 1)); } catch (x) { return null; }
}

async function ask(cfg, prompt, maxTokens) {
  for (let a = 0; a < 3; a++) {
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": cfg.anthropicKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model: cfg.seoModel, max_tokens: maxTokens, messages: [{ role: "user", content: prompt }] })
      });
      if (r.status === 429 || r.status === 529) { await new Promise((s) => setTimeout(s, 4000 * (a + 1))); continue; }
      if (!r.ok) return null;
      const j = await r.json();
      return j && j.content && j.content[0] && j.content[0].text;
    } catch (e) { await new Promise((s) => setTimeout(s, 2500 * (a + 1))); }
  }
  return null;
}

export async function buildSceneVisuals(scenes, bible, cfg) {
  if (!cfg.anthropicKey || !scenes.length) return null;
  const chars = (bible && bible.characters) || [];
  const charBlock = chars.length
    ? ("Main recurring characters, draw each one consistently every time they appear:\n" +
        chars.map((c) => "- " + c.name + ": " + c.description).join("\n") + "\n\n")
    : "";

  const BATCH = 12;
  const out = new Array(scenes.length).fill(null);

  for (let start = 0; start < scenes.length; start += BATCH) {
    const batch = scenes.slice(start, start + BATCH);
    const numbered = batch.map((s, k) => (start + k + 1) + ". " + s).join("\n");
    const prompt =
      "You are the visual director for a narrated first-person real-life story, the kind of dramatic personal 'storytime' video on YouTube (relationships, family, betrayal, revenge, everyday drama). Every scene is a cinematic PHOTOREALISTIC photograph of modern, present-day real people in ordinary contemporary settings.\n\n" +
      charBlock +
      "Below are numbered narration segments. For EACH number, write ONE concrete visual image prompt describing the exact photo to take for that moment: a clear main subject, the setting, the action, and the emotion, all matching the meaning of the narration. Rules:\n" +
      "- Translate the meaning into a real photo. Do NOT just repeat the narration words.\n" +
      "- BE LITERAL. Show the actual people, place, object or action the line describes. If the line says 'she read the text message', show a woman looking at her phone with a worried face; if it says 'he packed his bags', show a man packing a suitcase.\n" +
      "- MODERN AND REALISTIC. Everyday present-day people in contemporary clothing and settings: homes, apartments, kitchens, bedrooms, offices, cafes, cars, streets, hospitals, courtrooms. No historical, fantasy or costume imagery.\n" +
      "- Show real human EMOTION on faces and body language — worry, tears, anger, shock, relief, joy — matching the feeling of the line.\n" +
      "- Framing: vary the shot cinematically — wide establishing shots of a place, medium two-person shots of a confrontation or conversation, and close-ups of a face or a detail (a phone, a ring, a letter) for emotional emphasis.\n" +
      "- Lighting & mood: natural, soft, cinematic light with shallow depth of field, a warm film look; match the mood of the moment (tense, tender, cold, hopeful).\n" +
      "- When a main character appears, describe them using their fixed look above so the same person is recognisable across the story.\n" +
      "- For abstract or transitional lines, choose a fitting real-world image (an empty chair, a phone screen face-down on a table, a rainy window, two wedding rings, an open door) rather than anything symbolic or old-fashioned.\n" +
      "- Never put on-screen text, captions, letters, or numbers in the image.\n" +
      "- Keep each prompt vivid but under about 40 words.\n\n" +
      "Return ONLY JSON covering every number in this batch, in this shape:\n" +
      '{"prompts":[{"n":<number>,"prompt":"..."}]}\n\n' +
      "Segments:\n" + numbered;

    const text = await ask(cfg, prompt, 2200);
    const data = extractJSON(text);
    if (data && Array.isArray(data.prompts)) {
      for (const p of data.prompts) {
        const idx = Number(p.n) - 1;
        if (idx >= 0 && idx < scenes.length && p && p.prompt) out[idx] = String(p.prompt).trim();
      }
    }
  }

  return out.some(Boolean) ? out : null;
}

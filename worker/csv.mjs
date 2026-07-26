// Shared parsing logic for the background worker.
// Mirrors the Bulk Studio in the app so behavior stays consistent.

export const styleKeywords = {
  watercolor: "storybook illustration, clean bold ink outlines, flat soft watercolor fills, warm vivid palette, gentle cel shading, cream paper background with loose watercolor edges, editorial childrens book art, crisp and detailed, not photorealistic",
  cinematic: "cinematic photograph, dramatic lighting, film still, highly detailed, 35mm",
  storybook: "storybook painting, warm, painterly, whimsical",
  anime: "anime style, cel shaded, vibrant, detailed background",
  "3d": "3d render, soft studio lighting, subsurface scattering, pixar style",
  flat: "flat vector illustration, minimal, bold shapes, clean",
  oil: "oil painting, rich impasto brushstrokes, classical, textured canvas, warm light",
  pencil: "detailed pencil sketch, graphite shading, cross hatching, monochrome, hand drawn",
  comic: "comic book illustration, bold ink outlines, halftone dots, dynamic, vibrant colors",
  papercut: "layered paper cut art, soft drop shadows, tactile, handcrafted, clean edges",
  fantasy: "epic fantasy concept art, luminous atmosphere, highly detailed digital painting",
  vintage: "vintage photograph, faded film grain, nostalgic, sepia and muted tones",
  pixel: "pixel art, 16 bit retro game style, crisp pixels, limited palette",
  claymation: "claymation, plasticine clay model, stop motion, soft studio light",
  lineart: "elegant line art, minimal single weight lines, clean white background",
  synthwave: "synthwave retro futuristic, neon glow, purple and cyan, 1980s aesthetic",
  folktale: "African folktale illustration, rich earth tones, bold tribal patterns, Ndebele and Kente inspired motifs, warm ochre and indigo palette, textured, storytelling art",
  folktale3d: "3D animated feature film still in the style of a Pixar and DreamWorks African folktale, expressive stylized characters with warm dark skin and soft subsurface shading, bright warm natural daylight with soft even front lighting so the characters are clearly and fully lit and easy to see, no dark silhouettes and no heavy backlighting, vibrant and colourful, rural West African village of thatched-roof huts, acacia trees and gentle green hills under a bright blue sky, richly textured woven robes and carved wood, gentle global illumination, high detail, wholesome and heartwarming, not photorealistic, balanced natural framing, mostly wide and medium establishing shots that show the full figure and the surroundings with generous headroom, the main character well lit and clearly visible, not a tightly cropped close-up",
  engraving: "in the style of a hand-coloured Gustave Dore and Albrecht Durer engraving, exquisite fine ink linework and intricate cross-hatching with rich hand-applied colour washes, vivid antique palette of crimson, deep blue, gold, emerald and ochre, sharp coherent faces and hands, deep dramatic chiaroscuro, aged paper, antique illustrated book plate, Renaissance and classical antiquity setting, richly detailed, not photorealistic, not a photograph, no text or words in the image",
  story: "cinematic photorealistic photograph, modern real people in everyday contemporary settings, candid emotional storytelling moment, natural soft lighting, shallow depth of field, 35mm film look, warm cinematic colour grade, highly detailed realistic faces and skin, believable and lifelike, film still, not an illustration, not a drawing, not a cartoon, no text or words in the image"
};

export const VOICES = ["alloy", "echo", "fable", "onyx", "nova", "shimmer"];

// Parse CSV text into rows, handling quoted fields and commas.
export function parseCSV(text) {
  const rows = [];
  let row = [], field = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(field); rows.push(row); row = []; field = ""; }
      else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((f) => f.trim()));
}

// Turn CSV text into a list of jobs.
// Columns: title, script, hook (optional), style, voice, music.
export function jobsFromCSV(text) {
  const rows = parseCSV(text);
  if (!rows.length) return [];
  let start = 0, ti = 0, si = 1, sti = 2, vi = -1, mi = -1, hi = -1;
  const first = rows[0].map((f) => f.trim().toLowerCase());
  if (first.indexOf("script") >= 0) {
    ti = first.indexOf("title"); si = first.indexOf("script"); sti = first.indexOf("style");
    vi = first.indexOf("voice"); mi = first.indexOf("music"); hi = first.indexOf("hook");
    if (ti < 0) ti = 0;
    start = 1;
  }
  const out = [];
  for (let i = start; i < rows.length; i++) {
    const r = rows[i];
    const script = (r[si] || "").trim();
    if (!script) continue;
    out.push({
      title: (r[ti] || ("Video " + (out.length + 1))).trim(),
      script,
      hook: (hi >= 0 && r[hi] ? r[hi].trim() : ""),
      style: (sti >= 0 && r[sti] ? r[sti].trim() : ""),
      voice: (vi >= 0 && r[vi] ? r[vi].trim() : ""),
      music: (mi >= 0 && r[mi] ? r[mi].trim() : "")
    });
  }
  return out;
}

// Split a script into scenes by paragraph, or by sentence when it is one block.
// Break a script into many scenes. It splits into sentences, then groups about
// one to two sentences per scene using a word target, so a long script yields
// lots of scenes rather than a few very long ones. Tunable with CF_SCENE_WORDS.
export function splitScript(text, targetWordsOverride) {
  text = text.trim().replace(/[ \t]+/g, " ").replace(/\n+/g, " ");
  // break into clause level pieces at sentence enders AND commas, for fine control
  let pieces = text.split(/(?<=[.!?,;:])\s+/).map((s) => s.trim()).filter(Boolean);
  if (pieces.length < 2) pieces = text.split(/\n+/).map((s) => s.trim()).filter(Boolean);
  // words per scene: an explicit override (used to hit a target seconds-per-scene once
  // the narration length is known) wins over the CF_SCENE_WORDS setting.
  const TARGET = Math.max(3, Number(targetWordsOverride) || Number(process.env.CF_SCENE_WORDS || 30));
  const parts = [];
  let cur = "", words = 0;
  for (const p of pieces) {
    const w = p.split(/\s+/).filter(Boolean).length;
    cur = cur ? cur + " " + p : p;
    words += w;
    if (words >= TARGET) { parts.push(cur); cur = ""; words = 0; }
  }
  if (cur) parts.push(cur);
  // Absolute safety ceiling only. The real scene budget lives in render.mjs, which
  // stretches scenes to fit rather than cutting the story short, so nothing is
  // truncated here (a silent cut would drop the end of a long script).
  return parts.length ? parts.slice(0, 5000) : [text];
}

export function buildPrompt(scene, style) {
  return scene + ", " + (styleKeywords[style] || styleKeywords.watercolor);
}

export function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "video";
}

# Character & visual reference — Griot Studio

Every video renders in one consistent look, matching the reference image you provided:
a **warm 3D animated African folktale**, in the spirit of a Pixar / DreamWorks feature.

## The house style (`folktale3d`)

- **Medium:** 3D animated feature-film still, soft global illumination, subsurface skin
  shading, shallow depth of field. Wholesome and heartwarming, never photorealistic.
- **Light & mood:** bright, warm natural daylight with soft even front lighting, so
  characters are always clearly lit and easy to see (no dark silhouettes or heavy backlight).
- **Setting:** a timeless rural West African village — thatched-roof huts, packed-earth
  paths, acacia trees, gentle green hills under a bright sky.
- **Wardrobe & props:** richly textured handwoven robes, carved wood, leather satchels,
  walking staffs, beadwork.
- **People:** warm dark skin, expressive stylized features, dignified and characterful.

This is set as the default style everywhere:
- Worker / cloud pipeline: `CF_STYLE=folktale3d` (in `worker/.env`).
- In-app Auto Video, Bulk Studio, Video Studio: "African folktale (3D animated)" is the
  pre-selected art style.
- The full keyword lives in `worker/csv.mjs` (`styleKeywords.folktale3d`) — edit it there
  to fine-tune the look for the whole channel at once.

## The signature narrator — the elder griot

The bearded elder in your reference is the recurring storyteller figure. To keep him
identical across scenes, the pipeline uses Claude's **character bible** + **scene matching**
(needs `ANTHROPIC_API_KEY`, already set). If you want him guaranteed in a video, name him in
the script and describe him once; the pipeline then redraws him consistently. A reusable
description you can paste into any script:

> **Baba the storyteller** — a tall, lean elderly African man in his seventies, long flowing
> white hair and a full white beard, kind weathered face, deep-set eyes. He wears a rust-brown
> handwoven robe with a cream wrap, a leather satchel and bedroll on his back, and carries a
> polished wooden walking staff.

## Voice

Narration uses the free Storytime neural voice pair via `edge-tts`: `en-US-JennyNeural`
for female-led stories and `en-US-BrianNeural` for male-led stories. The worker selects the
voice automatically from the script and delivers it at a warm, measured storytelling cadence.
No key or cost. See `worker/SETUP-VOICE.md`.

## Storytime presenter

Each video generates its own narrator portrait for the left side of the Storytime layout.
That presenter stays identical throughout that one video and is reused on its thumbnail, but
a different script generates a different presenter so separate uploads do not all show the
same person.

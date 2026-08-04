# The male Storytime narration voice — free, no key

Griot Studio narrates every story with **`en-US-BrianNeural`**, the channel's male
Storytime voice. Every video also generates a different male presenter portrait.
When the script states the current first-person narrator's age, that age is added to
the portrait prompt and must pass the same two visual checks as the presenter gender.
The approved age-matched portrait is reused in the video's thumbnail.

## It is free. No AI-generator bill.

The narration uses **`edge-tts`** — the same free neural voices built into the Microsoft Edge
browser's "Read aloud" feature. There is **no API key, no account, and no card**, and it does
**not** cost money per video. It is not a paid AI speech service; it is a free public voice
engine. (Microsoft Azure's paid TTS is still supported as an option, but you do not need it.)

## Install once

```
pip install edge-tts
```

That is the whole setup. On GitHub Actions the publish workflow installs it automatically, so
there is nothing to configure in the cloud.

## Use it

Locally:

```
cd worker
npm run once          # render the current folktales once
# or
npm run now           # keep watching and render new ones as they arrive
```

The worker calls `python3 -m edge_tts` under the hood. Requirements: Python 3 (already on
macOS and on the GitHub runners) and the one `pip install` above.

## Voice options

| Voice | Who |
| :-- | :-- |
| `en-US-BrianNeural` | Male Storytime narration (channel default) |

The channel voice is set with `CF_EDGE_VOICE` (in `worker/.env`, or as `env:` in
`.github/workflows/publish.yml`). Pace and warmth are tuned with `CF_EDGE_RATE` and
`CF_EDGE_PITCH`.

Browse every available voice:

```
edge-tts --list-voices
```

## Want even higher realism later?

`edge-tts` is excellent and free. If one day you want the most expressive possible voice for a
flagship video, ElevenLabs or Azure can be dropped in per the commented options in
`worker/.env.example` — but that is optional and costs money. The free Brian Storytime voice
is the default and never bills you.

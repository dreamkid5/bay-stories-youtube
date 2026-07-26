# The Storytime narration voices — free, no key

Griot Studio narrates every story with an automatic two-voice pair:
**`en-US-JennyNeural`** for female-led scripts and **`en-US-BrianNeural`** for male-led
scripts. The worker detects the story's lead from the script and selects the matching voice.

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
| `en-US-JennyNeural` | Female-led Storytime narration |
| `en-US-BrianNeural` | Male-led Storytime narration |

Override the automatic pair with `CF_FEMALE_VOICE` and `CF_MALE_VOICE` (in `worker/.env`,
or as `env:` in `.github/workflows/publish.yml`). `CF_EDGE_VOICE` remains the general fallback.
Pace and warmth are tuned with `CF_EDGE_RATE` and `CF_EDGE_PITCH`.

Browse every available voice:

```
edge-tts --list-voices
```

## Want even higher realism later?

`edge-tts` is excellent and free. If one day you want the most expressive possible voice for a
flagship video, ElevenLabs or Azure can be dropped in per the commented options in
`worker/.env.example` — but that is optional and costs money. The free Storytime pair is the
default and never bills you.

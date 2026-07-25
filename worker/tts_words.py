#!/usr/bin/env python3
"""
Free edge-tts narration WITH word-level timings.

Usage:
  python3 tts_words.py <text_file> <voice> <out_mp3> <out_words_json> [rate] [pitch]

Writes the mp3 and a JSON list of {"w": word, "t": start_sec, "d": dur_sec},
which the renderer uses to burn karaoke-style captions that follow the voice.
"""
import sys, json, asyncio

try:
    import edge_tts
except ImportError:
    sys.exit("edge-tts not installed. Run: pip install edge-tts")


async def main():
    text = open(sys.argv[1], encoding="utf-8").read()
    voice = sys.argv[2]
    out_mp3 = sys.argv[3]
    out_words = sys.argv[4]
    rate = sys.argv[5] if len(sys.argv) > 5 else "+0%"
    pitch = sys.argv[6] if len(sys.argv) > 6 else "+0Hz"

    # boundary="WordBoundary" is what makes Microsoft return per-word timings.
    c = edge_tts.Communicate(text, voice, rate=rate, pitch=pitch, boundary="WordBoundary")
    words = []
    with open(out_mp3, "wb") as f:
        async for ch in c.stream():
            t = ch.get("type")
            if t == "audio":
                f.write(ch["data"])
            elif t == "WordBoundary":
                words.append({"w": ch["text"], "t": ch["offset"] / 1e7, "d": ch["duration"] / 1e7})
    with open(out_words, "w", encoding="utf-8") as f:
        json.dump(words, f)


asyncio.run(main())

# Start here — Griot Studio in plain English

Griot Studio turns a **written folktale** into a **finished YouTube video** — narrated in a
Nigerian voice, illustrated in a 3D animated folktale look, with a title, description, tags,
and a thumbnail — and (once your channel is connected) uploads it for you.

You do one thing: **write a tale and save it in the `content/` folder on GitHub.** The robot
does the rest.

---

## The two ways to use it

**A. Generate and download** (works right now, no YouTube needed)
Make videos on GitHub and download the finished files to review or upload yourself.

**B. Auto-publish** (after you connect a channel)
Every tale you add is rendered and posted to your YouTube channel automatically.

---

## Everyday flow: generate a video via GitHub

1. **Open your repo:** https://github.com/dreamkid5/griot-studio
2. Go into the **`content`** folder → **Add file → Create new file**.
3. **Name the file** with the exact title you want, ending in `.txt`
   e.g. `The Clever Hare and the Lion.txt`
4. **Type or paste your folktale** in the big box — just normal sentences, the way you'd tell
   it out loud. That text is exactly what gets narrated.
5. Scroll down, click **Commit changes**. (That means "save".)
6. Go to the **Actions** tab (top of the repo).
   - To just make the video: open **"Generate folktale videos (download only)"** → **Run
     workflow** → **Run**.
   - (Once your channel is connected, saving the file is enough — it publishes on its own.)
7. Wait for the green ✓ (a few minutes for a short tale; longer for long ones). Click the
   finished run and download the **`folktale-videos`** file at the bottom — that's your MP4s,
   thumbnails, and the ready-made title/description/tags.

That's it. Repeat with as many tales as you like.

---

## Writing a good tale

- **Length = video length.** Roughly **150 words ≈ 1 minute** of video. Want 10 minutes?
  Write about 1,500 words. Want an hour? About 9,000 words.
- Every sentence or two becomes a **scene** (about 6 seconds each), timed to the voice.
- Want the **same storyteller** to appear throughout? Name and describe them once, e.g.
  "Baba, an old man with long white hair and a brown robe, sat by the fire." The tool then
  keeps him looking the same in every scene.
- Write it warmly, like a griot speaking — that's how it will sound.

---

## Choosing the voice and look (optional)

These are already set to sensible defaults, so you can ignore them:

- **Voice:** free Storytime pair. Female-led scripts use `en-US-JennyNeural`; male-led scripts
  use `en-US-BrianNeural`. The worker chooses automatically from the script.
- **Look:** 3D animated African folktale (`folktale3d`).
- **Scene length:** about 6 seconds.

---

## The website

You also have a live dashboard and studio at **https://griot-studio.pages.dev** where you can
preview art styles and hear the Nigerian voice (Auto Video page). The website is for
experimenting; the **actual publishing is done by GitHub** as described above.

---

## What it costs

Essentially **$0**: free images, free Nigerian voice, free YouTube upload. The only tiny cost
is the AI that writes your titles/descriptions (about a cent per video), and only if you keep
that turned on.

---

## Connecting your YouTube channel (one time, to auto-publish)

See **PUBLISH-ON-GITHUB.md**. Short version: create the channel, generate a "refresh token"
for it, and it gets saved as a secret. After that, saving a tale in `content/` publishes it.

---

Stuck on any step? Ask and I'll do it with you.

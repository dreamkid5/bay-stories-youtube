# manual/ — videos made from your own footage

Drop a **new folder here for every video**. The moment you push it to GitHub,
it renders and uploads to YouTube Studio as a **private draft** automatically —
no other action needed, and no need to come back to Claude to do it.

## 1. Make a folder for your video

Create one folder per video, named however you like — this becomes part of how
the tool tracks it, so **never reuse a folder name** for a different video.

Example: `manual/my-fiance-story/`

## 2. Put these files inside that folder

| File | What it is |
|---|---|
| `0.mp4` | **Optional** intro video clip. Keeps **its own sound**. Plays first, before the narration starts. Leave it out and the video simply starts on image 1. |
| `1.jpg`, `2.jpg`, `3.jpg` ... (or `Scene 1.jpg`, `Scene 2.jpg` ...) | Images shown in order (after video 0 if you included one), one per scene, each with a slow zoom in/out. Name each by its number — a `Scene N` / `Image N` prefix is also accepted, so `Scene 1.jpg` = image 1. |
| `26 (a).jpg` + `26 (b).jpg` (+ `(c)`, `(d)`) | Optional: letter **2–4 images** with the same number to tile them into **one frame** for that scene instead of separate images — **2** = side-by-side face-off, **3** = a row, **4** = a 2×2 grid. Letters must run `a, b, c, d` with no gaps. (`26a`, `26 a`, `26(a)`, `26 (a)` all work.) You reference the scene by its number **once**. |
| `script.txt` | The narration, read in the channel's locked voice. **Recommended:** put a `SCENE N` line before each scene's narration — then each image is shown for exactly as long as its own narration, so picture and voice stay perfectly in sync (see below). |
| `timestamps.txt` | **Only needed if your `script.txt` has no `SCENE` markers.** Sets when each image appears — see the fallback section below. |
| `title.txt` | Optional. The YouTube title. If missing, the title comes from the folder name. |

## 3. Write script.txt with `SCENE` markers (recommended — perfect sync)

Put a **`SCENE N` line** before each scene's narration. Image `N` is then shown
for **exactly as long as scene N's narration takes to speak** — so the picture
always matches the words, with no drift:

```
SCENE 1
The night I met Sergeant Cole Radley, I was parked on the shoulder of Route 9...

SCENE 2
I want to tell you the whole thing from the beginning...

SCENE 3
My name is Desmond Wills. I am forty-one years old...
```

- `SCENE 1`, `SCENE 2`, ... map to images `1`, `2`, ... (a scene using a
  `(a)/(b)` split still maps to that one number).
- The `SCENE N` line is **not** read aloud — only the narration beneath it is. A
  title on the same line (`SCENE 2 — THREE WEEKS EARLIER`) is fine and ignored.
- `SCENE 7`, `Scene 7`, `[7]`, `#7`, `7.` and a bare `7` on its own line all work.
- **When you use `SCENE` markers you do NOT need `timestamps.txt` at all** — the
  narration sets every image's timing automatically.

That's the whole trick to a professional, in-sync video: let the voice decide how
long each picture stays.

## 3b. Fallback: timestamps.txt (only if your script has no `SCENE` markers)

If you'd rather not mark scenes, you can instead give a `timestamps.txt` with one
line per image, `start-end`:

```
1: 0:00-0:12
2: 0:12-0:40
26: 0:40-0:55 she opens the door   ← trailing note is ignored
```

You can paste a full shot list here — ACT headers, narration notes, camera
directions, blank lines — and the tool pulls out only the timing cues. It reads
`1: 0:00-1:00`, or a `SCENE N` number next to (or on the line above) a
`00:00–01:00` range; dashes can be `-`, `–` or `—`; a time-of-day like
`2:00 a.m.` is ignored.

⚠️ **This mode is less accurate.** Your times are estimates, so wherever a scene's
real narration is longer or shorter than you guessed, the picture drifts from the
voice — and it adds up over a long video. The tool rescales everything to finish
together, but only `SCENE` markers give true per-scene sync. Prefer section 3.

## 4. Upload it — directly on GitHub, no terminal needed

**Dragging a whole folder into GitHub's upload page is unreliable** — it only
works in some browsers (Chrome/Edge, sometimes), and many setups will only let
you pick individual files, not a folder, no matter what you drag. The
reliable method sidesteps that entirely: **create the folder first with one
small file, then upload everything else into it.**

1. Go to your repo: **github.com/dreamkid5/bay-stories-youtube**
2. Click **Add file → Create new file**
3. In the filename box, type the **full path**, including your video's folder
   name, e.g.:
   ```
   manual/my-fiance-story/title.txt
   ```
   Put your video's title in the text box (or anything, as a placeholder).
   Commit — this instantly creates the `manual/my-fiance-story/` folder.
4. Go back to the repo and **navigate into that folder** (`manual` →
   `my-fiance-story`) — you are now browsing inside it.
5. Click **Add file → Upload files**. Click **"choose your files"** (skip
   drag-and-drop) — this opens your normal Finder picker.
6. **Select multiple files at once**: click the first file, then hold **Cmd**
   and click each additional one (or press **Cmd+A** to select everything in
   the folder) — grab all your images, `0.mp4`, `script.txt`, and
   `timestamps.txt` in one go.
7. Scroll down, type a short commit message, and click **Commit changes**
   (commit directly to the `main` branch).

Because you uploaded while already browsing inside the right folder, every
file lands in the right place — no folder-drag support needed, works in any
browser including Safari.

## What happens next

- GitHub automatically starts rendering (usually well under an hour — no AI
  image generation involved, just your footage + narration).
- The finished video uploads to **YouTube Studio as a private draft**.
- Your folder is then removed from the repo automatically (its record stays
  in `manual/.cf-uploaded.json` and on YouTube itself, so it's never uploaded
  twice).
- If something fails, your folder is **left in place** — fix the issue and
  push again, or just re-run the workflow.

**Check progress any time:** github.com/dreamkid5/bay-stories-youtube →
**Actions** tab → **"Publish manual videos to YouTube"**.

**Reminder:** this repository is public, so pushing a folder here makes its
raw video/images visible on GitHub from the moment you push — same as your
other videos, which are destined to be public on YouTube anyway.

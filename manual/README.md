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
| `1.jpg`, `2.jpg`, `3.jpg` ... | Images shown in order (after video 0 if you included one), each held on screen for the time you set in `timestamps.txt`, with a slow zoom in/out. |
| `26 (a).jpg` + `26 (b).jpg` (+ `(c)`, `(d)`) | Optional: letter **2–4 images** with the same number to tile them into **one frame** for that slot instead of separate images — **2** = side-by-side face-off, **3** = a row, **4** = a 2×2 grid. Letters must run `a, b, c, d` with no gaps. (`26a`, `26 a`, `26(a)`, `26 (a)` all work.) In `timestamps.txt` you still reference the slot by its number **once**. |
| `script.txt` | The full narration text, read start to finish in the channel's locked voice. |
| `timestamps.txt` | When each image appears on screen — see below. |
| `title.txt` | Optional. The YouTube title. If missing, the title comes from the folder name. |

## 3. Write timestamps.txt

One line per image number, `start-end`, **relative to when the narration
starts** (0:00 = the exact instant video 0 ends, or the very start of the video
if you have no video 0):

```
1: 0:00-0:12
2: 0:12-0:40
26: 0:40-0:55
```

You can add a note after the time range for your own reference — it's ignored,
never treated as narration:

```
26: 0:40-0:55 she opens the door and finds him there
```

**You don't have to strip your file down to just those lines.** You can paste a
full shot list — ACT headers, narration notes, camera directions, image
descriptions and blank lines — and the tool pulls out only the timing cues,
ignoring everything else. It recognises two cue styles:

```
1: 0:00-1:00                 ← "number: start-end"
00:00–01:00 — SCENE 01       ← a time range with the image number in "SCENE N"
```

Dashes can be `-`, `–` or `—`. The image number comes from the leading `N:` or
from a `SCENE N` / `IMAGE N` token. A time range with **no** image number (a
section sub-beat like `39:00–39:20 — THE FAMILY`) is skipped, so it never turns
into a phantom extra image. The render log prints how many cues it kept and how
many lines it ignored, so you can confirm it read what you intended.

If your narration ends up a little longer or shorter than your timestamps add
up to, the tool automatically rescales every image's timing by the same small
percentage (not just the last one), so relative pacing is preserved and
picture and voice always finish together.

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

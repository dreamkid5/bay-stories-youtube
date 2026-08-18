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
| `0.mp4` | Your intro video clip. Keeps **its own sound**. Plays first, before the narration starts. |
| `1.jpg`, `2.jpg`, `3.jpg` ... | Images shown in order after video 0, each held on screen for the time you set in `timestamps.txt`, with a slow zoom in/out. |
| `26a.jpg` + `26b.jpg` | Optional: two images sharing the same number (`a`/`b`) become **one face-off split-screen** for that slot instead of two separate images. (`26 a`, `26(a)`, `26 (a)` also work.) |
| `script.txt` | The full narration text, read start to finish in the channel's locked voice. |
| `timestamps.txt` | When each image appears on screen — see below. |
| `title.txt` | Optional. The YouTube title. If missing, the title comes from the folder name. |

## 3. Write timestamps.txt

One line per image number, `start-end`, **relative to when the narration
starts** (0:00 = the exact instant video 0 ends — not the start of the whole
video):

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

If your narration ends up a little longer or shorter than your timestamps add
up to, the tool automatically stretches the *last* image to match, so picture
and voice always finish together.

## 4. Upload it — directly on GitHub, no terminal needed

1. On your Mac, gather all the files above into **one folder** named your
   story's title (e.g. `my-fiance-story`).
2. Go to your repo: **github.com/dreamkid5/bay-stories-youtube**
3. Open the `manual` folder.
4. Click **Add file → Upload files**.
5. **Drag your whole folder** (not the individual files one by one) from
   Finder into the browser drop zone. In Chrome or Edge this preserves the
   folder structure automatically.
   - *If you're on Safari and it doesn't keep the folder structure:* click
     **Add file → Create new file**, and for the file name type the full path
     first, e.g. `manual/my-fiance-story/script.txt` — GitHub creates the
     folder for you. Paste the content, commit, then go back to
     **Add file → Upload files** *inside* that now-visible folder for the rest.
6. Scroll down, type a short commit message, and click **Commit changes**
   (commit directly to the `main` branch).

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

**Reminder:** this repository is private, but pushing a folder here still
puts its raw video/images into GitHub's history for this repo.

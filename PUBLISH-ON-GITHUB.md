# Publish folktales from GitHub to YouTube

Write a folktale → push it to GitHub → it becomes a narrated, illustrated video on your
YouTube channel, automatically. This is the workflow in
[`.github/workflows/publish.yml`](.github/workflows/publish.yml).

## The loop

1. Add a plain-text tale to the [`content/`](content/) folder (one file = one video, the
   file name is the title).
2. `git commit` and `git push`.
3. GitHub Actions renders it (Storytime visuals + male Brian narration), writes the
   SEO with Claude, and uploads it to YouTube.
4. The script is moved to `content/published/` and the upload ledger is committed back, so a
   tale is never published twice.

It also runs on a **daily schedule** (06:00 UTC) and can be started by hand from the repo's
**Actions** tab.

## Just want to GENERATE videos (not publish yet)?

If your YouTube channel isn't connected yet, you can still make videos on GitHub and download
them:

1. Put your tales in [`content/`](content/) and push.
2. Repo → **Actions** tab → **"Generate folktale videos (download only)"** → **Run workflow**.
3. When it finishes, open the run and download the **`folktale-videos`** artifact — a zip of the
   finished MP4s, thumbnails, and SEO text.

This uses the free male Brian voice and the Storytime look, uploads nothing to YouTube, and
leaves your scripts in place so you can tweak and regenerate. When you're ready to auto-publish,
connect YouTube (below) and use the normal push flow — which also attaches the same downloadable
artifact to every run.

## One-time setup

### 1. Put this project on GitHub

```
cd "YouTube African Folktales"
git init
git add .
git commit -m "Griot Studio"
git branch -M main
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

`worker/.env`, `node_modules/`, and `dist/` are gitignored, so your keys are **not** pushed.
Keys live in GitHub Secrets instead (next step).

### 2. Add the secrets

Repo → **Settings → Secrets and variables → Actions → New repository secret**. Add:

| Secret | What it is | Get it from |
| :-- | :-- | :-- |
| `YT_CLIENT_ID` | YouTube OAuth | [GET-API-KEYS.md](GET-API-KEYS.md) |
| `YT_CLIENT_SECRET` | YouTube OAuth | same |
| `YT_REFRESH_TOKEN` | YouTube OAuth (chooses the channel) | same |
| `ANTHROPIC_API_KEY` | *(recommended)* SEO + character consistency, ~1c/video | console.anthropic.com |
| `CF_IMAGE_TOKEN` | *(optional)* higher image limits | enter.pollinations.ai |

> **The narration voice needs no secret.** It runs on the free `edge-tts` engine, which the
> workflow installs automatically. No Azure, no key, no cost.

> You already have working YouTube OAuth values in `worker/.env`
> (`YT_CLIENT_ID`, `YT_CLIENT_SECRET`, `YT_REFRESH_TOKEN`) — copy those same three values
> straight into the matching secrets.

Optional repo **variable** (Settings → Variables): `CF_YT_PRIVACY` = `public`, `unlisted`,
or `private`. Default is `private`, so you can review each upload before making it public.

### 3. Push your first tale

Two sample tales already sit in `content/`, so the very first push will produce real videos.
Watch progress under the **Actions** tab. When it finishes, the videos are on your channel and
the scripts have moved to `content/published/`.

## Notes

- **No duplicates:** dedup is enforced two ways — the `content/published/` archive and the
  YouTube ledger (`content/.cf-uploaded.json`), which survives even if you rename a video.
- **Cost:** images are free (Pollinations), narration is free (edge-tts), Claude SEO is about a
  cent a video on Haiku. YouTube upload is free. Running it can be essentially $0.
- **Change the look or voice for the whole channel:** edit `CF_STYLE` / `CF_EDGE_VOICE` in
  the workflow file, or `styleKeywords.folktale3d` in `worker/csv.mjs`.

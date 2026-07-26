GRIOT STUDIO — FOLKTALE SCRIPTS FOLDER

This folder feeds the cloud automation that runs on GitHub and publishes to YouTube.

How to add a folktale:
1. Create a plain text file in this folder. Name it exactly what you want the video
   titled, for example:  Why the Tortoise Has a Cracked Shell.txt
2. Write the tale inside as normal sentences. Each sentence or two becomes a scene.
   Write it the way a griot would tell it aloud — that is exactly how it is narrated.
3. Commit and push the file to GitHub.

What happens next (automatically):
- GitHub Actions renders each new script into a narrated, illustrated video.
- The narration uses the free Storytime voice pair via edge-tts: Jenny for female-led
  scripts and Brian for male-led scripts, selected automatically at a warm storytelling pace.
- Every scene is drawn in the 3D animated African folktale look (see CHARACTER-REFERENCE.md).
- Claude writes the SEO title, description, and tags, and keeps characters consistent.
- The finished video is uploaded to your YouTube channel.
- The script is then moved into the published/ folder so it is never made twice.

You can also trigger a run by hand from the repo's Actions tab
(the "Publish folktales to YouTube" workflow → Run workflow).

Two ready-made sample tales are already in this folder, so your first push produces
real videos. Tip: name a recurring narrator (e.g. "Baba the storyteller") in your
scripts and describe him once, and he will be drawn the same way in every scene.

Files whose name starts with an underscore, like this one, are ignored.

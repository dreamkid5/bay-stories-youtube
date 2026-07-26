#!/usr/bin/env python3
"""
Generate a storytime YouTube thumbnail (1280x720) that matches the reference look:
the presenter photo on the RIGHT, and the story's hook on the LEFT in bold, uppercase-free
Montserrat ExtraBold with each clause in a punchy colour (green / gold / red / magenta on
a clean white background). All free, drawn with Pillow.

Usage:
  python3 thumbnail.py <portrait_jpg> <hook_text> <out_path> <width> <height> <font_path>
"""
import sys, re

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    sys.exit("Pillow not installed. Run: pip install pillow")

# Palette sampled to match the reference thumbnail (readable on a white background).
GREEN   = (22, 176, 74)
GOLD    = (214, 150, 0)     # the "yellow" role, but readable on white
RED     = (224, 27, 16)
MAGENTA = (206, 24, 178)
BG      = (255, 255, 255)
MIDDLE_ACCENTS = [GOLD, MAGENTA, GREEN]


def segment(text):
    """Split the hook into clauses, keeping quoted spans ("...") whole."""
    segs = []
    for part in re.split(r'(\"[^\"]*\"|“[^”]*”)', text):
        if not part:
            continue
        if part[0] in '"“':
            segs.append(("quote", part.strip()))
        else:
            for clause in re.split(r'(?<=[,.!?—-])\s+', part.strip()):
                clause = clause.strip()
                if clause:
                    segs.append(("plain", clause))
    return segs


def chunk(segs, size=4):
    """Break clauses into <=size-word pieces so even a single unpunctuated sentence
    gets several colour groups (avoids leaving a lone trailing word)."""
    out = []
    for kind, seg in segs:
        words = seg.split()
        i = 0
        while i < len(words):
            n = size
            if len(words) - i == size + 1:  # don't strand a single word
                n = size - 1
            out.append((kind, " ".join(words[i:i + n])))
            i += n
    return out


def colourise(segs):
    """Match the reference palette and sequence: opening hook in green, quoted
    speech in magenta, middle/twist clauses in gold or another bright accent, and
    the final payoff in red. Never insert black-filled groups; black is outline only.
    If there are too few clauses, colour short word-groups instead."""
    if len(segs) < 4:
        segs = chunk(segs, 4)
    out, middle_i = [], 0
    for i, (kind, seg) in enumerate(segs):
        is_last = (i == len(segs) - 1)
        has_money = bool(re.search(r"[$€£]|\d", seg))
        if has_money or is_last:
            colour = RED
        elif kind == "quote":
            colour = MAGENTA
        elif i == 0:
            colour = GREEN
        elif i > 0 and segs[i - 1][0] == "quote":
            colour = GOLD
        else:
            colour = MIDDLE_ACCENTS[middle_i % len(MIDDLE_ACCENTS)]
            middle_i += 1
        out.append((seg, colour))
    return out


def flatten_words(coloured):
    words = []
    for seg, colour in coloured:
        for w in seg.split():
            words.append((w, colour))
    return words


def wrap(words, font, max_w):
    """Greedy word-wrap into lines of (word, colour), each line width <= max_w."""
    lines, cur, cur_w = [], [], 0
    space = font.getlength(" ")
    for w, colour in words:
        ww = font.getlength(w)
        add = ww if not cur else cur_w + space + ww
        if cur and add > max_w:
            lines.append(cur)
            cur, cur_w = [(w, colour)], ww
        else:
            cur.append((w, colour))
            cur_w = add
    if cur:
        lines.append(cur)
    return lines


def main():
    portrait, hook, out_path = sys.argv[1], sys.argv[2], sys.argv[3]
    W = int(sys.argv[4]) if len(sys.argv) > 4 else 1280
    H = int(sys.argv[5]) if len(sys.argv) > 5 else 720
    font_path = sys.argv[6]

    canvas = Image.new("RGB", (W, H), BG)

    # --- presenter on the right, cover-cropped, with a feathered left edge ---
    panel_w = int(W * 0.42)
    try:
        p = Image.open(portrait).convert("RGB")
        pw, ph = p.size
        scale = max(panel_w / pw, H / ph)
        p = p.resize((int(pw * scale), int(ph * scale)), Image.LANCZOS)
        # centre-crop to the panel
        left = (p.width - panel_w) // 2
        top = (p.height - H) // 2
        p = p.crop((left, top, left + panel_w, top + H))
        # feather the leftmost slice so the photo melts into the white text area
        feather = int(panel_w * 0.28)
        mask = Image.new("L", (panel_w, H), 255)
        mpx = mask.load()
        for x in range(feather):
            a = int(255 * (x / feather))
            for y in range(H):
                mpx[x, y] = a
        canvas.paste(p, (W - panel_w, 0), mask)
    except Exception as e:
        sys.stderr.write("thumbnail: portrait skipped (%s)\n" % e)

    draw = ImageDraw.Draw(canvas)
    words = flatten_words(colourise(segment(hook)))

    # --- auto-fit the hook into the left text area ---
    pad_x, pad_top, pad_bot = 46, 46, 46
    area_w = int(W * 0.60) - pad_x
    area_h = H - pad_top - pad_bot
    size = int(H * 0.11)
    while size >= 22:
        font = ImageFont.truetype(font_path, size)
        lines = wrap(words, font, area_w)
        line_h = int(size * 1.16)
        if len(lines) * line_h <= area_h and all(
            sum(font.getlength(w) for w, _ in ln) + font.getlength(" ") * (len(ln) - 1) <= area_w
            for ln in lines
        ):
            break
        size -= 2

    font = ImageFont.truetype(font_path, size)
    lines = wrap(words, font, area_w)
    line_h = int(size * 1.16)
    space = font.getlength(" ")
    stroke = max(2, int(size * 0.06))

    total_h = len(lines) * line_h
    y = pad_top + max(0, (area_h - total_h) // 2)
    for ln in lines:
        x = pad_x
        for w, colour in ln:
            # soft shadow for depth, then the word with a thin dark outline
            draw.text((x + 2, y + 3), w, font=font, fill=(0, 0, 0))
            draw.text((x, y), w, font=font, fill=colour,
                      stroke_width=stroke,
                      stroke_fill=(15, 15, 18))
            x += font.getlength(w) + space
        y += line_h

    canvas.save(out_path, quality=92)
    sys.stderr.write("thumbnail: wrote %s (font %dpx, %d lines)\n" % (out_path, size, len(lines)))


main()

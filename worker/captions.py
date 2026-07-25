#!/usr/bin/env python3
"""
Build an ASS subtitle file of karaoke-style captions from word timings, matching the
modern storytime look: bold uppercase white words (Montserrat ExtraBold) with a black
outline, and the currently-spoken word sitting on a solid highlight box.

Usage:
  python3 captions.py <words_json> <out_ass> <width> <height> <font_path> \
                      <font_family> <font_size> <highlight_hex> <max_words> <y_frac>

words_json: list of {"w": word, "t": start_sec, "d": dur_sec} on the GLOBAL timeline.
"""
import sys, json

try:
    from PIL import ImageFont
except ImportError:
    sys.exit("Pillow not installed. Run: pip install pillow")


def ass_time(s):
    if s < 0:
        s = 0
    h = int(s // 3600); s -= h * 3600
    m = int(s // 60); s -= m * 60
    cs = int(round((s - int(s)) * 100))
    sec = int(s)
    if cs == 100:
        cs = 0; sec += 1
    return f"{h}:{m:02d}:{sec:02d}.{cs:02d}"


def hex_to_ass(hex_color):
    h = hex_color.lstrip("#")
    r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    return f"&H00{b:02X}{g:02X}{r:02X}"  # ASS is &HAABBGGRR


def main():
    words_json, out_ass = sys.argv[1], sys.argv[2]
    W, H = int(sys.argv[3]), int(sys.argv[4])
    font_path, font_family = sys.argv[5], sys.argv[6]
    font_size = int(sys.argv[7])
    hi = hex_to_ass(sys.argv[8])
    max_words = int(sys.argv[9]) if len(sys.argv) > 9 else 4
    y_frac = float(sys.argv[10]) if len(sys.argv) > 10 else 0.70

    words = json.load(open(words_json, encoding="utf-8"))
    words = [w for w in words if str(w.get("w", "")).strip()]
    if not words:
        open(out_ass, "w").write(header(W, H, font_family, font_size))
        return

    # each word stays highlighted until the next word begins
    for i, w in enumerate(words):
        w["W"] = str(w["w"]).upper()
        w["end"] = words[i + 1]["t"] if i + 1 < len(words) else w["t"] + max(0.2, w["d"])

    font = ImageFont.truetype(font_path, font_size)

    # Use the ADVANCE width (getlength), which is how libass lays text out. Using the
    # ink bbox instead makes the highlight box drift sideways from the word.
    def width_of(txt):
        return font.getlength(txt)

    space_w = width_of(" ")
    line_h = int(font_size * 1.15)
    y = int(H * y_frac)
    cx = W / 2.0

    # group into short phrases (reset on sentence-ending punctuation too)
    phrases, cur = [], []
    for w in words:
        cur.append(w)
        ends_sentence = str(w["w"]).rstrip()[-1:] in ".!?"
        if len(cur) >= max_words or ends_sentence:
            phrases.append(cur); cur = []
    if cur:
        phrases.append(cur)

    box_events, text_events = [], []
    for ph in phrases:
        texts = [w["W"] for w in ph]
        widths = [width_of(t) for t in texts]
        total = sum(widths) + space_w * (len(ph) - 1)
        start_x = -total / 2.0  # relative to phrase centre
        # per-word centre offset from the phrase centre
        run = start_x
        centres = []
        for wd in widths:
            centres.append(run + wd / 2.0)
            run += wd + space_w
        p_start, p_end = ph[0]["t"], ph[-1]["end"]
        # Position EACH word individually at its own centre (rather than letting libass
        # centre the whole phrase), and put its highlight box at the SAME centre, so the
        # box and the word can never drift apart regardless of libass's own metrics.
        for text_w, wd_w, c, wobj in zip(texts, widths, centres, ph):
            wx = cx + c
            # white word text, shown for the whole phrase (drawn on top)
            text_events.append(
                f"Dialogue: 1,{ass_time(p_start)},{ass_time(p_end)},Cap,,0,0,0,,"
                f"{{\\an5\\pos({wx:.0f},{y})}}{text_w}"
            )
            # highlight box behind that word, only while it is being spoken (drawn under)
            hw = wd_w / 2.0 + font_size * 0.28
            hh = line_h / 2.0 + font_size * 0.10
            r = font_size * 0.22
            draw = rounded_rect_abs(wx, y, hw, hh, r)
            box_events.append(
                f"Dialogue: 0,{ass_time(wobj['t'])},{ass_time(wobj['end'])},Box,,0,0,0,,"
                f"{{\\an7\\pos(0,0)\\p1\\1c{hi}\\bord0\\shad0}}{draw}{{\\p0}}"
            )

    with open(out_ass, "w", encoding="utf-8") as f:
        f.write(header(W, H, font_family, font_size))
        for e in box_events:
            f.write(e + "\n")
        for e in text_events:
            f.write(e + "\n")


def rounded_rect_abs(cx, cy, hw, hh, r):
    # ASS drawing: rounded rectangle at ABSOLUTE frame coords centred on (cx, cy),
    # so with \an7\pos(0,0) it lands exactly behind the target word.
    x0, y0, x1, y1 = round(cx - hw), round(cy - hh), round(cx + hw), round(cy + hh)
    r = round(min(r, hw, hh))
    return (
        f"m {x0+r} {y0} l {x1-r} {y0} b {x1} {y0} {x1} {y0} {x1} {y0+r} "
        f"l {x1} {y1-r} b {x1} {y1} {x1} {y1} {x1-r} {y1} "
        f"l {x0+r} {y1} b {x0} {y1} {x0} {y1} {x0} {y1-r} "
        f"l {x0} {y0+r} b {x0} {y0} {x0} {y0} {x0+r} {y0}"
    )


def header(W, H, family, size):
    outline = max(3, round(size * 0.10))
    return (
        "[Script Info]\n"
        "ScriptType: v4.00+\n"
        f"PlayResX: {W}\nPlayResY: {H}\n"
        "WrapStyle: 2\nScaledBorderAndShadow: yes\n\n"
        "[V4+ Styles]\n"
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n"
        f"Style: Cap,{family},{size},&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,{outline},0,5,40,40,40,1\n"
        f"Style: Box,{family},{size},&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,0,0,5,40,40,40,1\n\n"
        "[Events]\n"
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"
    )


main()

"""Render the card-fan brand mark as a PNG for upload to GitHub org settings.

Matches the SVG at web/favicon.svg: gold gradient backdrop, dark card-fan glyph,
gold border. Output sized for GitHub's avatar slot (recommended >= 500x500).
"""

import math
from pathlib import Path
from PIL import Image, ImageDraw

SIZE = 512
OUT = Path(__file__).resolve().parent.parent / "logo-512.png"

# Gold gradient endpoints (top-left → bottom-right) — same as the SVG <linearGradient>.
GOLD_LIGHT = (244, 200, 66)
GOLD_DARK = (201, 142, 31)
BORDER = (255, 228, 138)
CARD_DARK = (26, 14, 2)


def make_gradient(size: int) -> Image.Image:
    img = Image.new("RGB", (size, size), GOLD_DARK)
    px = img.load()
    diag = (size - 1) * 2  # max value of (x + y)
    for y in range(size):
        for x in range(size):
            t = (x + y) / diag  # 0 at top-left, 1 at bottom-right
            r = round(GOLD_LIGHT[0] * (1 - t) + GOLD_DARK[0] * t)
            g = round(GOLD_LIGHT[1] * (1 - t) + GOLD_DARK[1] * t)
            b = round(GOLD_LIGHT[2] * (1 - t) + GOLD_DARK[2] * t)
            px[x, y] = (r, g, b)
    return img


def rounded_rect_mask(size: int, radius: int) -> Image.Image:
    """Alpha mask for the outer rounded square."""
    m = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(m)
    d.rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)
    return m


def draw_card(width: int, height: int, radius: int, rotate_deg: float, with_dot: bool, opacity: int) -> Image.Image:
    """Draw a single dark card rounded rectangle, then rotate it."""
    pad = max(width, height) // 2
    canvas_size = max(width, height) * 2
    layer = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    cx = (canvas_size - width) // 2
    cy = (canvas_size - height) // 2
    fill = (*CARD_DARK, opacity)
    d.rounded_rectangle((cx, cy, cx + width, cy + height), radius=radius, fill=fill)
    if with_dot:
        # Front card has a darker artwork "dot"
        dot_r = round(width * 0.18)
        dx = cx + round(width * 0.59)
        dy = cy + round(height * 0.5)
        d.ellipse((dx - dot_r, dy - dot_r, dx + dot_r, dy + dot_r), fill=(0, 0, 0, 180))
    return layer.rotate(rotate_deg, resample=Image.BICUBIC, expand=False)


def main() -> None:
    # Background: gold gradient, masked to a rounded square
    bg = make_gradient(SIZE)
    mask = rounded_rect_mask(SIZE, radius=round(SIZE * 0.16))  # ~80px on 512
    base = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    base.paste(bg, (0, 0), mask)

    # Border
    bd = ImageDraw.Draw(base)
    bd.rounded_rectangle(
        (4, 4, SIZE - 5, SIZE - 5),
        radius=round(SIZE * 0.155),
        outline=(*BORDER, 255),
        width=8,
    )

    # Card geometry. Source SVG used 24x24 viewBox with cards at 11x14.
    # Scale up to roughly 60% of the canvas.
    card_w = round(SIZE * 0.46)
    card_h = round(SIZE * 0.58)
    radius = round(card_w * 0.13)

    # Back card: rotate -12°, offset slightly left, semi-transparent
    back = draw_card(card_w, card_h, radius, rotate_deg=12, with_dot=False, opacity=140)
    # Front card: rotate 8°, full opacity, with dot
    front = draw_card(card_w, card_h, radius, rotate_deg=-8, with_dot=True, opacity=255)

    # Compose: back first slightly down-left, front slightly up-right
    bw, bh = back.size
    fw, fh = front.size
    back_x = (SIZE - bw) // 2 - round(SIZE * 0.04)
    back_y = (SIZE - bh) // 2 + round(SIZE * 0.02)
    front_x = (SIZE - fw) // 2 + round(SIZE * 0.04)
    front_y = (SIZE - fh) // 2 - round(SIZE * 0.02)

    base.alpha_composite(back, (back_x, back_y))
    base.alpha_composite(front, (front_x, front_y))

    base.save(OUT, "PNG")
    print(f"Wrote {OUT}  ({OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()

"""Render web/og-image.png (1200x630) for social link previews.

Screenshots scripts/og-template.html with headless Chrome so the image uses
the site's real Arena-theme tokens and webfonts (Orbitron / Cinzel / Noto)
instead of a hand-drawn approximation. Social crawlers (Facebook, X, Discord)
do not render SVG og:images, hence a committed PNG.

Run on demand (needs local Chrome + network for Google Fonts):
    uv run python scripts/build_og_image.py
Set CHROME_PATH to override Chrome discovery.
"""

import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TEMPLATE = ROOT / "scripts" / "og-template.html"
OUT = ROOT / "web" / "og-image.png"

CHROME_CANDIDATES = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
]


def find_chrome() -> str:
    env_path = os.environ.get("CHROME_PATH")
    if env_path and Path(env_path).exists():
        return env_path
    for name in ("chrome", "google-chrome", "chromium"):
        found = shutil.which(name)
        if found:
            return found
    for candidate in CHROME_CANDIDATES:
        if Path(candidate).exists():
            return candidate
    raise SystemExit("Chrome not found; set CHROME_PATH to your Chrome executable.")


def main() -> None:
    chrome = find_chrome()
    cmd = [
        chrome,
        "--headless",
        "--disable-gpu",
        "--hide-scrollbars",
        "--force-device-scale-factor=1",
        "--window-size=1200,630",
        # Let Google Fonts finish loading before the shot is taken.
        "--run-all-compositor-stages-before-draw",
        "--virtual-time-budget=12000",
        f"--screenshot={OUT}",
        TEMPLATE.resolve().as_uri(),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    if not OUT.exists() or OUT.stat().st_size == 0:
        sys.stderr.write(result.stderr or result.stdout or "")
        raise SystemExit("Screenshot failed; no og-image.png produced.")
    print(f"Wrote {OUT} ({OUT.stat().st_size / 1024:.1f} KiB)")


if __name__ == "__main__":
    main()

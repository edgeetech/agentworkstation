# Company Cover

Make an original cover image; the owner uploads it.

1. Read the brand colours and fonts from `memory/company-page.md`.
2. Write an original SVG at 1128x191. Keep the left 36% free of text because the page logo overlaps it. Keep the right edge free because narrow layouts crop it.
3. Render PNGs at 1x and 2x with headless Chrome: `chrome --headless=new --screenshot=cover.png --window-size=1128,191 --force-device-scale-factor=1 file:///path/cover.svg`, then again with `--screenshot=cover@2x.png` and `--force-device-scale-factor=2`.
4. Check both PNGs visually for text colliding with the logo area or the right edge.
5. Write the files through `filesystem.proposeWrite` and give the owner the paths. Do not upload.

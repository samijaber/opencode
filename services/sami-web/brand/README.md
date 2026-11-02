# Hub artwork

`source.png` is the owner-selected artwork from https://chatgpt.com/s/m_6ae7d61db8d48191a52d6585d14a0c66.
Preserve its original silhouette, ivory forms, cyan center and opaque dark background. Do not redraw or recolor it.

The checked-in launcher images in `../assets/hub/` are proportional downscales of this original:

- `apple-touch-icon.png`: 180 × 180
- `icon.png`: 192 × 192
- `icon-512.png`: 512 × 512
- `favicon.ico`: embedded 16, 32 and 48 pixel PNGs

PNG exports use macOS `sips -z SIZE SIZE source.png --out DESTINATION`. ICO entries wrap the corresponding PNGs without changing their pixels. Corners are not baked in; the platform supplies its own mask. These exports are `any` icons, not Android maskable artwork.

`prepare-assets.mjs` copies the exports and manifest into the custom frontend build. Only Hub receives this branding; the canonical OpenCode hostname and desktop icons stay unchanged.

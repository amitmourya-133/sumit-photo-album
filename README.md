# QR Photo Album

A mobile-first, full-screen photo album designed to be opened by scanning a QR code.
Tap or swipe to navigate, or let it auto-advance every 5 seconds, with optional background music.

## Features

- Full-screen responsive layout using `100dvh`
- Tap anywhere to advance to the next photo (or tap overlay to unlock music)
- Automatic slideshow every 5 seconds (tap resets the timer)
- Left/right swipe gestures on mobile
- Previous/next buttons for desktop
- Photo counter (e.g. `3 / 48`)
- Background music with panel controls (Play/Pause, Mute/Unmute, volume, track selector)
- Start overlay that unlocks audio after the first user interaction (browser autoplay rules)
- Two-image preloading for smooth transitions without loading every image
- Graceful handling of missing images and an empty photo list
- Local admin panel for multi-photo upload/optimize, reorder, delete, and music upload/active-track management

## Requirements

- Node.js 18+ (tested with Node 24)
- npm

## Project structure

```
.
├── index.html          # Album page
├── admin.html          # Local admin manager (http://localhost:3000/admin.html)
├── css/style.css       # Album styling
├── css/admin.css       # Admin styling
├── js/slideshow.js     # Album logic
├── js/admin.js         # Admin logic
├── server.js           # Local dev/management server (API + static)
├── resize.js           # Image processing (Sharp -> WebP + photos.json)
├── photos.json         # Generated manifest of processed photos
├── music.json          # Music manifest { active, tracks }
├── photos/             # Optimized WebP images (gitignored; uploaded by vercel CLI)
├── raw-photos/         # Original uploads processed by admin/local tools (gitignored)
├── music/              # Uploaded MP3/M4A tracks (gitignored; uploaded by vercel CLI)
├── qr-code.png         # QR code for live album
└── package.json
```

## Setup

```powershell
cd "D:\photo  pp"
npm install
```

## Add and manage photos/music (recommended)

The easiest way is to use the local admin panel on the dev server.

1. Start the local server:
   ```powershell
   npm start
   ```
2. Open <http://localhost:3000/admin.html> (binds to `127.0.0.1` only).
3. Upload photos (JPEG/PNG/WebP/AVIF) — the admin will optimize them to WebP (max 1600px), store originals in `raw-photos/`, update `photos/` and `photos.json`.
4. Reorder with Up/Down or Delete as needed, then "Save order".
5. Upload music (`.mp3`, `.m4a`) in the Music section, set the active track, preview, or delete tracks.

> The admin/API is for local use only and is excluded from Vercel deployment. Do **not** rely on browser uploads working on the public Vercel site.

## Batch process photos (alternative)

If you prefer to drop originals into `raw-photos/`:

1. Copy your original images (`.jpg`, `.jpeg`, `.png`, `.webp`) into `raw-photos/`.
2. Run:
   ```powershell
   npm run process
   ```
   This resizes each image to a maximum width of 1600px (aspect ratio preserved), converts to WebP, writes to `photos/`, and regenerates `photos.json`.

## Run locally

```powershell
npm start
```
Then open <http://localhost:3000>. Use a different port with `$env:PORT=8081; npm start`.

> Open through the local server (not `file://`) because `fetch` is used for `photos.json` and `music.json`.

## Background music

- Upload tracks via `/admin.html` or place files in `music/` and update `music.json` with `{ active, tracks }`.
- The site reads `music.json` and shows a track selector. Volume/mute are persisted in `localStorage`; track selection is session-specific and resets to the active track from `music.json` on load.
- Browsers only allow audio to start after a user interaction, so the start overlay unlocks playback on the first tap. If autoplay is blocked, use the Music panel Play button.

## Deployment (Vercel)

This is a static site. Generated media (`photos/`, `music/`) are gitignored, so deploy from the CLI to include them.

```powershell
npx vercel --prod
```

Notes:
- `.vercelignore` excludes `server.js`, `admin.html`, `js/admin.js`, `css/admin.css`, `resize.js`, `package.json`, `package-lock.json`, `README.md` etc. Keep `photos/`, `music/`, `photos.json`, `music.json`, `index.html`, `css/style.css`, `js/slideshow.js`, and `qr-code.png`.
- Always regenerate/process or upload media before deploying.
- After deploying, verify the production URL loads the homepage, CSS, JS, manifests, and images.
- Live album: <https://sumit-photo-album.vercel.app> (QR: `qr-code.png`).

## QR code

The live album is available at <https://sumit-photo-album.vercel.app>. A ready-to-print QR code for that URL is included as `qr-code.png` (600x600). To regenerate:

```powershell
npx --yes qrcode -o qr-code.png -w 600 "https://sumit-photo-album.vercel.app"
```

## Troubleshooting

- **Blank page / counter shows `0 / 0`**: `photos.json` is missing or empty. Add photos via admin or run `npm run process`.
- **Photos do not load**: confirm files exist under `photos/` and that `photos.json` paths start with `/photos/`.
- **`fetch` errors when opening `index.html` directly**: use `npm start` instead of `file://`.
- **No music**: ensure tracks exist in `music/` and `music.json` is valid; tap to start or use Play in the Music panel.
- **Images look cropped**: the album uses `object-fit: cover` for full-screen display.
- **Windows file locks on delete/replace**: the server retries with short delays on `EPERM/EBUSY/EACCES`. Close other apps using images/tracks and retry.
- **Sharp install issues**: use Node 18+ and reinstall with `npm install`.

## Scripts

- `npm run process` — resize/convert photos from `raw-photos/` and rebuild `photos.json`
- `npm start` / `npm run serve` — start the local static + management server on port 3000
- `npm run deploy` — deploy to Vercel production via CLI
- `npm run check` — syntax-check `resize.js`, `server.js`, `js/slideshow.js`, `js/admin.js`

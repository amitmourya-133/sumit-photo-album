# QR Photo Album

A mobile-first, full-screen photo album designed to be opened by scanning a QR code.
Tap or swipe to navigate, or let it auto-advance every 5 seconds, with optional background music.

## Features

- Full-screen responsive layout using `100dvh`
- Tap anywhere to advance to the next photo
- Automatic slideshow every 5 seconds (tap resets the timer)
- Left/right swipe gestures on mobile
- Previous/next buttons for desktop
- Photo counter (e.g. `3 / 48`)
- Background music with a floating mute/unmute button
- Start overlay that unlocks audio after the first user interaction (browser autoplay rules)
- Two-image preloading for smooth transitions without loading every image
- Graceful handling of missing images and an empty photo list

## Requirements

- Node.js 18+ (tested with Node 24)
- npm

## Project structure

```
.
├── index.html          # Album page
├── css/style.css       # Styling
├── js/slideshow.js     # Slideshow logic
├── server.js           # Zero-dependency local dev server
├── resize.js           # Image processing (Sharp -> WebP + photos.json)
├── photos.json         # Generated manifest of processed photos
├── photos/             # Generated optimized WebP images (not in git)
├── raw-photos/         # Your original images (not in git)
├── music.mp3           # Optional background music (not in git)
└── package.json
```

## Setup

```powershell
cd "D:\photo  pp"
npm install
```

## Add and process photos

1. Copy your original images (`.jpg`, `.jpeg`, `.png`, `.webp`) into `raw-photos/`.
2. Run the processing script:

```powershell
npm run process
```

This resizes each image to a maximum width of 1400px (aspect ratio preserved),
converts it to WebP, writes it to `photos/`, and regenerates `photos.json`.

## Run locally

```powershell
npm start
```

Then open <http://localhost:3000>. Use a port other than 3000 with `$env:PORT=8081; npm start`.

> Note: open the site through the local server, not by double-clicking `index.html`.
> The album loads `photos.json` with `fetch`, which browsers block on `file://` URLs.

## Background music

Place a file named `music.mp3` in the project root. Browsers only allow audio to start
after a user interaction, so the start overlay triggers playback on the first tap.

## Deployment (Vercel)

This is a static site; no build step is required.

```powershell
npx vercel --prod
```

- Processed `photos/` files are uploaded; `raw-photos/` and `node_modules/` are excluded via `.vercelignore`.
- Ensure `photos.json` and the `photos/` folder are generated before deploying.
- After deploying, verify the production URL loads the homepage, CSS, JS, `photos.json`, and images.

## Troubleshooting

- **Blank page / counter shows `0 / 0`**: `photos.json` is missing or empty. Add images to
  `raw-photos/` and run `npm run process`.
- **Photos do not load**: confirm files exist under `photos/` and that `photos.json` paths start with `/photos/`.
- **`fetch` errors when opening `index.html` directly**: use `npm start` instead of `file://`.
- **No music**: confirm `music.mp3` exists in the project root and that you tapped to start.
- **Images look cropped**: the album uses `object-fit: cover` for full-screen display.
- **Sharp install issues**: use Node 18+ and reinstall with `npm install`.

## Scripts

- `npm run process` — resize/convert photos and rebuild `photos.json`
- `npm start` — start the local static server on port 3000
- `npm run check` — syntax-check `resize.js`, `server.js`, and `js/slideshow.js`

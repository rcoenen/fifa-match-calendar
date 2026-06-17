# FIFA Match Calendar

A simple, readable FIFA match calendar for World Cup 2026. Who plays, when, and at what time — shown in New York time by default.

**Live site:** https://fifa-match-calendar.pages.dev/

## Stack

Plain HTML, CSS, and JavaScript. No framework, no build step. Match data lives in `matches.json` (with an embedded fallback copy in `index.html` for offline `file://` use).

## Local preview

Serve the folder with any static file server, for example:

```bash
python3 -m http.server 8080
```

Then open http://localhost:8080

## Updating matches

Edit `matches.json`, then sync the embedded fallback in `index.html` if you want offline/file:// support to stay in step.

## Deploy

Static assets deploy cleanly to Cloudflare Pages (or any static host). Point the project at this directory with no build command.
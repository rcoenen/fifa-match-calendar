# FIFA Match Calendar

A simple, readable FIFA match calendar for World Cup 2026. Who plays, when, and at what time — shown in New York time by default.

**Live site:** https://fifa-match-calendar.pages.dev/

## Stack

Plain HTML, CSS, and JavaScript. No framework, no build step. Match data lives in `matches.json` (with an embedded fallback copy in `index.html` for offline `file://` use).

## Live scores & results

World Cup match scores are pulled from ESPN's public API (no key required).

| Layer | What it does |
|---|---|
| **Browser** | Polls `/api/scores` every 30–60s during live/recent matches and updates cards in place |
| **`npm run sync`** | Writes ESPN results into `matches.json` + the `index.html` fallback |
| **GitHub Action** | Runs `npm run sync` every 15 minutes, commits changes, deploys to Cloudflare Pages |

### Update scores manually

```bash
npm run sync
wrangler pages deploy . --project-name=fifa-match-calendar --branch=main
```

### GitHub Action secrets (optional, for auto-deploy)

Add these repo secrets if you want the workflow to deploy after syncing:

- `CLOUDFLARE_API_TOKEN` — token with Cloudflare Pages edit permission
- `CLOUDFLARE_ACCOUNT_ID` — your Cloudflare account ID

Without them, the workflow still commits score updates to GitHub; you deploy with Wrangler yourself.

## Local preview

```bash
python3 -m http.server 8080
# or: npm run preview
```

Open http://localhost:8080

Live polling needs the Cloudflare Pages Function (`/api/scores`). Locally you'll see static `matches.json` data unless you use `wrangler pages dev`.

## Updating the schedule

Edit `matches.json`, then sync the embedded fallback in `index.html` (or run `npm run sync` which rewrites both when scores change).

## Deploy

```bash
wrangler pages deploy . --project-name=fifa-match-calendar --branch=main
```

Static assets + `functions/` deploy together. No build command.
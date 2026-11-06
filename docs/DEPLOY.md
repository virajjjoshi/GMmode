# Deploying Trash Talk Live

The app is one Node process with no dependencies. It runs anywhere that runs Docker or Node 22. The steps below use Fly.io because it supports long-lived live-room connections and a persistent disk for the data files. Render and Railway work the same way: a Docker service, a persistent disk mounted at `/data`, and a health check on `/healthz`.

## First deploy (Fly.io)

Use the Fly account the app should belong to. `fly auth whoami` shows which one you're logged into.

```bash
fly launch --no-deploy --copy-config   # keeps fly.toml; pick a unique app name when asked
fly volumes create ttl_data --size 1 --region iad
fly secrets set SHARPSPORTS_PUBLIC_KEY=... SHARPSPORTS_PRIVATE_KEY=...   # optional, for real sportsbook linking
fly deploy
fly open
```

Custom domain: `fly certs add yourdomain.com`, then add the DNS records it prints.

## What's built in

| Area | What it does |
|---|---|
| **Health** | `GET /healthz` returns uptime, build hash, live-room counts and memory. The host uses it to restart a stuck instance. |
| **Deploys** | On SIGTERM the server stops taking requests, ends live-room streams (browsers reconnect by themselves), and writes every data file before exiting. Nothing posted in the last second is lost. |
| **Speed** | Static files are served from memory, Brotli/gzip-compressed, with ETags. JS and CSS URLs carry a build hash and are cached for a year. API JSON is gzipped (the scoreboard goes from 64 KB to 11 KB). ESPN responses are cached and shared across all users. |
| **Security** | Content-Security-Policy (no inline scripts), HSTS behind HTTPS, nosniff, no framing, a strict referrer policy. Per-IP API ceiling (`API_RATE_PER_MIN`, default 600/min) on top of the per-action limits. `TRUST_PROXY=1` makes those limits use the real client IP. |
| **App install** | Web app manifest, icons, and a service worker: it can be added to the home screen on iOS and Android and opens full-screen. Offline, it shows the app shell. The API is never cached, so scores are always live. |
| **Sharing** | Open Graph and Twitter card tags with a share image, so links look right in iMessage, Discord, X and Slack. |

## Environment

See [`.env.example`](../.env.example). In production you need `NODE_ENV=production`, `DATA_DIR` (a persistent disk) and `TRUST_PROXY=1` behind a proxy. Everything else is optional.

## How far this setup goes

This build is meant for a launch and the first few thousand fans. Its hard limits:

1. **Run exactly one instance.** Live rooms and rate limits live in memory, and data is written to JSON files on one disk. Two instances would split the rooms and overwrite each other's files.
2. **Expect roughly 2–4k fans in live rooms at once** on a 512 MB machine. Each live-room viewer holds one open connection. Scale up the machine (`fly scale vm shared-cpu-2x --memory 1024`) before scaling out.
3. **Data files grow forever.** Every save rewrites the whole file. That's fine for tens of thousands of takes; past that, move to Postgres.
4. **Identity is anonymous** (a random ID in the browser). Anyone who copies that ID can post as that fan, and clearing the browser loses the profile.
5. **ESPN's feed is unofficial.** It's fine for a beta, but use a licensed feed before charging money or running ads.

## Before scaling past one instance (the next engineering steps)

- [ ] **Accounts** (Clerk): sign in with Apple, Google or phone. Profiles, pick'em leagues and linked books follow the fan across devices.
- [ ] **Postgres** (Neon or Supabase) instead of the JSON files. The Prediction Leagues storage already has migrations to build from.
- [ ] **Redis** for live-room fan-out and shared rate limits, so more than one instance can run.
- [ ] **Error tracking** (Sentry) and **product analytics** (PostHog): daily actives, room joins, takes per game, retention.
- [ ] **Push notifications** (Web Push, then native): "your game is close", "your take is getting ratio'd", "picks lock in 1 hour". This is the biggest driver of fans coming back.
- [ ] **Moderation**: report and block, auto-hide heavily reported posts, and a mod role per room.
- [ ] **Legal pages**: terms, privacy policy, DMCA contact. Required before app stores or any sportsbook partnership.

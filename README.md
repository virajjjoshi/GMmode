# 🏟️ Trash Talk Live

Every score. Every stat. Zero chill.

Live scores for NFL, NCAAF, NBA, WNBA, NCAAM, MLB, NHL, EPL, MLS and the Champions League. Every game comes with jokes, a chaos meter, polls, emoji reactions and its own trash-talk thread.

## Run it

```bash
npm start        # http://localhost:4321
npm run dev      # same, restarts on file changes
```

There are no dependencies to install. You need Node 18 or newer. Set `PORT=xxxx` to use a different port.

## What's in it

- **Scoreboard of Chaos**: every league or just one, today or any date, filtered by Live, Upcoming or Final. Sort by "most chaotic" or "most takes". Live games refresh every 30s, and a score bumps when it changes.
- **Vibe badges and jokes**: NAIL-BITER, BLOWOUT, FUNERAL, UPSET ALERT, BONUS SPORTS (overtime), SNOOZEFEST, FIREWORKS. They're based on score margin, time left, team records and the sport (see `lib/humor.js`).
- **Chaos meter** (0–100): how close the game is, weighted by how late it is, plus bonuses for overtime and upsets.
- **Game page**: the intern's commentary, the Panic Graph (win probability), the line score, team stats side by side, top performers and key plays.
- **Who Ya Got?** poll: it closes at the final whistle. Right picks earn confetti and a spot on the Prophets board.
- **Reactions**: 🔥😂😭🤡🐐🧂💀🚀 with floating emoji.
- **Excuse Generator**: a fresh excuse for the losing team's fans, one tap to post it.
- **The Thread**: post takes rated Mild, Spicy or ☢️ Nuclear, use quick-take chips, reply, and vote 🔥 fire or 🧢 cap. Takes get tagged VERIFIED HOT or RATIO'D, and you can sort by Hot or New.
- **Hall of Takes**: the hottest takes ever, Take Masters, Prophets and the Clown Corner.
- **Anonymous identity**: a random funny name and an avatar, which you can change any time.

## How it works

- `server.js`: a plain Node HTTP server with the JSON API and static files.
- `lib/espn.js`: ESPN's public scoreboard and summary endpoints (no API key), with caching and stale-while-revalidate.
- `lib/humor.js`: the comedy department. Jokes are seeded per game and state, so they don't flicker on refresh.
- `lib/store.js`: takes, polls, reactions and results, stored in `data/db.json`.
- `public/`: the frontend, written in vanilla JS with no build step.

## Before putting it on the internet

- Identity is a random ID kept in the browser's localStorage. Add real auth (Clerk, as in Tyche Chat) before going public.
- Move from the JSON file to Postgres or SQLite once there's real traffic.
- Rate limits are per IP and kept in memory. Put a proxy or Redis in front for more than one instance.
- ESPN's API is unofficial and undocumented. For a commercial launch, switch to a licensed data feed.

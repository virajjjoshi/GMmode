# 🏟️ Trash Talk Live

Every score. Every stat. Zero chill.

Live scores for NFL, NCAAF, NBA, WNBA, NCAAM, MLB, NHL, EPL, MLS and the Champions League. Every game comes with jokes, a chaos meter, polls, emoji reactions and its own trash-talk thread.

## Run it

```bash
nvm use          # Node 22 (pinned in .nvmrc). Node 16 won't work
npm start        # http://localhost:4321
npm run dev      # same, restarts on file changes
```

There are no dependencies to install. You need Node 18 or newer. Set `PORT=xxxx` to use a different port. The plan is in [docs/ROADMAP.md](docs/ROADMAP.md).

**Production:** `docker build .` or `fly deploy`. [docs/DEPLOY.md](docs/DEPLOY.md) covers hosting, environment variables (see `.env.example`), health checks, and how far a single instance goes. The service worker is off on `localhost` so edits show up on refresh (add `?sw=1` to test it).

## What's in it

- **Scoreboard of Chaos**: every league or just one, today or any date, filtered by Live, Upcoming or Final, plus team search (press `/`). Every chip shows how many games you'll get. Filters live in the URL (e.g. `#/?league=nfl&status=in`), so filtered views can be shared, and a fresh visit always starts on everything. Sort by "most chaotic" or "most takes". Live games refresh every 30s, and a score bumps when it changes.
- **Game of the Night**: a spotlight on the hottest live game (or the next one up), with live counters across the top of Scores.
- **Vibe badges and jokes**: NAIL-BITER, BLOWOUT, FUNERAL, UPSET ALERT, BONUS SPORTS (overtime), SNOOZEFEST, FIREWORKS. They're based on score margin, time left, team records and the sport (see `lib/humor.js`).
- **Chaos meter** (0–100): how close the game is, weighted by how late it is, plus bonuses for overtime and upsets.
- **Game page**: the intern's commentary, the Panic Graph (win probability), the line score, team stats side by side, top performers and key plays.
- **Who Ya Got?** poll: it closes at the final whistle. Right picks earn confetti and a spot on the Prophets board.
- **Reactions**: 🔥😂😭🤡🐐🧂💀🚀 with floating emoji.
- **Excuse Generator**: a fresh excuse for the losing team's fans, one tap to post it.
- **The Thread**: post takes rated Mild, Spicy or ☢️ Nuclear, use quick-take chips, reply, and vote 🔥 fire or 🧢 cap. Takes get tagged VERIFIED HOT or RATIO'D, and you can sort by Hot or New.
- **Hall of Takes**: the hottest takes ever, Take Masters, Prophets and the Clown Corner.
- **Anonymous identity**: a random funny name and an avatar, which you can change any time.
- **Navigation**: Scores · Fantasy · Pick'em (Prediction Leagues) · Takes · Games · Hall of Takes. There's no separate Live or Bets tab: live rooms open from any live game card or the ticker (old `#/live` links land on the scoreboard's Live filter), and Bets lives inside Takes (old `#/bets/*` links redirect).
- **🗣️ Takes** (`#/takes`): one home for opinions and money. **Takes** shows the best takes from every game thread (Hot / New / Top, plus a 💸 "Money on it" filter for fans who shared a real bet), a composer that posts straight into a game's thread, and the threads heating up today. **Tail or Fade**, **My bets** and **Bad beats** are the betting sections (21+, see Bets below). One sport switcher filters all four, and it's in the URL (`#/takes/tailfade?sport=nba`). Bet legs link back to their game's thread.
- **🎮 Games** (`#/games`): perfect-season challenges built on real history. More below.
- **🔴 Live Rooms** (`#/live/<league>/<id>`, opened from game cards): the Twitch-style second screen. There's no video (TV rights), so the stage is a live scoreboard with down-and-distance, last play and win %. You get chat with slow mode and muting, reaction bursts across the stage, a hype meter, and big TOUCHDOWN/GOAL flashes. An Intern bot calls scores and lead changes. **The Call** ("who scores next?", or "who leads after the quarter?" for basketball) pays points, with a bonus for picks the crowd got wrong. Picks must be in 45s early, so nobody can snipe.
- **🏟️ Live field, per sport**: every live room draws the game as it happens.
  - 🏈 **Football:** the ball, line of scrimmage, first-down line, chains and drive. They slide as the chains move, and red-zone drives pulse.
  - 🏀 **Basketball:** a live shot chart (made ● / missed ✕) and a tip-off countdown.
  - ⚾ **Baseball:** a diamond with runners on base, balls/strikes/outs, batter vs pitcher and the pitch sequence.
  - 🏒 **Hockey:** a rink shot map with goals and shots on goal.
  - ⚽ **Soccer:** a pitch with possession and a timeline of goals and cards.
- **📋 Play-by-play you can follow**: a live feed with SCORE / TURNOVER / 3PT / HR / GOAL badges. Tap a play to see it on the field (the yardage arrow, or the shot itself). "Follow live" tracks the newest play.
- **🎬 Sport-specific moments**: big-screen overlays and Intern posts for TIP-OFF, KICKOFF, FIRST PITCH, PUCK DROP, RED ZONE, TURNOVER, TWO-MINUTE WARNING, FROM DOWNTOWN, CLUTCH TIME, GONE! (home run), K, BASES LOADED, FULL COUNT, POWER PLAY, YELLOW/RED CARD and PENALTY.
- **📊 Quick crowd polls**: they open automatically in the moment. "4th & 2: go for it, punt or kick?", "Bases loaded: strikeout, hit, grand slam or walk?", "Under 2:00, who closes it out?" Results update live, and the Intern announces the crowd's verdict.
- **📣 Hype Battle**: a tug-of-war between the two fan bases. Tap HYPE for your team and the meter moves toward them, then drifts back when the noise dies down.
- **🧪 Demo crowd**: a "Simulate a crowd" button in any live room adds 26 simulated fans who chat about the real game, react and make calls. Every simulated message and caller is tagged **SIM**, and they're counted separately from real viewers. It's for demos, so a room can be shown before it has real traffic.
- **✨ Tour** (`#/tour`): a "what we've built" page with live previews of every feature, the roadmap and the open decisions. Good for showing the project to someone new.
- **🧑‍🌾 Fantasy** (`#/fantasy`): connect a Sleeper username to see your live matchup, both lineups (with 🔴 LIVE links to the room for each player's game), the Fantasy Therapist, bench regret, standings, and every matchup around the league. Your starters are flagged on NFL game cards and in live rooms. ESPN and Yahoo are on the roadmap.

- **🎯 Prediction Leagues** (`#/predict`, between Fantasy and Hall of Takes): create or join pick'em leagues across any of the 10 leagues above, pick game winners, and compete on weekly leaderboards and season standings. More below.

## Prediction Leagues

- **Leagues**: public (listed in Discover) or private (invite code or link). Pick the sports, season dates and max members. The format is weekly rounds plus season standings, or season-long only. Advanced rules: every game counts or pick-your-games, what happens to missed picks, how standings ties work, whether picks can be changed, when others can see your picks, late joins, and who can invite.
- **Owners** can edit settings (sports, dates, format and scoring lock once the season starts), make, regenerate or turn off invites (with optional expiry and max uses), remove members, and archive the league.
- **Picks**: tap a team to make a draft. Drafts are kept on the device and clearly marked "Not submitted". You review them, then submit. Every pick is checked on the server against the provider's current game status and the scheduled start, so deadlines can't be bypassed from the browser. Soccer gets a Draw option.
- **Scoring**: Classic pick'em (1 point per correct winner). Canceled games aren't scored, postponed games count when actually played, and a tie in a sport without draws is a push. Standings are calculated from picks plus results every time they're shown, never stored as totals, so re-processing can't double-count, and a corrected result fixes every table. Every result change is logged in `resultLog`. Confidence scoring is modeled but not offered yet.
- **ESPN win probability**: ESPN's own pregame "Matchup Predictor", from the same public ESPN feed as the scores. It's matched to teams by ESPN team ID and stored with a timestamp. It's published for NFL, NCAAF, NBA, WNBA and MLB (checked Oct 2026), not for NHL, college basketball or soccer, which show "ESPN win probability unavailable". It never affects scoring, and sportsbook odds are never shown as ESPN data. Set `ESPN_WIN_PROB=off` to hide it.
- **Stats**: a personal record across all leagues (`#/predict/me`): by sport, by week, and streaks. League standings, which include misses, are shown separately.

Code: `lib/predict/` (`service.js` holds the rules, `scoring.js` the pure scoring, `sports.js` the sport differences, `source.js` the data-provider boundary, `routes.js` the `/api/pl/*` endpoints, `persist.js` the storage and migrations) and `public/predict.js`. Data lives in `data/predictions.json` (override with `PL_DATA_FILE`). Results refresh every 2 minutes for leagues in play (`PL_SYNC_MS`).

```bash
npm test         # business-rule tests (node:test, no dependencies)
npm run check    # syntax-check every JS file
```

## 🎮 Games: perfect-season challenges

Draft one player from each randomly generated historical team and season. After every selection, a new team and season are rolled automatically, and you get one manual reroll per draft. Then simulate a real schedule and chase the perfect record. Squad strength is real fantasy production: every player's fantasy points per game from that season, plus verified chemistry.

| Challenge | Seasons | Squad | Goal |
|---|---|---|---|
| The 17-0 Challenge (NFL) | 2002 to 2025 | QB, 2 RB, 2 WR, TE, Flex, K, D/ST | Win every game |
| The 82-0 Challenge (NBA) | 1995-96 to 2025-26 | 2 G, 2 F, C + 3 bench | Win every game |
| The 162-0 Challenge (MLB) | 2005 to 2025 | C, 1B, 2B, 3B, SS, 3 OF, DH, 4 SP, 2 RP | Win every game |
| The 82-0 Ice Challenge (NHL) | 1995-96 to 2025-26 (not 2004-05) | 6 F, 4 D, G | Win every game (ties, OT and shootout losses count against you) |
| The Invincibles Challenge (Premier League) | 2003-04 to 2025-26 | GK, 4 DEF, 3 MID, 3 FWD | Finish unbeaten |

- **Real data only.** Rosters and stats are summed from that season's ESPN box scores (the same free public feed as the scoreboard), so a player is in the pool only if he played for that team that season, with only his games for them. Seasons without player box scores are left out rather than filled in. Rolls, squad checks (no duplicates, no other rosters, positions must fit) and the simulation all happen on the server.
- **Fantasy PPG.** One fixed fantasy formula per sport (by position where the sport scores positions differently), applied to each player's stats from the rolled season and divided by the games he actually played. Only stat categories ESPN recorded in every covered season are scored, so eras are scored alike.
- **Chemistry.** Verified connections between drafted players add a small bonus, paid in fantasy PPG: same college, former teammates (same franchise, same earlier season) and, in soccer, the same national team in the same competition. All from ESPN athlete records. Capped so it never outweighs production.
- **Fair across sports and eras.** Combined PPG is era-adjusted and placed among thousands of comparable rosters from the same sport's real history. That percentile drives the simulation. It's never compared with other sports or with a fixed target, and the internal numbers aren't shown.
- **The flow:** Draft one player per random team-season (real PPG, college and chemistry links on every player, combined PPG updating live; one manual reroll; the server keeps the draft, so a refresh resumes) → Review (PPG and chemistry per pick, every link explained, projected record) → Lock in & simulate (game by game, real opponents in real order) → Results (record, win %, streaks, game log vs. the real results, fantasy production, chemistry contribution, MVP, weakest link, closest games, best performances). Then run it back (a new season every time), rebuild the squad (a fresh draft), start a new draft, compare any two seasons, or share a result link. The squad plays the real schedule of the team-season its first pick came from.
- **The model** (`lib/games/sim.js` and `lib/games/norms.js`, explained in [docs/GAMES.md](docs/GAMES.md)) is calibrated on real seasons with `npm run calibrate-games`, which writes `lib/games/norms.json`.
- Code: `lib/games/` (`sports.js` the rules, `history.js` the data provider and cache, `parse.js` box scores, `fantasy.js` scoring, `pool.js` the draftable pool, `chemistry.js` connections, `norms.js` normalization, `squad.js` squad rules, `sim.js` the simulator, `service.js` the challenge lifecycle, `index.js` the `/api/games/*` routes) and `public/games.js`. Attempts live in `data/games.json` (`GAMES_DATA_FILE`). Historical team-seasons are cached in `data/games-history/` after the first fetch. The cache is optional: a fresh install fetches what it needs.

## 💸 Bets

The betting sections of Takes (`#/takes/mybets`, `#/takes/tailfade`, `#/takes/badbeats`), 21+ only. Link a sportsbook and the app tracks your bets live. It's read-only: we never take, place, or hold bets, and bets are private unless you share one.

- **Linking**: real accounts (DraftKings, FanDuel, BetMGM, Caesars and 30+ more) go through [SharpSports](https://docs.sharpsports.io), which works like Plaid for sportsbooks. The bettor logs in on SharpSports' page, so we never see a sportsbook password. Set `SHARPSPORTS_PUBLIC_KEY` and `SHARPSPORTS_PRIVATE_KEY` to switch it on. Until then the book buttons are disabled.
- **Demo Book**: a clearly labelled pretend sportsbook so the section works today. Open bets are on today's real games at real pregame lines from ESPN (DraftKings via ESPN). Settled history uses real final scores with generated lines, including a couple of guaranteed bad beats. Tail or Fade and the Hall of Fame are seeded with a few simulated fans, tagged SIM.
- **🫠 My Sweat**: record, net, ROI, open action, the Bet Therapist, and every bet with a live Sweat Meter (chance to cash), a light per parlay leg, and a 🚨 ONE LEG AWAY alert.
- **Everywhere else**: game cards show your action on that game, live rooms get a "Your Action" panel (only you see either), and takes from someone who shared a bet on that game get a 💸 PUT MONEY ON IT badge.
- **🗳️ Tail or Fade**: share a bet, the crowd votes. Fade scores show how betting against each sharer would have gone, and Crowd Callers ranks who votes right.
- **🪦 Bad Beat Hall of Fame**: lost by the hook, or a 3+ leg parlay that died on one leg. Victims submit their own.

Code: `lib/bets/` (`track.js` the pure live math and bad-beat rules, `demo.js` the Demo Book, `sharpsports.js` the real provider, `service.js` accounts/sharing/votes, `roast.js` the jokes, `index.js` the `/api/bets/*` routes) and `public/bets.js`. Data lives in `data/bets.json` (override with `BETS_DATA_FILE`). The Sweat Meter is a simple model (score margin vs. time left), not a betting model. ESPN drops lines once a game ends, so the server keeps a copy of each game's last pregame line.

## How it works

- `server.js`: a plain Node HTTP server with the JSON API and static files.
- `lib/espn.js`: ESPN's public scoreboard and summary endpoints (no API key), with caching and stale-while-revalidate.
- `lib/humor.js`: the comedy department. Jokes are seeded per game and state, so they don't flicker on refresh.
- `lib/store.js`: takes, polls, reactions and results, stored in `data/db.json`.
- `lib/live.js`: Live Rooms over Server-Sent Events. Polls ESPN every 10s only while someone is watching. Room state is kept in memory.
- `lib/fantasy.js`: the Sleeper API, plus a slimmed player directory cached in `data/` for a day.
- `lib/field.js`: turns ESPN's raw feeds into a per-sport "field state" (ball spot, shot coordinates, runners, events) and a play-by-play feed. `public/field.js` draws it as SVG, built once and updated in place so things animate.
- `public/`: the frontend, written in vanilla JS with no build step. `app.js` handles scores, games and the Hall, `live.js` the live rooms, `fantasy.js` fantasy, `takes.js` the Takes hub (it hosts `bets.js`), `games.js` the Games challenges, and `tour.js` the tour page.
- `lib/games/`: the Games feature (see below).

## Before putting it on the internet

Done: security headers and CSP, compression and long-lived caching, `/healthz`, a graceful shutdown that saves all data, per-IP rate limits behind a proxy (`TRUST_PROXY=1`), an installable app (manifest + service worker), share cards, and a Dockerfile plus `fly.toml`. Still to do:


- Identity is a random ID kept in the browser's localStorage. Add real auth (Clerk, as in Tyche Chat) before going public.
- Move from the JSON file to Postgres or SQLite once there's real traffic.
- Rate limits, live chat and calls are kept in memory, so a restart clears live rooms. Running more than one instance needs Redis pub/sub (see the roadmap).
- Live room streams pass the fan ID in the URL (EventSource can't send headers). That's fine for anonymous IDs, but switch to cookie auth when real accounts arrive.
- ESPN's API is unofficial and undocumented. For a commercial launch, switch to a licensed data feed. Prediction Leagues already goes through one adapter (`lib/predict/source.js`), so a licensed feed only means writing one new file. Win probabilities need a provider that actually licenses ESPN's numbers, or a relabel to that provider's own model.
- Prediction Leagues trusts the same anonymous fan ID as everything else. Anyone who copies someone's ID from their browser can act as them, including a league owner. Real accounts fix that.

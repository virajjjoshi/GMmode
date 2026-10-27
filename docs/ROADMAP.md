# Trash Talk Live: roadmap

What we're building, in what order, and the decisions still open.

## The pitch

**The second screen for sports fans.** Keep the game on your TV. Trash Talk Live is the couch: live scores, a funny take on every game, a live room where fans react together, fantasy teams wired in, and prediction games that give you bragging rights.

## Where we are

| Version | What shipped |
|---|---|
| v0.1 | Scores for 10 leagues, vibe badges, chaos meter, intern commentary, a thread per game, polls, reactions, Hall of Takes |
| **v0.2 (this build)** | **Live Rooms** (Twitch-style chat, reaction bursts, hype meter, "Who scores next?" calls, play-by-play bot). **Fantasy** (connect Sleeper, live matchup, Fantasy Therapist, bench regret, your players flagged on game cards and in live rooms, trash-talk thread per league) |
| v0.2.1 | Filter fixes (state in the URL, live counts, clear button, team search), Game of the Night spotlight, Tour page, labeled demo crowd for live rooms |

## Pillars

1. **Scores + humor.** Already strong. Next: AI-written roasts and recaps (Claude), shareable roast cards.
2. **Community.** Threads and Hall of Takes are done. Next: profiles, follows, mentions, notifications.
3. **Live Rooms.** The core engagement loop: chat, reactions and calls while the game is on.
4. **Fantasy.** The reason people open the app every Sunday.
5. **Predictions and games.** Calls, polls and streaks feed leaderboards. Keep it free-to-play (see Legal).

## About live video

We **can't stream the game itself**. NFL, NBA, MLB and the other leagues sell those rights to broadcasters, and rebroadcasting gets the app taken down. User-pasted "stream links" are a piracy magnet, so we won't allow them either.

What we can do, from easiest to hardest:

| Option | What it is | Effort |
|---|---|---|
| **Second screen** (built) | A live tracker, play-by-play, chat and reactions synced to the game. Users watch on TV. | Done |
| **Creator co-streams** | Approved creators embed *their own* Twitch or YouTube stream (their face and commentary, not game footage) into the room. Twitch and YouTube embeds are allowed. | Medium: needs a creator approval flow |
| **Voice rooms** | Clubhouse-style live audio of fans talking during the game, using LiveKit or Agora. | Medium–high |
| **Licensed highlights** | Official clips through a deal with the league or a provider (e.g. WSC Sports). | Business deal |

## Fantasy integrations

| Platform | Access | Status |
|---|---|---|
| **Sleeper** | Public read-only API, only needs a username | **Built** |
| **ESPN** | Unofficial API. Public leagues are open; private leagues need the user's `espn_s2` + `SWID` cookies | Next. Needs careful UX and secure cookie storage |
| **Yahoo** | Official OAuth 2.0 Fantasy API. Register an app at developer.yahoo.com | Next. Clean, but needs real accounts first |
| NFL.com / CBS | No usable public API | Skip for now |

## Phases

### Phase 2: launch-ready (do before inviting strangers)

- [ ] **Accounts.** Clerk (already used in Tyche Chat) replaces the localStorage ID. Users keep a name, avatar and fantasy links across devices.
- [ ] **Database.** Postgres (Supabase or Neon) replaces `data/db.json`. Tables: users, takes, votes, polls, reactions, live_messages, calls, fantasy_links.
- [ ] **Realtime at scale.** Live Rooms use SSE from a single server. For more than one instance, add Redis pub/sub, or move to a managed service (Ably or Pusher).
- [ ] **Moderation.** Report and block, mod roles per room, auto-hiding of heavily reported messages, an AI moderation pass on takes, and shadow-banning of spam.
- [ ] **Hosting.** Fly.io or Render behind a custom domain, with HTTPS and a CDN for static files.
- [ ] **Data feed.** ESPN's API is unofficial. Before charging money or running ads, move to a licensed feed (Sportradar, SportsDataIO or MySportsFeeds).
- [ ] **Legal.** Terms of service, privacy policy, a DMCA contact, age gating (13+ for community, 18/21+ for anything betting-adjacent), and a rule against impersonating athletes.
- [ ] **Analytics.** PostHog or Plausible to track DAU, room joins, takes per game and fantasy connections.

### Phase 3: growth

- [ ] Mobile app (Expo/React Native, or start with a PWA), with push notifications for "your player just scored", "your game is close" and "someone ratio'd your take".
- [ ] Private rooms for fantasy leagues and friend groups (invite links).
- [ ] Creator co-streams in Live Rooms.
- [ ] Claude-written roasts, recaps and a "Roast my lineup" feature.
- [ ] Tyche AI picks surfaced inside game pages (link out to Tyche Chat).
- [ ] Streaks, badges and season-long leaderboards for callers and prophets.

## Making money (later)

Free core app. Options: ads on game pages, a "Trash Talk+" subscription (custom flair, private rooms, AI roasts, ad-free), creator revenue share, and sportsbook affiliate links. Affiliate links come with heavy legal and age-gating requirements, so only add them after Phase 2 is done.

## Open decisions

1. **Name and domain.** "Trash Talk Live" or "GMmode"?
2. **Accounts first, or fantasy breadth (ESPN/Yahoo) first?** Recommended: accounts first. Yahoo OAuth and saved ESPN cookies both need real accounts anyway.
3. **Web first, or mobile first?** Recommended: web/PWA until Live Rooms prove people come back.
4. **Betting-adjacent features?** Recommended: keep it free-to-play until legal is sorted. Tyche Chat is the place for picks.

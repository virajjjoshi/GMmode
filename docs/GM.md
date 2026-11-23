# GM Mode: how it works

Take over any MLB team as it stands **today**, run its offseason, then simulate next season. It lives at `#/games/gm` (linked from the top of the Games page).

## Data (`lib/office/mlb.js`)

Everything comes from MLB's public Stats API (`statsapi.mlb.com`, no key):

| What | Endpoint | Notes |
|---|---|---|
| Teams, leagues, divisions | `/teams?sportId=1` | 30 teams |
| Current 40-man rosters | `/teams/<id>/roster?rosterType=40Man` | ~1,150 players |
| This offseason's transactions | `/transactions?sportId=1&startDate=…` | since Sep 28 of the season just played |
| Players + two seasons of stats | `/people?personIds=…&hydrate=stats(…season=Y)` | 100 per request |

- **Free agents** aren't a list MLB publishes (its `freeAgents` endpoint only shows players who already signed). We walk this offseason's transactions in order: a player who declared free agency, elected it, or was released is a free agent, unless a later transaction signed, traded, claimed or selected him, or he is on a 40-man roster now. Only players with real big-league time in the last two seasons are kept (100+ PA or 20+ IP).
- **Real moves feed:** big-league signings and trades this offseason (minor-league deals are left out).
- **Snapshots:** each build is written to `DATA_DIR/office/mlb-<date>.json`. A new one is built at most every 6 hours (`GM_REFRESH_MS`). If MLB is down, the last good snapshot keeps serving. **A save pins the snapshot it started from**, so its league never changes underneath it; new saves use the newest one. Unused snapshots older than two weeks are deleted.

## The model (`lib/office/model.js`)

All numbers are **estimates** and the UI says so.

- **WAR from public stats.**
  - Hitters: OPS against a .620 replacement level, scaled so a .900 OPS everyday player is about 6 WAR, plus a position adjustment (C +1.1 … DH −1.4 per 650 PA) and a little for steals.
  - Pitchers: runs allowed are half ERA and half FIP, measured against replacement levels of 5.30 (starters) and 4.70 (relievers), plus a small bonus for saves.
- **Projection for next season.**
  - Two seasons are weighted 3:2 by recency and playing time, then pulled toward a modest baseline when the sample is small, so a hot 60 PA doesn't make a star.
  - Age adjustment: +0.5 WAR at 24 and under, down to −0.85 at 35 and up.
  - Players with no MLB track record get a prospect floor.
- **OVR** is a 35–99 display rating: 50 + 6.5 × projected WAR.
- **Contracts.** Real salaries aren't in any free feed, so:
  - Pre-arbitration (under 3 years of service, measured from the debut date) earn the minimum ($0.78M).
  - Arbitration years 3–5 earn 20 / 33 / 50% of their market value.
  - Veterans are priced from their recent peak at about $9M per WAR, capped at $45M.
- **Free-agent asks.** Years go by age (7 at 27 and under, down to 1 at 36+). The yearly price is projected WAR × $9M, with a premium on long deals.
- **Will he sign?** (`judgeOffer`) Players value guaranteed money, so short deals for players 29 and older are discounted. Teams projected for 90+ wins get a ~5% discount; teams under 70 pay ~7% more. Each lowball makes his camp a bit less patient.
  - At 100% of his ask (after those adjustments) he signs.
  - At 80% or more, his agent counters. **A counter is binding:** meeting it signs him.
  - Below 80%, he says no.
- **Budgets.** Estimated payroll plus room by market size: $32M for big markets, $20M mid, $12M small. You can't go over budget. Releasing a player keeps this season's salary on the books as dead money.
- **Depth chart and wins.**
  - Positions are filled from scarcest to most common. A shortstop can cover second or third, and anyone can play first base or DH; a player out of position costs a win.
  - Lineup of 9 plus 4 bench players at 20%, a rotation of 5 (relievers stretch out if short), and a bullpen of 8.
  - Team WAR becomes projected wins centred on 81, so only the gaps between teams matter.
- **Trades.**
  - Surplus value: WAR × $9M minus salary, over up to four controlled years, discounted 10% a year, with aging applied.
  - Prospects carry upside value.
  - Contenders (86+ projected wins) add value for this year's WAR and won't move their top two players. Rebuilding teams (75 or fewer) discount veterans 31 and older and pay extra for players 26 and under.
  - The AI wants to win the trade by $1.5M or 5%, whichever is more.
  - Budgets and 40-man limits apply to both sides.
  - When it says no, it names the cheapest player of yours that closes the gap.
- **The calendar.** 12 offseason weeks. "Advance a week" lets the other 29 teams sign free agents: role players go fast, stars wait a few weeks, and teams with money and a need move first. Opening Day closes the market.
- **Season sim.**
  - A real-format 162-game schedule: 13 games against each division rival, 6 or 7 against the rest of the league, and 3 against each interleague team (4 against the natural rival).
  - Each game is decided by log5 from the two teams' projected win percentages.
  - Then the 12-team postseason: byes for the top two seeds, a best-of-3 Wild Card round, best-of-5 Division Series, and best-of-7 Championship Series and World Series.
  - Every simulation is a fresh season, so luck matters.

## API (`lib/office/index.js`)

`GET /api/office/config` · `GET|POST /api/office/saves` (`{team}`) · `GET /api/office/saves/:id` · `GET …/teams/:team` · `POST …/sign {playerId, aav, years}` · `POST …/release {playerId}` · `POST …/trade {partner, give[], get[], execute}` (with `execute: false` it only asks) · `POST …/advance` · `POST …/simulate` · `GET …/sims/:n` · `DELETE …/saves/:id`. Saves live in `DATA_DIR/gm.json` (`GM_DATA_FILE`); six per fan.

Tests: `test/office.test.js` (model and save logic on a fake league, no network).

## Ideas for later

- Other sports' offseasons (NBA trade deadline, NFL free agency), using the same model shape.
- Real contracts from a licensed feed, which would replace every "est." in the UI.
- Arbitration hearings, the Rule 5 draft, and AI-to-AI trades.
- Share your season ("I took the Reds to a title").

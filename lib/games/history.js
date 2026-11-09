// Games: historical rosters and stats, compiled from ESPN's public API (the
// same free, keyless feed the scoreboard uses). This is the data-provider
// boundary for the Games feature: swapping in a licensed historical feed means
// re-implementing standings() and teamSeason() and nothing else.
//
// How a team-season is built (nothing is invented):
//   1. standings(season)      -> which teams existed, their real records and
//                                points for/against (opponent strength).
//   2. team schedule(season)  -> the real regular-season games, in order.
//   3. every game's summary   -> box scores. Only players who appeared for this
//                                team in those games enter the pool, with their
//                                stats summed from those games alone (so a
//                                traded player only counts his games here).
//   4. NFL only: each player's position from ESPN's season-scoped athlete record.
//   5. Chemistry facts for every player: college (ESPN athlete record), every
//      franchise and season he played before this one (ESPN statistics log),
//      and, for soccer, national-team appearances (ESPN marks national teams).
// Results are cached on disk (historical seasons don't change) under
// DATA_DIR/games-history/, so each team-season is fetched once.

const fs = require('node:fs');
const path = require('node:path');
const { SPORTS } = require('./sports');
const parse = require('./parse');
const pool = require('./pool');
const chemistry = require('./chemistry');

const SITE = 'https://site.api.espn.com/apis/site/v2/sports';
const STANDINGS = 'https://site.api.espn.com/apis/v2/sports';
const CORE = 'https://sports.core.api.espn.com/v2/sports';
const SCHEMA = 8; // bump when the cached team-season shape changes (8: duplicates by start time; 7: fantasy stats + chemistry bios)
// Per-sport bumps, so one sport's change doesn't re-download every other sport.
const SPORT_SCHEMA = { nfl: 9 }; // nfl 9 = base 8 + team D/ST from the box scores
const ver = (key) => SPORT_SCHEMA[key] || SCHEMA;
const COLLEGES = 'http://sports.core.api.espn.com/v2/colleges';
// International competitions: a team here is a national-team candidate, then
// confirmed by ESPN's own isNational flag before it counts.
const INTL = /^(fifa\.(world|friendly|confederations|olympics)|uefa\.(euro|nations)|conmebol\.america|concacaf\.(gold|nations)|caf\.nations|afc\.asian)/;
// Leagues whose seasons are a calendar year (label 2013, not 2013-14).
const CALENDAR = /^(usa|bra|arg|jpn|chn|kor|swe|nor|fin|mex\.|col|chi|uru|per|ecu|par|irl|rus\.2)/;
const refId = (ref, what) => String(ref || '').match(new RegExp(`/${what}/([^/?]+)`))?.[1] || null;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// null = ESPN genuinely has nothing (404). Anything else that goes wrong
// (timeouts, 429 rate limits, 5xx, bad JSON) throws after three tries, so the
// caller can tell "missing" from "failed" and never caches a failed fetch.
async function defaultFetch(url) {
  let last;
  for (let i = 0; i < 3; i++) {
    if (i) await wait(Math.min(4000, 400 * 2 ** i));
    try {
      const res = await fetch(url, { headers: { 'user-agent': 'trash-talk-live/0.1 (games)' }, signal: AbortSignal.timeout(12000) });
      if (res.status === 404) return null;
      if (!res.ok) {
        const ra = Number(res.headers.get('retry-after'));
        if (res.status === 429 && ra > 0 && ra <= 5) await wait(ra * 1000);
        throw new Error(`ESPN ${res.status}`);
      }
      return await res.json();
    } catch (e) { last = e; }
  }
  throw last;
}

// Runs fn over items n at a time. Failures are counted, not swallowed.
async function run(items, n, fn) {
  const out = new Array(items.length);
  const failed = new Set();
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k).catch(() => { failed.add(k); return null; }); }
  }));
  out.failed = failed; // indices whose fetch failed (as opposed to a 404 null)
  return out;
}

const tidy = (s) => (s == null ? s : String(s).replace(/\s+/g, ' ').trim()); // ESPN pads some old names
const stat = (entry, ...names) => {
  for (const n of names) {
    const s = (entry.stats || []).find((x) => x.name === n || x.type === n);
    if (s && Number.isFinite(Number(s.value))) return Number(s.value);
  }
  return null;
};

function createHistory({ fetchJson = defaultFetch, cacheDir = null, concurrency = 8 } = {}) {
  const mem = new Map();
  const inflight = new Map();

  const file = (name) => (cacheDir ? path.join(cacheDir, name) : null);
  function readCache(name) {
    if (mem.has(name)) return mem.get(name);
    const f = file(name); if (!f) return null;
    try {
      const d = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (d.schema !== ver(name.split('-')[0]) || d.partial) return null;
      mem.set(name, d); return d;
    } catch { return null; }
  }
  function writeCache(name, d) {
    mem.set(name, d);
    if (mem.size > 200) mem.delete(mem.keys().next().value);
    const f = file(name); if (!f) return;
    try { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(`${f}.tmp`, JSON.stringify(d)); fs.renameSync(`${f}.tmp`, f); }
    catch (e) { console.error(`[games] cache write failed: ${e.message}`); }
  }
  function once(name, build) {
    const hit = readCache(name); if (hit) return Promise.resolve(hit);
    if (inflight.has(name)) return inflight.get(name);
    // A partial build (some upstream fetch failed) is served once but never
    // cached, so the next request tries again instead of keeping the gap forever.
    const p = build().then((d) => { if (!d.partial) writeCache(name, d); return d; }).finally(() => inflight.delete(name));
    inflight.set(name, p);
    return p;
  }

  // A tiny cached lookup (college names, national-team flags, team names).
  function lookup(name, url, pick) {
    return once(name, async () => {
      const d = await fetchJson(url);
      return { schema: SCHEMA, ...(d ? pick(d) : { missing: true }) };
    });
  }

  // College, past franchises and national-team appearances for each player.
  // A failed fetch counts toward failed.bios (so the season isn't cached); a
  // 404 just means ESPN has no history for him (log: false), never invented.
  async function chemistryFacts(key, season, ids, colleges, failed) {
    const s = SPORTS[key];
    const [sp, lg] = s.espn.split('/');
    const bios = {};
    const got = await run(ids, concurrency, async (id) => {
      const url = s.sport === 'soccer' ? `${CORE}/soccer/athletes/${id}/statisticslog` : `${CORE}/${sp}/leagues/${lg}/athletes/${id}/statisticslog`;
      const log = await fetchJson(url);
      const past = new Map(), natCand = [];
      for (const e of log?.entries || []) {
        const league = refId(e.season?.$ref, 'leagues') || lg;
        const yr = Number(refId(e.season?.$ref, 'seasons'));
        if (!yr) continue;
        for (const st of e.statistics || []) {
          const t = refId(st.team?.$ref, 'teams');
          if (!t) continue;
          if (s.sport === 'soccer' && INTL.test(league)) { if (yr <= season) natCand.push({ c: league, s: yr, t }); }
          else if (yr < season) past.set(`${yr}|${t}`, { s: yr, t, lg: league });
        }
      }
      bios[id] = { college: colleges[id] ? { id: colleges[id] } : null, past: [...past.values()], nat: natCand, log: !!log };
    });
    failed.bios += got.failed.size;
    // College names, once per college.
    const cids = [...new Set(Object.values(bios).map((b) => b.college?.id).filter(Boolean))];
    const cg = await run(cids, concurrency, async (cid) => {
      const c = await lookup(`college-${cid}.json`, `${COLLEGES}/${cid}`, (d) => ({ name: tidy(d.name || d.shortName) }));
      for (const b of Object.values(bios)) if (b.college?.id === cid) b.college.name = c.name || null;
    });
    failed.bios += cg.failed.size;
    // National teams: keep only teams ESPN flags isNational.
    if (s.sport === 'soccer') {
      const tids = [...new Set(Object.values(bios).flatMap((b) => b.nat.map((x) => x.t)))];
      const flags = {};
      const ng = await run(tids, concurrency, async (tid) => {
        flags[tid] = await lookup(`soccer-team-${tid}.json`, `${CORE}/soccer/teams/${tid}`, (d) => ({ name: tidy(d.displayName), national: d.isNational === true }));
      });
      failed.bios += ng.failed.size;
      for (const b of Object.values(bios)) b.nat = b.nat.filter((x) => flags[x.t]?.national);
      bios._natNames = Object.fromEntries(Object.entries(flags).filter(([, v]) => v.national).map(([k, v]) => [k, v.name]));
    }
    return bios;
  }

  // Period-correct names ("2005 Seattle SuperSonics") for team-seasons that at
  // least two players in this pool shared, so links can say where.
  async function linkNames(key, season, bios, failed) {
    const s = SPORTS[key];
    const [sp] = s.espn.split('/');
    const nat = bios._natNames || {};
    delete bios._natNames;
    const count = new Map();
    for (const b of Object.values(bios)) for (const x of b.past) { const k = `${x.s}|${x.t}`; const c = count.get(k); count.set(k, c ? { ...c, n: c.n + 1 } : { ...x, n: 1 }); }
    const shared = [...count.entries()].filter(([, v]) => v.n >= 2);
    const teams = {};
    const got = await run(shared, concurrency, async ([k, v]) => {
      const d = await fetchJson(`${CORE}/${sp}/leagues/${v.lg}/seasons/${v.s}/teams/${v.t}`);
      if (d) teams[k] = tidy(d.displayName || d.name);
    });
    failed.bios += got.failed.size;
    return { teams, nat };
  }

  // Every team in a season, with its real record and scoring.
  function standings(key, season) {
    const s = SPORTS[key];
    return once(`${key}-${season}-standings.json`, async () => {
      const raw = await fetchJson(`${STANDINGS}/${s.espn}/standings?season=${season}`);
      const entries = [];
      (function walk(o) { if (o?.standings?.entries) entries.push(...o.standings.entries); (o?.children || []).forEach(walk); })(raw);
      const teams = entries.map((e) => {
        const w = stat(e, 'wins') ?? 0, l = stat(e, 'losses') ?? 0, t = stat(e, 'ties') ?? 0, otl = stat(e, 'otLosses', 'overtimeLosses') ?? 0;
        const gp = stat(e, 'gamesPlayed') || w + l + t + otl;
        const pf = stat(e, 'pointsFor') ?? (stat(e, 'avgPointsFor') ?? 0) * gp;
        const pa = stat(e, 'pointsAgainst') ?? (stat(e, 'avgPointsAgainst') ?? 0) * gp;
        return {
          id: String(e.team?.id), name: tidy(e.team?.displayName), abbr: e.team?.abbreviation, logo: e.team?.logos?.[0]?.href || null,
          w, l, t, otl, gp, pf, pa,
        };
      }).filter((x) => x.id && x.gp > 0);
      if (teams.length < 10) throw new Error(`No standings for ${s.label} ${s.seasonLabel(season)}`);
      const avgFor = teams.reduce((a, x) => a + x.pf / x.gp, 0) / teams.length;
      return { schema: ver(key), sport: key, season, teams, avgFor };
    });
  }

  function rawSeason(key, season, teamId) {
    const s = SPORTS[key];
    return once(`${key}-${season}-${teamId}.json`, async () => {
      const st = await standings(key, season);
      const me = st.teams.find((x) => x.id === String(teamId));
      if (!me) throw new Error('That team didn\'t play that season.');
      const sched = await fetchJson(`${SITE}/${s.espn}/teams/${teamId}/schedule?season=${season}`);
      const events = (sched?.events || []).filter((e) => {
        if (s.sport !== 'soccer' && e.seasonType && Number(e.seasonType.type) !== 2) return false;
        // Only games that were actually played (postponed ones also read "post").
        const ty = e.competitions?.[0]?.status?.type || {};
        return ty.completed === true || (ty.completed === undefined && ty.state === 'post' && !/POSTPON|CANCEL|SUSPEND/i.test(ty.name || ''));
      });
      const seen = new Set();
      const listed = events.filter((e) => !seen.has(e.id) && seen.add(e.id)).map((e) => {
        const c = e.competitions[0];
        const us = c.competitors.find((x) => String(x.team?.id ?? x.id) === String(teamId));
        const them = c.competitors.find((x) => x !== us);
        const score = (x) => Number(x?.score?.value ?? x?.score?.displayValue ?? x?.score ?? 0);
        const o = st.teams.find((x) => x.id === String(them?.team?.id ?? them?.id));
        return {
          id: String(e.id), date: e.date, home: us?.homeAway === 'home',
          opp: { id: String(them?.team?.id ?? them?.id ?? ''), abbr: them?.team?.abbreviation || o?.abbr || '?', name: tidy(them?.team?.displayName) || o?.name || 'Opponent', logo: them?.team?.logos?.[0]?.href || them?.team?.logo || o?.logo || null },
          real: { us: score(us), them: score(them) },
        };
      }).filter((g) => g.opp.id);
      // ESPN sometimes lists one game twice under two ids: a second copy at the
      // same start time with a wrong venue and score (every Fulham 2009-10
      // match), an exact copy (2003 Tigers vs. Rays, May 3), or a 0-0 "final"
      // stub (1999-00 Nets at Bulls). Copies share the opponent and start
      // within minutes; real doubleheaders are 3+ hours apart and home-and-home
      // games about a day apart, so listings vs. the same opponent starting
      // within 2 hours are one game. Keep the copy whose box score really
      // parses, then a non-0-0 score. Summaries are fetched first and only the
      // kept games are parsed, so a bogus copy can never add stats.
      const sums = await run(listed, concurrency, (g) => fetchJson(`${SITE}/${s.espn}/summary?event=${g.id}`));
      const parses = listed.map((g, i) => !!sums[i] && !!parse.addGame(s.sport, parse.newAcc(), sums[i], teamId, g.id, g));
      const byOpp = new Map();
      listed.forEach((g, i) => {
        if (!byOpp.has(g.opp.id)) byOpp.set(g.opp.id, []);
        byOpp.get(g.opp.id).push({ g, i, t: Date.parse(g.date), ok: parses[i], scored: g.real.us + g.real.them > 0 });
      });
      let groups = [];
      for (const list of byOpp.values()) {
        list.sort((a, b) => a.t - b.t);
        let cur = null;
        for (const x of list) {
          if (cur && Number.isFinite(x.t) && x.t - cur[0].t < 2 * 3600e3) cur.push(x);
          else { cur = [x]; groups.push(cur); }
        }
      }
      // A 0-0 "final" with no player lines is a placeholder, not a game (real
      // 0-0 soccer draws and old NHL ties have box scores), wherever it sits.
      groups = groups.map((grp) => grp.filter((x) => x.scored || x.ok || sums.failed.has(x.i))).filter((grp) => grp.length);
      const kept = groups.map((grp) => [...grp].sort((x, y) => (y.ok - x.ok) || (y.scored - x.scored) || (x.i - y.i))[0]);
      kept.sort((x, y) => new Date(x.g.date) - new Date(y.g.date));
      const games = kept.map((x) => x.g);
      if (games.length < 10) throw new Error(`ESPN has no schedule for that ${s.label} season.`);

      const acc = parse.newAcc();
      for (const x of kept) if (sums[x.i]) parse.addGame(s.sport, acc, sums[x.i], teamId, x.g.id, x.g);
      // Box scores that failed to download (not ones ESPN simply doesn't have).
      const failed = { boxScores: kept.filter((x) => sums.failed.has(x.i)).length, positions: 0, bios: 0 };

      // NFL box scores don't carry positions; ESPN's season-scoped athlete
      // record does (and its college). Other sports: the athlete record has the college.
      const positions = {}, colleges = {};
      const [sp, lg] = s.espn.split('/');
      const ids = Object.keys(acc.players);
      if (key === 'nfl') {
        const got = await run(ids, concurrency, async (id) => {
          const a = await fetchJson(`${CORE}/football/leagues/nfl/seasons/${season}/athletes/${id}`);
          if (a?.position?.abbreviation) positions[id] = a.position.abbreviation;
          if (a) colleges[id] = refId(a.college?.$ref, 'colleges');
        });
        failed.positions = got.failed.size;
      } else if (s.sport !== 'soccer') {
        const got = await run(ids, concurrency, async (id) => {
          const a = await fetchJson(`${CORE}/${sp}/leagues/${lg}/athletes/${id}`);
          if (a) colleges[id] = refId(a.college?.$ref, 'colleges');
        });
        failed.bios += got.failed.size;
      }
      const bios = await chemistryFacts(key, season, ids, colleges, failed);
      const names = await linkNames(key, season, bios, failed);

      const opp = {};
      for (const t of st.teams) opp[t.id] = { off: (t.pf / t.gp) / st.avgFor, def: (t.pa / t.gp) / st.avgFor, w: t.w, l: t.l, t: t.t, otl: t.otl };
      const info = acc.info ? { ...acc.info, name: tidy(acc.info.name) || me.name } : { id: String(teamId), name: me.name, abbr: me.abbr, logo: me.logo, color: null };
      // Cache raw season totals, not fantasy points, so scoring formulas can change
      // without re-downloading every box score.
      return {
        schema: ver(key), sport: key, season, seasonLabel: s.seasonLabel(season),
        team: { ...info, logo: info.logo || me.logo },
        record: { w: me.w, l: me.l, t: me.t, otl: me.otl, pf: me.pf, pa: me.pa, gp: me.gp },
        league: { avgFor: st.avgFor, teams: st.teams.length },
        schedule: games.map((g) => ({ ...g, oppStr: opp[g.opp.id] || { off: 1, def: 1 } })),
        raw: {
          players: Object.values(acc.players).map((p) => ({ id: p.id, name: p.name, pos: p.pos, games: p.games.size, t: p.t })),
          team: acc.team, positions, bios, names,
        },
        coverage: {
          boxScores: acc.boxes, games: games.length, failed,
          // MLB doubles/triples/steals are matched to players by name from the box-score notes.
          ...(key === 'mlb' ? { notes: { total: acc.team.notes || 0, unmatched: acc.team.unmatched || 0 } } : {}),
          history: { players: ids.length, known: Object.values(bios).filter((b) => b.log).length },
        },
        partial: failed.boxScores + failed.positions + failed.bios > 0,
        source: { provider: 'ESPN public API', kind: 'historical', note: 'Rosters and stats summed from that season\'s ESPN box scores. Colleges and past teams from ESPN athlete records.', fetchedAt: new Date().toISOString() },
      };
    });
  }

  // The draftable team-season: cached raw data + fantasy PPG and chemistry computed now.
  const rated = new Map();
  async function teamSeason(key, season, teamId) {
    const raw = await rawSeason(key, season, teamId);
    const k = `${key}-${season}-${teamId}`;
    if (rated.has(k) && rated.get(k).raw === raw) return rated.get(k).ts;
    const s = SPORTS[key];
    const { raw: r, ...rest } = raw;
    const acc = { players: Object.fromEntries(r.players.map((p) => [p.id, p])), team: r.team };
    // ESPN's standings occasionally don't add up (e.g. 1999-00 Nets listed 31-49
    // in an 82-game season). When they don't, count the real results instead.
    let record = raw.record;
    const n = raw.schedule.length;
    if (record.w + record.l + record.t + record.otl !== n) {
      const sc = raw.schedule;
      record = {
        w: sc.filter((g) => g.real.us > g.real.them).length, l: sc.filter((g) => g.real.us < g.real.them).length,
        t: sc.filter((g) => g.real.us === g.real.them).length, otl: 0,
        pf: sc.reduce((a, g) => a + g.real.us, 0), pa: sc.reduce((a, g) => a + g.real.them, 0), gp: n,
      };
    }
    const players = pool.build(key, acc, { positions: r.positions, games: n, team: raw.team });
    const label = (yr, league) => (s.sport === 'soccer' && league && CALENDAR.test(league) ? String(yr) : s.seasonLabel(yr));
    const ts = {
      ...rest, record, players,
      bios: Object.fromEntries(players.map((p) => { const b = r.bios?.[p.id]; return [p.id, { college: b?.college?.name || null, known: !!b?.log }]; })),
      pairs: chemistry.pairsFor(players, r.bios || {}, r.names || {}, label),
    };
    rated.set(k, { raw, ts });
    if (rated.size > 200) rated.delete(rated.keys().next().value);
    return ts;
  }

  return { standings, teamSeason, _mem: mem };
}

module.exports = { createHistory, SCHEMA };

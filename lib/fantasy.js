// Fantasy: Sleeper's public read-only API (no key, just a username).
// ESPN and Yahoo are on the roadmap (docs/ROADMAP.md).

const fs = require('node:fs');
const path = require('node:path');

const BASE = 'https://api.sleeper.app/v1';
const PLAYERS_FILE = path.join(__dirname, '..', 'data', 'sleeper_players.json');
const DAY = 24 * 3600 * 1000;

// Sleeper -> ESPN team abbreviations (the only differences we care about).
const TEAM_MAP = { WAS: 'WSH', OAK: 'LV' };
const espnAbbr = (t) => (t ? TEAM_MAP[t] || t : null);

const cache = new Map();
async function get(url, ttl) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.t < ttl) return hit.data;
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw Object.assign(new Error(`Sleeper said ${res.status}`), { code: res.status === 404 ? 404 : 502 });
  const data = await res.json();
  cache.set(url, { t: Date.now(), data });
  if (cache.size > 300) cache.delete(cache.keys().next().value);
  return data;
}

// ---------- player directory (14MB from Sleeper, slimmed to ~1MB, refreshed daily) ----------
let players = null;
let loading = null;
function loadPlayers() {
  if (players) return Promise.resolve(players);
  if (loading) return loading;
  loading = (async () => {
    try {
      const st = fs.statSync(PLAYERS_FILE);
      if (Date.now() - st.mtimeMs < DAY) { players = JSON.parse(fs.readFileSync(PLAYERS_FILE, 'utf8')); return players; }
    } catch { /* no cache yet */ }
    try {
      const res = await fetch(`${BASE}/players/nfl`, { signal: AbortSignal.timeout(60000) });
      const raw = await res.json();
      const slim = {};
      for (const [id, p] of Object.entries(raw)) {
        if (!p || (!p.team && p.position !== 'DEF')) continue;
        slim[id] = { n: p.full_name || `${p.first_name || ''} ${p.last_name || ''}`.trim(), pos: p.position, team: espnAbbr(p.team), inj: p.injury_status || null };
      }
      fs.mkdirSync(path.dirname(PLAYERS_FILE), { recursive: true });
      fs.writeFileSync(PLAYERS_FILE, JSON.stringify(slim));
      players = slim;
    } catch (e) {
      console.error('sleeper players', e.message);
      try { players = JSON.parse(fs.readFileSync(PLAYERS_FILE, 'utf8')); } catch { players = {}; }
    }
    return players;
  })().finally(() => { loading = null; setTimeout(() => { players = null; }, DAY).unref(); });
  return loading;
}

function player(id) {
  if (!id || id === '0') return { id, name: 'Empty slot', pos: '-', team: null, empty: true };
  const p = players?.[id];
  if (p) return { id, name: p.n, pos: p.pos, team: p.team, inj: p.inj };
  // Team defenses use the team abbreviation as their id.
  if (/^[A-Z]{2,3}$/.test(id)) return { id, name: `${id} D/ST`, pos: 'DEF', team: espnAbbr(id) };
  return { id, name: `Player ${id}`, pos: '?', team: null };
}

async function state() { return get(`${BASE}/state/nfl`, 10 * 60_000); }

const avatarUrl = (a) => (a ? `https://sleepercdn.com/avatars/thumbs/${a}` : null);

async function connect(username) {
  const user = await get(`${BASE}/user/${encodeURIComponent(username)}`, 10 * 60_000).catch((e) => {
    if (e.code === 404) throw Object.assign(new Error('No Sleeper user by that name. Typo, or witness protection?'), { code: 404 });
    throw e;
  });
  if (!user?.user_id) throw Object.assign(new Error('No Sleeper user by that name. Typo, or witness protection?'), { code: 404 });
  const st = await state();
  const seasons = [st.league_season, st.previous_season].filter(Boolean);
  let leagues = [], season = seasons[0];
  for (const s of seasons) {
    leagues = await get(`${BASE}/user/${user.user_id}/leagues/nfl/${s}`, 5 * 60_000);
    season = s;
    if (leagues.length) break;
  }
  return {
    user: { id: user.user_id, name: user.display_name || user.username, avatar: avatarUrl(user.avatar) },
    season, currentSeason: st.league_season, week: st.display_week || st.week,
    leagues: leagues.map((l) => ({ id: l.league_id, name: l.name, season: l.season, size: l.total_rosters, status: l.status, avatar: avatarUrl(l.avatar) })),
  };
}

const pts = (whole, dec) => (whole || 0) + (dec || 0) / 100;

// Points you left on the bench: the best bench player vs the worst starter at the same position.
function benchRegret(starters, bench) {
  let worst = null;
  for (const b of bench) {
    if (b.points == null) continue;
    for (const s of starters) {
      if (s.empty || s.pos !== b.pos || s.points == null) continue;
      const diff = b.points - s.points;
      if (diff > 0 && (!worst || diff > worst.diff)) worst = { benched: b, started: s, diff: Math.round(diff * 10) / 10 };
    }
  }
  return worst;
}

function therapist(me, opp, week, done) {
  if (!opp) return 'Bye week vibes. Nobody can hurt you this week. Enjoy it.';
  const d = Math.round((me.points - opp.points) * 10) / 10;
  const big = Math.abs(d) >= 30, close = Math.abs(d) < 8;
  if (me.points === 0 && opp.points === 0) return `Week ${week} hasn't started. Your lineup is perfect right now. Cherish this feeling.`;
  if (done) {
    if (d > 0 && big) return `Won by ${d}. You're allowed to send exactly one (1) screenshot to the group chat.`;
    if (d > 0) return `A W is a W. Don't look at how close it was. Don't. Look.`;
    if (big) return `Lost by ${-d}. Have you considered a calming hobby? Pottery? Literally anything else?`;
    return `Lost by ${-d}. That's one player's bad half. You'll be thinking about it in the shower for weeks.`;
  }
  if (close) return `${Math.abs(d)} points in it. Refresh every 4 seconds. That definitely helps.`;
  if (d > 0 && big) return `Up ${d}. Begin drafting your victory speech. Keep it humble (don't).`;
  if (d > 0) return `Up ${d}. Comfortable-ish. Do NOT check your opponent's remaining players.`;
  if (big) return `Down ${-d}. It's not over until it's mathematically over. (It's mathematically over.)`;
  return `Down ${-d}. You need a boom game. Light a candle. Wear the lucky socks.`;
}

async function league(leagueId, userId, weekArg) {
  await loadPlayers();
  const st = await state();
  const [lg, users, rosters] = await Promise.all([
    get(`${BASE}/league/${leagueId}`, 10 * 60_000),
    get(`${BASE}/league/${leagueId}/users`, 10 * 60_000),
    get(`${BASE}/league/${leagueId}/rosters`, 60_000),
  ]);
  if (!lg?.league_id) throw Object.assign(new Error('League not found.'), { code: 404 });
  const sameSeason = lg.season === st.league_season;
  const lastWeek = lg.settings?.playoff_week_start ? lg.settings.playoff_week_start + 2 : 17;
  const week = Number(weekArg) || (sameSeason ? Math.max(1, st.display_week || st.week || 1) : lastWeek);
  const matchups = await get(`${BASE}/league/${leagueId}/matchups/${week}`, 30_000);

  const userById = Object.fromEntries(users.map((u) => [u.user_id, u]));
  const teamName = (r) => {
    const u = userById[r?.owner_id];
    // Prefer the league-specific team avatar, but only from Sleeper's own CDN.
    const teamAv = /^https:\/\/sleepercdn\.com\//.test(u?.metadata?.avatar || '') ? u.metadata.avatar : null;
    return { team: u?.metadata?.team_name || u?.display_name || `Team ${r?.roster_id}`, owner: u?.display_name || 'Ghost owner', avatar: teamAv || avatarUrl(u?.avatar) };
  };
  const mine = rosters.find((r) => r.owner_id === userId || (r.co_owners || []).includes(userId));
  const side = (m) => {
    if (!m) return null;
    const r = rosters.find((x) => x.roster_id === m.roster_id);
    const starters = (m.starters || []).map((id, i) => ({ ...player(id), points: m.starters_points?.[i] ?? m.players_points?.[id] ?? 0 }));
    const startSet = new Set(m.starters || []);
    const bench = (m.players || []).filter((id) => !startSet.has(id)).map((id) => ({ ...player(id), points: m.players_points?.[id] ?? 0 }))
      .sort((a, b) => b.points - a.points);
    return { rosterId: m.roster_id, ...teamName(r), points: Math.round((m.custom_points ?? m.points ?? 0) * 100) / 100, starters, bench, record: r ? `${r.settings.wins}-${r.settings.losses}${r.settings.ties ? `-${r.settings.ties}` : ''}` : '' };
  };

  const myM = mine && matchups.find((m) => m.roster_id === mine.roster_id);
  const oppM = myM && myM.matchup_id && matchups.find((m) => m.matchup_id === myM.matchup_id && m.roster_id !== myM.roster_id);
  const me = side(myM), opp = side(oppM);
  const done = !sameSeason || week < (st.display_week || st.week);

  const standings = rosters.map((r) => ({
    ...teamName(r), rosterId: r.roster_id, mine: r === mine,
    wins: r.settings.wins || 0, losses: r.settings.losses || 0, ties: r.settings.ties || 0,
    pf: Math.round(pts(r.settings.fpts, r.settings.fpts_decimal) * 10) / 10,
    pa: Math.round(pts(r.settings.fpts_against, r.settings.fpts_against_decimal) * 10) / 10,
  })).sort((a, b) => b.wins - a.wins || b.pf - a.pf);

  // Every matchup this week, for the "around the league" strip.
  const byMatch = {};
  for (const m of matchups) if (m.matchup_id) (byMatch[m.matchup_id] ||= []).push(m);
  const around = Object.values(byMatch).filter((p) => p.length === 2).map(([a, b]) => {
    const ra = rosters.find((r) => r.roster_id === a.roster_id), rb = rosters.find((r) => r.roster_id === b.roster_id);
    return { a: { ...teamName(ra), points: a.points || 0 }, b: { ...teamName(rb), points: b.points || 0 }, mine: !!mine && (a.roster_id === mine.roster_id || b.roster_id === mine.roster_id) };
  });

  return {
    league: { id: lg.league_id, name: lg.name, season: lg.season, size: lg.total_rosters, avatar: avatarUrl(lg.avatar), scoring: lg.scoring_settings?.rec === 1 ? 'PPR' : lg.scoring_settings?.rec === 0.5 ? 'Half PPR' : 'Standard' },
    week, maxWeek: lastWeek, live: sameSeason && !done, hasTeam: !!mine,
    me, opp, standings, around,
    therapist: me ? therapist(me, opp, week, done) : 'You don\'t have a team in this league. Lurker energy. Respect.',
    regret: me ? benchRegret(me.starters, me.bench) : null,
  };
}

// NFL team -> your starters on it, so game cards and live rooms can flag "your guys".
async function myPlayers(leagueId, userId) {
  const lg = await league(leagueId, userId);
  const byTeam = {};
  for (const p of lg.me?.starters || []) {
    if (!p.team || p.empty) continue;
    (byTeam[p.team] ||= []).push({ name: p.name, pos: p.pos, points: p.points });
  }
  return { week: lg.week, season: lg.league.season, byTeam };
}

loadPlayers(); // warm the player directory at boot

module.exports = { connect, league, myPlayers };

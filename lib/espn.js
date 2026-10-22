// Thin wrapper over ESPN's public site API (no key needed) + normalization
// into the small shapes the frontend uses.

const BASE = 'https://site.api.espn.com/apis/site/v2/sports';

const LEAGUES = {
  nfl:   { path: 'football/nfl',                    label: 'NFL',   emoji: '🏈', sport: 'football' },
  cfb:   { path: 'football/college-football',       label: 'NCAAF', emoji: '🏈', sport: 'football' },
  nba:   { path: 'basketball/nba',                  label: 'NBA',   emoji: '🏀', sport: 'basketball' },
  wnba:  { path: 'basketball/wnba',                 label: 'WNBA',  emoji: '🏀', sport: 'basketball' },
  cbb:   { path: 'basketball/mens-college-basketball', label: 'NCAAM', emoji: '🏀', sport: 'basketball' },
  mlb:   { path: 'baseball/mlb',                    label: 'MLB',   emoji: '⚾', sport: 'baseball' },
  nhl:   { path: 'hockey/nhl',                      label: 'NHL',   emoji: '🏒', sport: 'hockey' },
  epl:   { path: 'soccer/eng.1',                    label: 'EPL',   emoji: '⚽', sport: 'soccer' },
  mls:   { path: 'soccer/usa.1',                    label: 'MLS',   emoji: '⚽', sport: 'soccer' },
  ucl:   { path: 'soccer/uefa.champions',           label: 'UCL',   emoji: '⚽', sport: 'soccer' },
};

const cache = new Map();

const inflight = new Map();

function refresh(url) {
  if (inflight.has(url)) return inflight.get(url);
  const p = (async () => {
    const res = await fetch(url, { headers: { 'user-agent': 'trash-talk-live/0.1' }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`ESPN ${res.status} for ${url}`);
    const data = await res.json();
    cache.set(url, { t: Date.now(), data });
    if (cache.size > 500) cache.delete(cache.keys().next().value);
    return data;
  })().finally(() => inflight.delete(url));
  inflight.set(url, p);
  return p;
}

// Stale-while-revalidate: a slightly old answer now beats a fresh one in 8s.
async function fetchJson(url, ttlMs) {
  const hit = cache.get(url);
  const age = hit ? Date.now() - hit.t : Infinity;
  if (age < ttlMs) return hit.data;
  if (age < ttlMs * 6) { refresh(url).catch(() => {}); return hit.data; }
  try { return await refresh(url); }
  catch (e) { if (hit) return hit.data; throw e; }
}

const num = (v) => (v === undefined || v === null || v === '' ? null : Number(v));

function normTeam(x) {
  if (!x) return null;
  const t = x.team || {};
  const rank = x.curatedRank?.current;
  return {
    id: t.id,
    name: t.shortDisplayName || t.nickname || t.name || t.displayName,
    full: t.displayName,
    abbr: t.abbreviation,
    location: t.location,
    logo: t.logo || t.logos?.[0]?.href || null,
    color: t.color ? `#${t.color}` : null,
    alt: t.alternateColor ? `#${t.alternateColor}` : null,
    score: num(typeof x.score === 'object' ? x.score?.value : x.score),
    record: x.records?.[0]?.summary || x.record?.[0]?.summary || x.record?.[0]?.displayValue || null,
    winner: !!x.winner,
    rank: rank && rank < 99 ? rank : null,
    linescores: (x.linescores || []).map((l) => l.displayValue ?? l.value),
  };
}

function normStatus(st = {}) {
  const ty = st.type || {};
  return {
    state: ty.state || 'pre', // pre | in | post
    detail: ty.detail || ty.description || '',
    short: ty.shortDetail || ty.detail || '',
    completed: !!ty.completed,
    period: st.period || 0,
    clock: st.displayClock || '',
    name: ty.name || '',
  };
}

function normEvent(e, leagueKey) {
  const c = e.competitions?.[0] || {};
  const comps = c.competitors || [];
  const home = comps.find((x) => x.homeAway === 'home') || comps[0];
  const away = comps.find((x) => x.homeAway === 'away') || comps[1];
  const lg = LEAGUES[leagueKey];
  const sit = c.situation || {};
  return {
    id: e.id,
    league: leagueKey,
    leagueLabel: lg.label,
    sport: lg.sport,
    emoji: lg.emoji,
    date: e.date || c.date,
    name: e.shortName || e.name,
    status: normStatus(e.status || c.status),
    home: normTeam(home),
    away: normTeam(away),
    venue: c.venue?.fullName || null,
    broadcast: c.broadcast || c.broadcasts?.[0]?.names?.join(', ') || null,
    odds: c.odds?.[0]?.details || null,
    situation: sit.downDistanceText || sit.lastPlay?.text || null,
    note: c.notes?.[0]?.headline || null,
  };
}

async function scoreboard(leagueKey, date) {
  const lg = LEAGUES[leagueKey];
  const qs = date ? `?dates=${date}` : '';
  const data = await fetchJson(`${BASE}/${lg.path}/scoreboard${qs}`, 20000);
  return (data.events || []).map((e) => normEvent(e, leagueKey));
}

// Preferred team stats per sport for the "tale of the tape" bars.
const PREFERRED = {
  football: ['totalYards', 'netPassingYards', 'rushingYards', 'firstDowns', 'thirdDownEff', 'turnovers', 'totalPenaltiesYards', 'possessionTime'],
  basketball: ['fieldGoalPct', 'threePointFieldGoalPct', 'freeThrowPct', 'totalRebounds', 'assists', 'steals', 'blocks', 'turnovers'],
  baseball: ['hits', 'runs', 'homeRuns', 'RBIs', 'walks', 'strikeouts', 'errors'],
  hockey: ['shotsTotal', 'hits', 'blockedShots', 'takeaways', 'giveaways', 'faceoffPercent', 'powerPlayGoals', 'penaltyMinutes'],
  soccer: ['possessionPct', 'totalShots', 'shotsOnTarget', 'wonCorners', 'foulsCommitted', 'yellowCards', 'redCards', 'saves'],
};

function teamStats(boxTeams, sport) {
  if (!boxTeams?.length) return [];
  const flat = (bt) => {
    const out = {};
    for (const s of bt.statistics || []) {
      if (Array.isArray(s.stats)) for (const g of s.stats) out[g.name] ??= { label: g.displayName || g.label, v: g.displayValue };
      else out[s.name] = { label: s.label || s.displayName || s.abbreviation, v: s.displayValue };
    }
    return out;
  };
  const byAbbr = boxTeams.map((bt) => ({ abbr: bt.team?.abbreviation, side: bt.homeAway, stats: flat(bt) }));
  const [a, b] = byAbbr;
  if (!a || !b) return [];
  let names = (PREFERRED[sport] || []).filter((n) => a.stats[n] && b.stats[n]);
  if (names.length < 3) names = Object.keys(a.stats).filter((n) => b.stats[n]).slice(0, 8);
  const away = byAbbr.find((t) => t.side === 'away') || a;
  const home = byAbbr.find((t) => t.side === 'home') || b;
  return names.map((n) => ({ key: n, label: home.stats[n].label, away: away.stats[n].v, home: home.stats[n].v }));
}

function leaders(sumLeaders) {
  if (!Array.isArray(sumLeaders)) return [];
  return sumLeaders.map((tl) => ({
    abbr: tl.team?.abbreviation,
    logo: tl.team?.logo,
    cats: (tl.leaders || []).slice(0, 3).map((cat) => {
      const top = cat.leaders?.[0];
      return top ? {
        cat: cat.displayName || cat.name,
        player: top.athlete?.displayName || top.athlete?.fullName,
        headshot: top.athlete?.headshot?.href || null,
        line: top.displayValue,
      } : null;
    }).filter(Boolean),
  })).filter((t) => t.cats.length);
}

function plays(s, sport, teamsById) {
  const abbr = (p) => teamsById[p.team?.id] || null;
  let list = [];
  if (Array.isArray(s.scoringPlays) && s.scoringPlays.length) list = s.scoringPlays;
  else if (Array.isArray(s.keyEvents) && s.keyEvents.length) list = s.keyEvents.filter((k) => k.text);
  else if (Array.isArray(s.plays)) {
    list = sport === 'basketball' ? s.plays.slice(-10) : s.plays.filter((p) => p.scoringPlay);
  }
  return list.slice(-10).reverse().map((p) => ({
    text: p.text || p.type?.text,
    period: p.period?.number ?? null,
    clock: p.clock?.displayValue || '',
    team: abbr(p),
    score: p.awayScore != null && p.homeScore != null ? `${p.awayScore}-${p.homeScore}` : null,
  }));
}

async function summary(leagueKey, id) {
  const lg = LEAGUES[leagueKey];
  const s = await fetchJson(`${BASE}/${lg.path}/summary?event=${id}`, 15000);
  const comp = s.header?.competitions?.[0] || {};
  const game = normEvent({ id, competitions: [comp], status: comp.status, date: comp.date, shortName: s.header?.shortName }, leagueKey);
  // Header competitors don't carry a logo field directly; pull from logos.
  for (const side of ['home', 'away']) {
    const raw = (comp.competitors || []).find((x) => x.homeAway === side);
    if (game[side] && !game[side].logo) game[side].logo = raw?.team?.logos?.[0]?.href || null;
  }
  game.venue = s.gameInfo?.venue?.fullName || game.venue;
  const teamsById = {};
  for (const side of ['home', 'away']) if (game[side]) teamsById[game[side].id] = game[side].abbr;

  const wp = Array.isArray(s.winprobability) ? s.winprobability : [];
  // Downsample so the panic graph stays small.
  const step = Math.max(1, Math.floor(wp.length / 120));
  const winProb = wp.filter((_, i) => i % step === 0 || i === wp.length - 1)
    .map((w) => Math.round((w.homeWinPercentage ?? 0.5) * 1000) / 10);

  return {
    game,
    stats: teamStats(s.boxscore?.teams, lg.sport),
    leaders: leaders(s.leaders),
    plays: plays(s, lg.sport, teamsById),
    winProb,
    odds: s.pickcenter?.[0]?.details || s.odds?.[0]?.details || game.odds,
  };
}

module.exports = { LEAGUES, scoreboard, summary };

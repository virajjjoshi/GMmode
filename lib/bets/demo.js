// Demo Book: a pretend sportsbook so the Bets section can be tried and shown
// before SharpSports keys exist. It is always labelled "Demo Book" and never
// presented as a real account.
//
// Open bets use today's real ESPN games and real pregame lines. The settled
// history uses real final scores from the last two days, but its lines are
// generated (ESPN drops lines once games end), including a couple of
// guaranteed bad beats so the Hall of Fame has something to show.

const { decimal, SPORT } = require('./track');

const BOOK = { key: 'demo', name: 'Demo Book' };

function seeded(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const pickOne = (r, arr) => arr[Math.floor(r() * arr.length)];
const shuffle = (r, arr) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

function leg(g, market, pick, line, odds) {
  return { league: g.league, gameId: g.id, date: g.ymd, market, pick, line, odds, homeAbbr: g.home?.abbr, awayAbbr: g.away?.abbr, event: `${g.away?.abbr} @ ${g.home?.abbr}` };
}

// One leg on a game that still has real pregame lines.
function openLeg(r, g) {
  const L = g.lines;
  const opts = [];
  if (L.homeML && L.awayML && Math.abs(L.homeML) <= 1000 && Math.abs(L.awayML) <= 1000) opts.push('ml'); // nobody bets -100000
  if (L.spread !== null && SPORT[g.league] !== 'soccer') opts.push('spread');
  if (L.total !== null) opts.push('total');
  if (!opts.length) return null;
  const market = pickOne(r, opts);
  if (market === 'ml') { const side = r() < 0.5 ? 'home' : 'away'; return leg(g, 'ml', side, null, side === 'home' ? L.homeML : L.awayML); }
  if (market === 'spread') { const side = r() < 0.5 ? 'home' : 'away'; return leg(g, 'spread', side, side === 'home' ? L.spread : -L.spread, -110); }
  return leg(g, 'total', r() < 0.5 ? 'over' : 'under', L.total, -110);
}

// One settled leg with a generated line that makes it win, lose, or lose by the hook.
function pastLeg(r, g, result, hook = false) {
  const hs = Number(g.home.score), as = Number(g.away.score);
  const sport = SPORT[g.league];
  const big = sport === 'football' || sport === 'basketball';
  const d = hook ? 0.5 : big ? pickOne(r, [1.5, 2.5, 3.5, 4.5, 6.5, 8.5]) : pickOne(r, [0.5, 1.5]);
  const market = hook ? (big ? pickOne(r, ['spread', 'total']) : 'total') : big ? pickOne(r, ['spread', 'total', 'ml']) : pickOne(r, ['total', 'ml']);
  if (market === 'ml' && hs !== as) {
    const winner = hs > as ? 'home' : 'away';
    const side = result === 'win' ? winner : winner === 'home' ? 'away' : 'home';
    const fav = r() < 0.55;
    return leg(g, 'ml', side, null, fav ? -pickOne(r, [115, 130, 150, 175, 210]) : pickOne(r, [105, 120, 145, 180, 240]));
  }
  if (market === 'spread') {
    const side = r() < 0.5 ? 'home' : 'away';
    const m = side === 'home' ? hs - as : as - hs;
    return leg(g, 'spread', side, result === 'win' ? -m + d : -m - d, -110);
  }
  const t = hs + as;
  const over = r() < 0.55;
  const line = over === (result === 'win') ? t - d : t + d;
  return leg(g, 'total', over ? 'over' : 'under', line, -110);
}

function slip(id, legs, stakeDollars, placedAt) {
  const dec = legs.reduce((a, l) => a * decimal(l.odds), 1);
  const odds = legs.length === 1 ? legs[0].odds : Math.round(dec >= 2 ? (dec - 1) * 100 : -100 / (dec - 1));
  const atRisk = stakeDollars * 100;
  return { id, book: BOOK, type: legs.length > 1 ? 'parlay' : 'single', odds, atRisk, toWin: Math.round(atRisk * (dec - 1)), placedAt, legs, demo: true };
}

// Bets on today's games. `games` are today's events (with .ymd) across leagues.
function todaysSlips(seed, games, ymd) {
  const r = seeded(`${seed}:${ymd}`);
  const usable = shuffle(r, games.filter((g) => g.lines && (g.status.state === 'pre' || g.status.state === 'in') && g.home && g.away));
  const live = usable.filter((g) => g.status.state === 'in'), pre = usable.filter((g) => g.status.state === 'pre');
  const ordered = [...live.slice(0, 3), ...pre, ...live.slice(3)];
  const out = [];
  const placed = (g) => Math.min(Date.now(), new Date(g.date).getTime() - Math.floor(r() * 5 + 1) * 3600_000);
  const singles = ordered.slice(0, 4);
  singles.forEach((g, i) => { const l = openLeg(r, g); if (l) out.push(slip(`DEMO_${ymd}_${seed.slice(0, 6)}_s${i}`, [l], pickOne(r, [10, 15, 20, 25, 50]), placed(g))); });
  const parlayPool = shuffle(r, ordered);
  for (const [n, tag, stake] of [[3, 'p3', pickOne(r, [10, 20])], [5, 'p5', 5]]) {
    const gs = parlayPool.splice(0, n);
    const legs = gs.map((g) => openLeg(r, g)).filter(Boolean);
    if (legs.length >= Math.min(n, 3)) out.push(slip(`DEMO_${ymd}_${seed.slice(0, 6)}_${tag}`, legs, stake, Math.min(...gs.map(placed))));
  }
  return out;
}

// Settled history from finished games, with two bad beats baked in.
function historySlips(seed, games) {
  const r = seeded(`${seed}:history`);
  const done = shuffle(r, games.filter((g) => g.status.state === 'post' && g.home?.score != null && g.away?.score != null));
  if (done.length < 6) return [];
  const out = [];
  const when = (g) => new Date(g.date).getTime() - 2 * 3600_000;
  let i = 0;
  for (let k = 0; k < 7 && i < done.length; k++, i++) {
    const g = done[i];
    out.push(slip(`DEMO_H_${seed.slice(0, 6)}_${k}`, [pastLeg(r, g, r() < 0.48 ? 'win' : 'loss')], pickOne(r, [10, 20, 25, 50]), when(g)));
  }
  // Bad beat 1: a single lost by the hook (prefer football/basketball, where it hurts most).
  const hookGame = done.slice(i).find((g) => ['football', 'basketball'].includes(SPORT[g.league])) || done[i];
  if (hookGame) { out.push(slip(`DEMO_H_${seed.slice(0, 6)}_hook`, [pastLeg(r, hookGame, 'loss', true)], 50, when(hookGame))); i = done.indexOf(hookGame) + 1; }
  // Bad beat 2: a 4-leg parlay that hit three legs and died on the last.
  const pg = done.filter((g) => g !== hookGame).slice(-4);
  if (pg.length === 4) {
    const legs = pg.map((g, j) => pastLeg(r, g, j < 3 ? 'win' : 'loss', j === 3));
    out.push(slip(`DEMO_H_${seed.slice(0, 6)}_par`, legs, 10, Math.min(...pg.map(when))));
  }
  return out;
}

module.exports = { BOOK, todaysSlips, historySlips, seeded };

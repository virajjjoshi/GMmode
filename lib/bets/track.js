// Live bet tracking: pure functions, no I/O. Given a bet leg and the ESPN game
// it's on, say how it's doing right now, how likely it is to cash (the Sweat
// Meter), and whether a lost bet counts as a bad beat.
//
// A leg is { league, gameId, market: 'ml'|'spread'|'total'|'other', pick: 'home'|'away'|'over'|'under', line, odds }.
// A slip is { type: 'single'|'parlay', legs: [leg], outcome?: provider-graded result }.

// Regulation length per league: [periods, minutes per period]. Baseball uses innings.
const LENGTH = {
  nfl: [4, 15], cfb: [4, 15], nba: [4, 12], wnba: [4, 10], cbb: [2, 20],
  nhl: [3, 20], mlb: [9, 0], epl: [2, 45], mls: [2, 45], ucl: [2, 45],
};
// Rough full-game standard deviation of the final margin and of the final total.
const SD = {
  football: { m: 13.5, t: 14 }, basketball: { m: 12, t: 17 }, hockey: { m: 2.3, t: 2.3 },
  baseball: { m: 4.2, t: 4.4 }, soccer: { m: 1.6, t: 1.6 },
};
const UNIT = { football: 'points', basketball: 'points', hockey: 'goals', baseball: 'runs', soccer: 'goals' };

const SPORT = { nfl: 'football', cfb: 'football', nba: 'basketball', wnba: 'basketball', cbb: 'basketball', nhl: 'hockey', mlb: 'baseball', epl: 'soccer', mls: 'soccer', ucl: 'soccer' };

// Share of regulation that's been played, 0..1.
function progress(g) {
  const st = g?.status || {};
  if (st.state === 'post') return 1;
  if (st.state !== 'in') return 0;
  const [periods, mins] = LENGTH[g.league] || [4, 15];
  const p = Math.max(1, st.period || 1);
  if (g.league === 'mlb') {
    const half = /^(bot|mid|end)/i.test(st.short || st.detail || '') ? (/^(mid|end)/i.test(st.short || st.detail || '') ? 1 : 0.5) : 0;
    return Math.min(0.98, (p - 1 + half) / periods);
  }
  if (SPORT[g.league] === 'soccer') {
    const m = parseInt(String(st.clock || '').replace(/[^0-9+]/g, ''), 10);
    return Math.min(0.98, (Number.isFinite(m) ? m : (p - 1) * 45) / 90);
  }
  if (p > periods) return 0.98; // overtime
  const [mm, ss] = String(st.clock || '0:00').split(':');
  const left = ss === undefined ? Number(mm) / 60 : Number(mm) + Number(ss) / 60;
  const done = (p - 1) * mins + (mins - (Number.isFinite(left) ? left : mins));
  return Math.max(0, Math.min(0.98, done / (periods * mins)));
}

// Standard normal CDF (Abramowitz-Stegun).
function phi(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp(-x * x / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}

const implied = (odds) => (!odds ? 0.5 : odds < 0 ? -odds / (-odds + 100) : 100 / (odds + 100));
const decimal = (odds) => (odds > 0 ? 1 + odds / 100 : 1 + 100 / -odds);
const fmtLine = (n) => (n > 0 ? `+${n}` : `${n}`);
const fmtOdds = (o) => (o > 0 ? `+${o}` : `${o}`);

// Short label like "KC -3.5", "Over 217.5", "DET ML".
function legLabel(leg, g) {
  if (!leg.gameId && leg.desc) return leg.desc; // a synced bet we couldn't match to an ESPN game
  const team = (side) => leg[`${side}Abbr`] || g?.[side]?.abbr || (side === 'home' ? 'Home' : 'Away');
  if (leg.market === 'total') return `${leg.pick === 'over' ? 'Over' : 'Under'} ${leg.line}`;
  if (leg.market === 'spread') return `${team(leg.pick)} ${fmtLine(leg.line)}`;
  if (leg.market === 'ml') return `${team(leg.pick)} ML`;
  return leg.desc || 'Bet';
}

// How one leg is doing against the game's current score.
function legState(leg, g) {
  const base = { label: legLabel(leg, g), state: g?.status?.state || 'unknown', result: null, status: 'pending', p: implied(leg.odds), text: '' };
  if (leg.market === 'other' || !g || g.home?.score == null && g.status?.state !== 'pre') {
    if (leg.outcome) return { ...base, state: 'post', result: leg.outcome, status: leg.outcome, p: leg.outcome === 'win' ? 1 : leg.outcome === 'loss' ? 0 : 0.5 };
    return base;
  }
  const sport = SPORT[g.league] || 'football';
  const unit = UNIT[sport];
  const st = g.status.state;
  if (st === 'pre') return { ...base, text: `Starts ${new Date(g.date).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })} ET` };

  const hs = Number(g.home.score) || 0, as = Number(g.away.score) || 0;
  const frac = progress(g), rem = 1 - frac;
  const fin = st === 'post';
  const units = (n) => `${fmtNum(n)} ${n === 1 ? unit.replace(/s$/, '') : unit}`;
  let margin, proj, sd, text;
  if (leg.market === 'total') {
    const tot = hs + as;
    margin = leg.pick === 'over' ? tot - leg.line : leg.line - tot;
    proj = leg.pick === 'over' ? tot - leg.line * frac : leg.line * frac - tot; // assume the rest is played at the line's pace
    sd = SD[sport].t;
    if (fin) text = margin > 0 ? `Cashed by ${fmtNum(margin)}` : margin < 0 ? `Missed by ${fmtNum(-margin)}` : 'Landed on the number';
    else text = leg.pick === 'over'
      ? (margin > 0 ? `Over by ${fmtNum(margin)}` : `Needs ${units(Math.floor(leg.line - tot) + 1).replace(' ', ' more ')}`)
      : (margin > 0 ? `${units(margin)} of cushion` : `Busted by ${fmtNum(-margin)}`);
  } else {
    const mine = leg.pick === 'home' ? hs - as : as - hs;
    const line = leg.market === 'spread' ? Number(leg.line) || 0 : 0;
    margin = mine + line;
    proj = sport === 'soccer' && leg.market === 'ml' ? margin - 0.5 : margin; // a soccer draw loses a moneyline
    sd = SD[sport].m;
    if (leg.market === 'spread') text = fin
      ? (margin > 0 ? `Covered by ${fmtNum(margin)}` : margin === 0 ? 'Push, right on the number' : `Missed by ${fmtNum(-margin)}`)
      : (margin > 0 ? `Covering by ${fmtNum(margin)}` : margin === 0 ? 'Right on the number' : `Needs ${fmtNum(-margin)} more`);
    else text = fin
      ? (mine > 0 ? `Won by ${mine}` : mine < 0 ? `Lost by ${-mine}` : 'Ended tied')
      : (mine > 0 ? `Up ${mine}` : mine < 0 ? `Down ${-mine}` : 'Tied');
  }
  const out = { ...base, margin, text };
  if (st === 'post') {
    const res = leg.outcome || (margin > 0 ? 'win' : margin < 0 || (sport === 'soccer' && leg.market === 'ml') ? 'loss' : 'push');
    return { ...out, result: res, status: res, p: res === 'win' ? 1 : res === 'loss' ? 0 : 0.5 };
  }
  const p = rem <= 0.001 ? (proj > 0 ? 1 : proj < 0 ? 0 : 0.5) : phi(proj / (sd * Math.sqrt(rem)));
  return { ...out, status: margin > 0 ? 'winning' : margin < 0 ? 'losing' : 'push', p: clamp(p, 0.01, 0.99) };
}

const fmtNum = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// A whole slip: legs, chance to cash, parlay drama, settled result.
function slipState(slip, games) {
  const legs = slip.legs.map((l) => ({ ...legState(l, games[`${l.league}:${l.gameId}`]), key: `${l.league}:${l.gameId}` }));
  const done = legs.filter((l) => l.result);
  const lost = done.filter((l) => l.result === 'loss').length;
  let outcome = slip.outcome || null;
  if (!outcome && done.length === legs.length) {
    outcome = lost ? 'loss' : done.every((l) => l.result === 'push' || l.result === 'void') ? 'push' : 'win';
  }
  if (!outcome && lost && slip.type === 'parlay') outcome = 'loss';
  const p = outcome ? (outcome === 'win' ? 1 : outcome === 'loss' ? 0 : 0.5)
    : legs.reduce((acc, l) => acc * (l.result === 'win' || l.result === 'push' ? 1 : l.result === 'loss' ? 0 : l.p), 1);
  const open = legs.filter((l) => !l.result);
  const live = legs.some((l) => l.state === 'in');
  return {
    legs, outcome, p, live,
    status: outcome ? 'settled' : live ? 'live' : 'open',
    oneLegAway: slip.type === 'parlay' && !outcome && legs.length >= 2 && open.length === 1 && done.every((l) => l.result !== 'loss'),
    badBeat: outcome === 'loss' ? badBeat(slip, legs) : null,
  };
}

// The near misses worth a plaque: lost by the hook, or a parlay that died on one leg.
const CLOSE = { football: [1.5, 3], basketball: [2, 3], hockey: [1, 1], baseball: [1, 1], soccer: [1, 1] };
function badBeat(slip, legs) {
  const losers = legs.filter((l) => l.result === 'loss');
  if (!losers.length) return null;
  const close = (l, raw) => {
    const sport = SPORT[raw.league] || 'football';
    const [lineMiss, mlMiss] = CLOSE[sport];
    const miss = -l.margin;
    return Number.isFinite(miss) && miss > 0 && miss <= (raw.market === 'ml' ? mlMiss : lineMiss) ? miss : null;
  };
  const misses = losers.map((l) => close(l, slip.legs[legs.indexOf(l)]));
  if (slip.type === 'parlay' && losers.length === 1 && legs.length >= 3) {
    const miss = misses[0];
    return { kind: 'one-leg', legs: legs.length, leg: losers[0].label, miss, score: legs.length * 10 + (miss ? 10 / miss : 0) + (slip.toWin || 0) / 10000 };
  }
  if (slip.type !== 'parlay' && misses[0]) {
    return { kind: 'hook', leg: losers[0].label, miss: misses[0], score: 10 / misses[0] + (slip.toWin || 0) / 10000 };
  }
  return null;
}

module.exports = { progress, legState, slipState, legLabel, implied, decimal, fmtOdds, SPORT, UNIT };

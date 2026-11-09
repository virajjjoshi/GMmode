// Builds lib/games/norms.json: the per-sport normalization and win model for
// the Games simulator (see lib/games/norms.js and docs/GAMES.md).
//
//   node scripts/calibrate-games.js            all sports
//   node scripts/calibrate-games.js nba 20     one sport, 20 team-seasons (merged into the file)
//
// Per sport, from a seeded random sample of real team-seasons:
//   1. Replacement level per position: the 20th percentile of real season PPG
//      among players who played at least 30% of their team's games.
//   2. Comparable rosters: for every sampled team-season, ROSTERS legal rosters
//      drafted from its real roster (each slot filled at random, in proportion
//      to how many games each eligible player actually played), plus the
//      team's best roster. Their combined PPG (no chemistry) is the sample.
//   3. Era elasticity alpha: log(average roster PPG) vs. log(league scoring
//      level) across the sampled seasons. Every roster is scaled by
//      (Lref / L)^alpha so eras compare fairly.
//   4. Win model: strength s = b * (z - z0). For each b, z0 removes the average
//      bias between a team's best roster's expected win% and the team's real
//      win%; b is chosen so expected records spread out like real team TALENT
//      (the real spread minus binomial schedule luck). Nothing here targets
//      perfect seasons.
// Fetches real ESPN data (cached in DATA_DIR/games-history), so the first run
// takes several minutes.

const fs = require('node:fs');
const { createHistory } = require('../lib/games/history');
const { SPORTS, ORDER, seasonsFor } = require('../lib/games/sports');
const squad = require('../lib/games/squad');
const sim = require('../lib/games/sim');
const norms = require('../lib/games/norms');
const { slotKeys } = require('../lib/games/sports');
const { dataFile } = require('../lib/paths');

const SAMPLE = { nfl: 30, nba: 28, mlb: 18, nhl: 28, epl: 28 };
const ROSTERS = 120;
const RUNS = 40;
const KEEP = 800; // quantiles stored per sport

const sd = (xs) => { const m = xs.reduce((a, b) => a + b, 0) / xs.length; return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length); };
const quantile = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))];
const realPct = (ts) => { const r = ts.record; return (r.w + 0.5 * r.t) / (r.gp || 1); };

async function sample(h, key, n, R) {
  const seasons = seasonsFor(key), out = [];
  let guard = 0;
  while (out.length < n && guard++ < n * 4) {
    const season = seasons[Math.floor(R.next() * seasons.length)];
    try {
      const st = await h.standings(key, season);
      const t = st.teams[Math.floor(R.next() * st.teams.length)];
      if (out.some((x) => x.season === season && x.teamId === t.id)) continue;
      const ts = await h.teamSeason(key, season, t.id);
      if (ts.partial || ts.coverage.boxScores < ts.coverage.games * 0.8) continue;
      // Same rule as a roll: the roster has to be able to fill every slot.
      if (squad.check(key, ts.players, squad.best(key, ts.players)).missing.length) { process.stdout.write(`  skip ${key} ${ts.seasonLabel} ${ts.team.abbr}: can't fill every slot\n`); continue; }
      out.push({ season, teamId: t.id });
      process.stdout.write(`  ${key} ${ts.seasonLabel} ${ts.team.abbr} (${ts.record.w}-${ts.record.l}${ts.record.t ? `-${ts.record.t}` : ''}) ${ts.players.length} players\n`);
    } catch (e) { process.stdout.write(`  skip ${key} ${season}: ${e.message}\n`); }
  }
  return out;
}

// One legal roster, slots filled at random weighted by games actually played.
function randomRoster(key, players, R) {
  const keys = slotKeys(key);
  const order = [...keys.filter((k) => !k.slot.flex), ...keys.filter((k) => k.slot.flex)];
  const sq = {}, used = new Set();
  for (const { key: k, slot } of order) {
    const c = players.filter((p) => !used.has(p.id) && squad.fits(slot, p).length);
    if (!c.length) return null;
    const p = R.pick(c, c.map((x) => x.fp[squad.fits(slot, x)[0]]?.gp || 0));
    sq[k] = p.id; used.add(p.id);
  }
  return sq;
}
const combinedOf = (key, players, sq) => squad.resolve(key, players, sq).reduce((a, s) => a + (s.ppg || 0), 0);

async function calibrate(key, n, file) {
  console.log(`\n${SPORTS[key].label}: sampling ${n} team-seasons`);
  const R = sim.rng(`calibrate-${key}`);
  // Pass 1: raw PPG (no replacement level known yet) -> replacement levels.
  norms.use({ sports: { ...(file.sports || {}), [key]: undefined } });
  const h1 = createHistory({ cacheDir: dataFile('games-history') });
  const picks = await sample(h1, key, n, R);
  const byGroup = {};
  for (const { season, teamId } of picks) {
    const ts = await h1.teamSeason(key, season, teamId);
    for (const p of ts.players) for (const [g, x] of Object.entries(p.fp)) if (x.gp >= 0.3 * ts.schedule.length) (byGroup[g] ||= []).push(x.ppg);
  }
  const repl = Object.fromEntries(Object.entries(byGroup).map(([g, xs]) => [g, Math.round(quantile(xs.sort((a, b) => a - b), 0.2) * 100) / 100]));
  console.log('  replacement PPG:', Object.entries(repl).map(([g, v]) => `${g} ${v}`).join(', '));

  // Pass 2: model PPG (with sample-size adjustment), comparable rosters, era fit.
  norms.use({ sports: { ...(file.sports || {}), [key]: { repl, sample: [0], h: 1, b: 0, z0: 0, alpha: 0, Lref: 1 } } });
  const h2 = createHistory({ cacheDir: dataFile('games-history') });
  const teams = [];
  const raw = [];
  for (const { season, teamId } of picks) {
    const ts = await h2.teamSeason(key, season, teamId);
    const L = ts.league.avgFor;
    const best = squad.best(key, ts.players);
    const vals = [combinedOf(key, ts.players, best)];
    for (let i = 0; i < ROSTERS; i++) { const sq = randomRoster(key, ts.players, R); if (sq) vals.push(combinedOf(key, ts.players, sq)); }
    teams.push({ ts, best, L, mean: vals.reduce((a, b) => a + b, 0) / vals.length });
    raw.push(...vals.map((v) => ({ v, L })));
  }
  // alpha: least squares slope of log(mean roster PPG) on log(L).
  const xs = teams.map((t) => Math.log(t.L)), ys = teams.map((t) => Math.log(t.mean));
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
  const vx = xs.reduce((a, x) => a + (x - mx) ** 2, 0);
  let alpha = vx > 1e-9 ? xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / vx : 0;
  alpha = Math.max(0, Math.min(1.5, alpha));
  const Lref = Math.exp(mx);
  const adj = raw.map(({ v, L }) => v * (Lref / L) ** alpha).sort((a, b) => a - b);
  const iqr = quantile(adj, 0.75) - quantile(adj, 0.25);
  const h = 0.9 * Math.min(sd(adj), iqr / 1.34) * adj.length ** -0.2;
  const kept = Array.from({ length: KEEP }, (_, i) => Math.round(quantile(adj, i / (KEEP - 1)) * 100) / 100);
  console.log(`  ${adj.length} comparable rosters · alpha ${alpha.toFixed(2)} · Lref ${Lref.toFixed(2)} · median ${quantile(adj, 0.5).toFixed(1)} PPG · bandwidth ${h.toFixed(2)}`);

  // Pass 3: the win model.
  const base = { repl, sample: kept, h, alpha, Lref };
  const resOf = teams.map((t) => squad.resolve(key, t.ts.players, t.best));
  const evaluate = (b, z0) => {
    norms.use({ sports: { ...(file.sports || {}), [key]: { ...base, b, z0 } } });
    let se = 0, bias = 0; const rows = [];
    teams.forEach((t, i) => {
      const o = sim.odds({ sportKey: key, ts: t.ts, res: resOf[i], runs: RUNS, seed: `cal-${t.ts.team.id}-${t.ts.season}`, chem: false });
      const p = (o.avgWins + 0.5 * o.avgTies) / o.games, r = realPct(t.ts);
      se += (p - r) ** 2; bias += p - r; rows.push({ ts: t.ts, p, r, chance: o.chance, z: o.profile.strength.z });
    });
    return { rmse: Math.sqrt(se / teams.length), bias: bias / teams.length, spread: sd(rows.map((x) => x.p)), rows };
  };
  const real = teams.map((t) => realPct(t.ts));
  const luck = teams.reduce((a, t) => { const p = realPct(t.ts); return a + (p * (1 - p)) / t.ts.schedule.length; }, 0) / teams.length;
  const target = Math.sqrt(Math.max(0.0001, sd(real) ** 2 - luck));
  let best = null, bestRmse = null;
  const grid = []; for (let b = 0.05; b <= 0.6001; b += 0.025) grid.push(b); for (let b = 0.7; b <= 2.0001; b += 0.1) grid.push(b);
  for (const b of grid) {
    let lo = -4, hi = 8;
    for (let i = 0; i < 12; i++) { const mid = (lo + hi) / 2; if (evaluate(b, mid).bias > 0) lo = mid; else hi = mid; }
    const z0 = (lo + hi) / 2, fit = evaluate(b, z0);
    if (!best || Math.abs(fit.spread - target) < Math.abs(best.spread - target)) best = { b, z0, ...fit };
    if (!bestRmse || fit.rmse < bestRmse.rmse) bestRmse = { b, ...fit };
  }
  console.log(`  talent spread ${(target * 100).toFixed(1)} pts; min-RMSE b would be ${bestRmse.b.toFixed(3)} (RMSE ${(bestRmse.rmse * 100).toFixed(1)})`);
  console.log(`  -> b ${best.b.toFixed(3)}, z0 ${best.z0.toFixed(2)}, spread ${(best.spread * 100).toFixed(1)} pts, RMSE ${(best.rmse * 100).toFixed(1)} win% points`);
  for (const x of best.rows.sort((a, b) => b.r - a.r)) {
    console.log(`     ${x.ts.seasonLabel.padEnd(8)} ${String(x.ts.team.abbr).padEnd(4)} real ${(x.r * 100).toFixed(0).padStart(3)}%  sim ${(x.p * 100).toFixed(0).padStart(3)}%  z ${x.z.toFixed(2).padStart(5)}  objective ${(x.chance * 100).toFixed(1)}%`);
  }
  return {
    ...base, h: Math.round(h * 1000) / 1000, alpha: Math.round(alpha * 1000) / 1000, Lref: Math.round(Lref * 1000) / 1000,
    b: Math.round(best.b * 1000) / 1000, z0: Math.round(best.z0 * 1000) / 1000,
    fit: { teams: teams.length, rosters: adj.length, rmse: Math.round(best.rmse * 1000) / 10, talentSpread: Math.round(target * 1000) / 10, modelSpread: Math.round(best.spread * 1000) / 10 },
  };
}

(async () => {
  const [only, count] = process.argv.slice(2);
  const keys = only ? [only] : ORDER;
  let file = { sports: {} };
  try { file = JSON.parse(fs.readFileSync(norms.FILE, 'utf8')); } catch { /* first build */ }
  for (const key of keys) {
    file.sports[key] = await calibrate(key, Number(count) || SAMPLE[key], file);
    file.built = new Date().toISOString().slice(0, 10);
    file.note = 'Generated by scripts/calibrate-games.js from real ESPN team-seasons. Do not edit by hand.';
    fs.writeFileSync(norms.FILE, `${JSON.stringify(file, null, 1)}\n`);
    console.log(`  saved ${key} to ${norms.FILE}`);
  }
})().catch((e) => { console.error(e); process.exit(1); });

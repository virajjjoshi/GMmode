// Games: sport-specific normalization. Raw fantasy PPG can't be compared
// across sports (or even across eras of one sport), so a roster's strength is
// its PERCENTILE among comparable rosters from that sport's real history.
//
// lib/games/norms.json is built by `npm run calibrate-games` from a seeded
// sample of real team-seasons per sport (see docs/GAMES.md):
//   sample  combined PPG of thousands of legal rosters drafted from those real
//           rosters (same slots as the challenge, players picked in proportion
//           to how much they actually played, plus each team's best roster),
//           each era-adjusted (below). Sorted.
//   alpha   era elasticity: rosters' fantasy output vs. the league's scoring
//           level that season, fitted on the sample. A roster's PPG is scaled
//           by (Lref / L)^alpha so a 1990s and a 2020s roster compare fairly.
//   Lref    the sport's average league scoring level across the sample.
//   h       kernel bandwidth: the percentile is read from a smoothed CDF of the
//           sample, so it keeps rising (slowly) past the best roster seen.
//   b, z0   win model: strength s = b * (z - z0), z = the percentile as a
//           normal score. Calibrated so a team's real best roster plays to
//           roughly that team's real record. See sim.js for how s sets scores.
//   repl    replacement-level PPG per position (small samples lean toward it).
// None of these numbers are shown to players.

const fs = require('node:fs');
const path = require('node:path');

const FILE = path.join(__dirname, 'norms.json');
let NORMS = null;
function load() {
  if (!NORMS) NORMS = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  return NORMS;
}
function use(n) { NORMS = n; } // tests and the calibration script
function forSport(key) {
  const n = load().sports?.[key];
  if (!n) throw new Error(`No normalization data for ${key}. Run npm run calibrate-games.`);
  return n;
}

// ---------- normal distribution ----------
// erfc with fractional error < 1.2e-7 everywhere (Numerical Recipes erfcc),
// so tails don't underflow to 0 the way 1 - erf would.
function erfc(x) {
  const z = Math.abs(x), t = 1 / (1 + 0.5 * z);
  const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
  return x >= 0 ? r : 2 - r;
}
const upper = (x) => 0.5 * erfc(x / Math.SQRT2); // P(Z > x)
// Inverse normal CDF (Acklam), for p in (0, 1).
function probit(p) {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const lo = 0.02425;
  if (p < lo) { const q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  if (p > 1 - lo) return -probit(1 - p);
  const q = p - 0.5, r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

// The top of the scale: about 1 in 30,000 comparable rosters. Real best
// rosters land around z 3 or less; the cap keeps a roster beyond anything in
// history from winning with certainty (upsets must stay possible).
const ZMAX = 4;

// Era adjustment: this season's league scoring level L vs. the sport's reference.
function eraFactor(key, L, n = forSport(key)) {
  if (!L || !n.Lref) return 1;
  return (n.Lref / L) ** (n.alpha || 0);
}

// Normal score of an era-adjusted combined PPG under the smoothed CDF.
function kdeZ(n, adj) {
  let below = 0, above = 0;
  for (const x of n.sample) { const u = (adj - x) / n.h; below += upper(-u); above += upper(u); }
  below /= n.sample.length; above /= n.sample.length;
  if (above < 0.5) return above > 0 ? -probit(above) : ZMAX * 2;
  return below > 0 ? probit(below) : -ZMAX * 2;
}
// Beyond the 1st/99th percentile the sample is too thin to read a percentile
// from, so the scale continues in a straight line at the slope of the tail
// (as a normal distribution would). Without this, a great team's best roster
// would hit the top of the scale and stop separating from other great teams.
function tails(n) {
  if (n._tails) return n._tails;
  const xs = n.sample, q = (p) => xs[Math.round(p * (xs.length - 1))];
  const lo = q(0.01), hi = q(0.99), lo2 = q(0.05), hi2 = q(0.95);
  const zlo = kdeZ(n, lo), zhi = kdeZ(n, hi);
  const up = hi > hi2 ? (zhi - kdeZ(n, hi2)) / (hi - hi2) : 0, dn = lo2 > lo ? (kdeZ(n, lo2) - zlo) / (lo2 - lo) : 0;
  Object.defineProperty(n, '_tails', { value: { lo, hi, zlo, zhi, up, dn }, enumerable: false });
  return n._tails;
}

// Percentile of an era-adjusted combined PPG among comparable rosters, and its
// normal score z (clamped to the top/bottom of the scale).
function locate(key, adj, n = forSport(key)) {
  const t = tails(n);
  let z = adj > t.hi ? t.zhi + (adj - t.hi) * t.up : adj < t.lo ? t.zlo - (t.lo - adj) * t.dn : kdeZ(n, adj);
  z = Math.max(-ZMAX, Math.min(ZMAX, z));
  return { pct: 1 - upper(z), z };
}

// Combined PPG (with chemistry) -> strength for the win model.
function strength(key, combinedPPG, L, n = forSport(key)) {
  return strengthOfAdjusted(key, combinedPPG * eraFactor(key, L, n), n);
}
// For a squad drafted from several seasons, each pick is era-adjusted by his
// own season first and the adjusted total is placed in the distribution.
function strengthOfAdjusted(key, adj, n = forSport(key)) {
  const { pct, z } = locate(key, adj, n);
  return { adj, pct, z, s: n.b * (z - n.z0) };
}

function replacement(key, group) {
  try { return forSport(key).repl?.[group]; } catch { return undefined; }
}

module.exports = { load, use, forSport, eraFactor, locate, strength, strengthOfAdjusted, replacement, probit, upper, erfc, ZMAX, FILE };

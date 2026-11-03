// Prediction Leagues scoring: the one place that turns picks + results into points.
// Pure functions, no I/O. Weekly tables, season tables, personal stats and the
// tests all go through grade(), so they can't disagree. Totals are never stored:
// they're derived from picks and results on read, which makes scoring idempotent
// and lets a corrected result fix every table automatically.

const WEEK_MS = 7 * 864e5;

const FORMATS = {
  classic: {
    key: 'classic', label: "Classic pick'em", available: true,
    rules: ['Correct winner: 1 point', 'Wrong winner: 0 points', 'Missed pick: 0 points', 'Canceled game: not scored', 'Postponed game: scored when it is actually played'],
  },
  // Data model is ready (picks carry a `confidence` field); scoring isn't built yet.
  confidence: {
    key: 'confidence', label: 'Confidence points', available: false,
    rules: ['Rank each pick by confidence. A correct pick earns its confidence value.'],
  },
};

const DEFAULT_RULES = Object.freeze({
  format: 'classic',
  correct: 1,
  picks: 'all',      // 'all' = every eligible game counts (missing one is a miss) | 'select' = only games you pick
  missed: 'zero',    // 'zero' = missed picks score 0 | 'home' = missed picks default to the home team
  ties: 'shared',    // standings: 'shared' = equal points share a rank | 'break' = tiebreakers decide
});

// result: correct | incorrect | missed | push | void | pending | none
// counted: whether it goes into correct/incorrect accuracy.
function grade({ pick, outcome, drawPick = false, countMiss = false, rules = DEFAULT_RULES }) {
  let auto = false;
  if (!pick) {
    if (outcome === null || outcome === undefined) return { result: countMiss ? 'pending' : 'none', points: 0, counted: false };
    if (outcome === 'void') return { result: countMiss ? 'void' : 'none', points: 0, counted: false };
    if (!countMiss) return { result: 'none', points: 0, counted: false };
    if (rules.missed !== 'home') return { result: 'missed', points: 0, counted: false };
    pick = 'home'; auto = true;
  }
  if (outcome === null || outcome === undefined) return { result: 'pending', points: 0, counted: false, auto };
  if (outcome === 'void') return { result: 'void', points: 0, counted: false, auto };
  if (outcome === 'tie' && !drawPick) return { result: 'push', points: 0, counted: false, auto };
  const want = outcome === 'tie' ? 'draw' : outcome;
  const correct = pick === want;
  return { result: correct ? 'correct' : 'incorrect', points: correct ? (rules.correct || 1) : 0, counted: true, auto };
}

const emptyRow = () => ({ correct: 0, incorrect: 0, missed: 0, push: 0, void: 0, pending: 0, points: 0 });

function tally(row, g) {
  if (g.result === 'none') return row;
  row[g.result] = (row[g.result] || 0) + 1;
  row.points += g.points;
  return row;
}

function finish(row) {
  const decided = row.correct + row.incorrect;
  row.scored = decided + row.missed;
  row.accuracy = decided ? Math.round((row.correct / decided) * 1000) / 10 : null;
  return row;
}

// Ranks rows in place. 'shared' = competition ranking (1, 1, 3).
// 'break' = more correct, fewer missed, better accuracy, then earlier join.
function rank(rows, ties = 'shared') {
  const tb = (a, b) => b.correct - a.correct || a.missed - b.missed || (b.accuracy ?? -1) - (a.accuracy ?? -1) || (a.joinedAt || 0) - (b.joinedAt || 0);
  rows.sort((a, b) => b.points - a.points || tb(a, b));
  rows.forEach((r, i) => {
    const prev = rows[i - 1];
    r.rank = ties === 'shared' && prev && prev.points === r.points ? prev.rank : i + 1;
  });
  rows.forEach((r) => { r.tied = ties === 'shared' && rows.some((o) => o !== r && o.rank === r.rank); });
  return rows;
}

// Weeks run in 7-day blocks from the league's season start. Season bounds are
// local midnights, so a DST change can leave an extra hour at the end; that
// hour belongs to the last week instead of becoming a phantom week.
const DST_SLACK = 2 * 3600e3;
function weekCount(league) { return Math.max(1, Math.ceil((league.seasonEnd - league.seasonStart - DST_SLACK) / WEEK_MS)); }
function weekOf(league, t) {
  if (t < league.seasonStart) return 0;
  if (t >= league.seasonEnd) return null;
  return Math.min(weekCount(league), Math.floor((t - league.seasonStart) / WEEK_MS) + 1);
}
function weekRange(league, n) {
  const start = league.seasonStart + (n - 1) * WEEK_MS;
  const end = n >= weekCount(league) ? league.seasonEnd : Math.min(start + WEEK_MS, league.seasonEnd);
  return { week: n, start, end };
}
function currentWeek(league, now) {
  if (now < league.seasonStart) return 1;
  return weekOf(league, now) ?? weekCount(league);
}

module.exports = { WEEK_MS, FORMATS, DEFAULT_RULES, grade, emptyRow, tally, finish, rank, weekCount, weekOf, weekRange, currentWeek };

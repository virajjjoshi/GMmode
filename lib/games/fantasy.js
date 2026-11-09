// Games: fantasy scoring. One fixed formula per sport (per position where the
// sport scores positions differently), applied to a player's real stats from
// the season being played. The same formula scores a simulated game line, so a
// player's simulated production is measured exactly like his real one.
//
// Only stat categories ESPN's box scores record in EVERY covered season of a
// sport are used, so a 1996 season and a 2024 season are scored the same way.
// Categories left out for that reason are listed in OMITTED (and the docs).
//
// PPG = fantasy points / games actually played (games with a box-score line).
// That real PPG is what the model uses, except for a tiny sample (below
// SAMPLE_K games), which is topped up with replacement-level games ("model
// PPG"); the real season PPG is always shown alongside it.

const r2 = (v) => Math.round(v * 100) / 100;

// [stat key, points, label]. Keys match parse.js totals and sim.js game lines.
const NFL = [
  ['passYds', 0.04, 'Passing yard'], ['passTD', 4, 'Passing TD'], ['int', -2, 'Interception thrown'],
  ['rushYds', 0.1, 'Rushing yard'], ['rushTD', 6, 'Rushing TD'],
  ['rec', 1, 'Reception'], ['recYds', 0.1, 'Receiving yard'], ['recTD', 6, 'Receiving TD'],
  ['fumLost', -2, 'Fumble lost'],
  ['fgm', 3, 'Field goal made'], ['fgMiss', -1, 'Field goal missed'], ['xpm', 1, 'Extra point made'], ['xpMiss', -1, 'Extra point missed'],
  ['solo', 1, 'Solo tackle'], ['tklAst', 0.5, 'Assisted tackle'], ['sacks', 2, 'Sack'], ['tfl', 1, 'Tackle for loss'], ['qbh', 0.5, 'QB hit'],
  ['pd', 1, 'Pass defended'], ['defInt', 3, 'Interception'], ['defTD', 6, 'Defensive TD (pick-six or fumble return)'],
];
// Team defense / special teams, standard fantasy D/ST scoring, from the real
// games: points allowed is the real final score, so a stingy defense scores.
const NFL_DST = [
  ['dstSack', 1, 'Sack'], ['dstInt', 2, 'Interception'], ['dstFr', 2, 'Fumble recovered'], ['dstTd', 6, 'Defensive or return TD'],
  ['paPts', 1, 'Points-allowed tier (0: +10, 1-6: +7, 7-13: +4, 14-20: +1, 21-27: 0, 28-34: -1, 35+: -4)'],
];
const paTier = (pa) => (pa <= 0 ? 10 : pa <= 6 ? 7 : pa <= 13 ? 4 : pa <= 20 ? 1 : pa <= 27 ? 0 : pa <= 34 ? -1 : -4);
const NBA = [
  ['pts', 1, 'Point'], ['tpm', 0.5, 'Three made (bonus)'], ['reb', 1.25, 'Rebound'], ['ast', 1.5, 'Assist'],
  ['stl', 2, 'Steal'], ['blk', 2, 'Block'], ['tov', -0.5, 'Turnover'], ['dd', 1.5, 'Double-double'], ['td3', 3, 'Triple-double'],
];
const MLB_BAT = [
  ['s1', 1, 'Single'], ['d2', 2, 'Double'], ['d3', 3, 'Triple'], ['hr', 4, 'Home run'],
  ['r', 1, 'Run'], ['rbi', 1, 'RBI'], ['bb', 1, 'Walk'], ['sb', 1, 'Stolen base'], ['so', -1, 'Strikeout'],
];
const MLB_PITCH = [
  ['ip', 3, 'Inning pitched (1 per out)'], ['ha', -1, 'Hit allowed'], ['er', -2, 'Earned run'], ['pbb', -1, 'Walk issued'], ['pk', 1, 'Strikeout'],
  ['w', 2, 'Win'], ['l', -2, 'Loss'], ['sv', 5, 'Save'], ['hd', 2, 'Hold'],
];
const NHL_SK = [['g', 3, 'Goal'], ['a', 2, 'Assist'], ['pm', 1, 'Plus-minus'], ['sog', 0.4, 'Shot on goal']];
const NHL_G = [['w', 3, 'Win'], ['sv', 0.2, 'Save'], ['ga', -1, 'Goal against'], ['so', 3, 'Shutout']];
// Soccer scores by position, like most soccer fantasy games: a defender's goal
// is rarer, so it's worth more; clean sheets matter most at the back.
const EPL_COMMON = [['st', 2, 'Start'], ['sub', 1, 'Substitute appearance'], ['ast', 3, 'Assist'], ['sog', 0.5, 'Shot on target'], ['yc', -1, 'Yellow card'], ['rc', -3, 'Red card'], ['og', -2, 'Own goal']];
const EPL = {
  GK: [['goals', 6, 'Goal'], ...EPL_COMMON, ['cs', 4, 'Clean sheet (as a starter)'], ['gaStart', -0.5, 'Goal conceded (as a starter)'], ['saves', 1 / 3, 'Save']],
  DEF: [['goals', 6, 'Goal'], ...EPL_COMMON, ['cs', 4, 'Clean sheet (as a starter)'], ['gaStart', -0.5, 'Goal conceded (as a starter)']],
  MID: [['goals', 5, 'Goal'], ...EPL_COMMON, ['cs', 1, 'Clean sheet (as a starter)']],
  FWD: [['goals', 4, 'Goal'], ...EPL_COMMON],
};

const FORMULAS = {
  nfl: { name: 'Full PPR with team D/ST', sets: { all: NFL.filter(([k]) => !['solo', 'tklAst', 'sacks', 'tfl', 'qbh', 'pd', 'defInt', 'defTD'].includes(k)), dst: NFL_DST } },
  nba: { name: 'Points league', sets: { all: NBA } },
  mlb: { name: 'Points league (hitters and pitchers)', sets: { bat: MLB_BAT, pitch: MLB_PITCH } },
  nhl: { name: 'Points league (skaters and goalies)', sets: { skater: NHL_SK, goalie: NHL_G } },
  epl: { name: 'Position-based points', sets: EPL },
};

// Categories ESPN doesn't record in every covered season, so they're left out
// rather than counted for some seasons and not others.
const OMITTED = {
  nfl: 'Two-point conversions, field-goal distance, return yards, safeties and blocked kicks aren\'t in the box scores of every season, so they don\'t score. Defense and special teams are one D/ST unit: the rolled team\'s real defense, scored from its real games (box scores don\'t let individual defenders be judged fairly: bad defenses make more tackles). Kick and punt return TDs count for the D/ST, not the returner, so they aren\'t counted twice.',
  nba: 'Every category is recorded in every season from 1995-96 on.',
  mlb: 'Hit-by-pitches, caught stealing and quality starts aren\'t scored. Doubles, triples and steals come from the box-score notes, matched to the player by name.',
  nhl: 'Power-play points aren\'t scored: ESPN only records goal strength from 2003-04 on. Blocks and hits aren\'t scored: they\'re blank before the mid-2000s. Goalie wins and shutouts come from the real final score (the goalie with the most ice time on a winning night).',
  epl: 'Tackles, interceptions and minutes played aren\'t in the feed for these seasons, so defenders score through clean sheets, goals conceded, goals and assists. Clean sheets count for starters.',
};

// The smallest sample whose real PPG is used exactly as-is. Below it, the
// missing games are filled with replacement-level games, so a two-game hot
// streak can't pose as a season. Everyone at or above it counts at his real PPG.
const SAMPLE_K = { nfl: { all: 4, dst: 4 }, nba: { all: 10 }, mlb: { bat: 20, SP: 5, RP: 10 }, nhl: { skater: 10, goalie: 8 }, epl: { GK: 5, DEF: 5, MID: 5, FWD: 5 } };

// Which formula set a draft group uses.
function setFor(sportKey, group) {
  if (sportKey === 'nfl') return group === 'DST' ? 'dst' : 'all';
  if (sportKey === 'nba') return 'all';
  if (sportKey === 'mlb') return group === 'SP' || group === 'RP' ? 'pitch' : 'bat';
  if (sportKey === 'nhl') return group === 'G' ? 'goalie' : 'skater';
  return group; // soccer: GK, DEF, MID, FWD
}

// Derived categories (a miss is an attempt that wasn't made, and so on).
function derive(sportKey, set, t) {
  const v = (k) => Number(t[k]) || 0;
  const d = { ...t };
  if (sportKey === 'nfl') {
    d.fgMiss = Math.max(0, v('fga') - v('fgm'));
    d.xpMiss = Math.max(0, v('xpa') - v('xpm'));
    d.tklAst = Math.max(0, v('tkl') - (t.solo === undefined ? v('tkl') : v('solo')));
  }
  if (sportKey === 'mlb' && set === 'bat') d.s1 = Math.max(0, v('h') - v('d2') - v('d3') - v('hr'));
  if (sportKey === 'epl') { d.st = t.st ?? v('starts'); d.sub = t.sub ?? Math.max(0, v('app') - v('starts')); }
  return d;
}

// Fantasy points for a stat object (season totals or one game line).
function points(sportKey, group, t) {
  const set = setFor(sportKey, group);
  const rows = FORMULAS[sportKey].sets[set];
  const d = derive(sportKey, set, t);
  let pts = 0;
  for (const [k, w] of rows) pts += (Number(d[k]) || 0) * w;
  return pts;
}

// Where a player's points came from, biggest first (for the draft board).
function breakdown(sportKey, group, t, gp) {
  const set = setFor(sportKey, group);
  const d = derive(sportKey, set, t);
  return FORMULAS[sportKey].sets[set]
    .map(([k, w, label]) => ({ k, label, n: Number(d[k]) || 0, pts: (Number(d[k]) || 0) * w }))
    .filter((x) => x.n)
    .map((x) => ({ ...x, ppg: gp ? r2(x.pts / gp) : 0, pts: r2(x.pts) }))
    .sort((a, b) => Math.abs(b.pts) - Math.abs(a.pts));
}

// Games a player actually played in the role this group scores.
function gamesFor(sportKey, group, t, games) {
  if (sportKey === 'mlb') return group === 'SP' || group === 'RP' ? (t.pGames || 0) : (t.bGames || 0);
  if (sportKey === 'nhl' && group === 'G') return t.gGames || games;
  if (sportKey === 'nfl' && group === 'DST') return t.dstGames || 0;
  return games;
}

// Season PPG for one group: real numbers plus the sample-adjusted model PPG.
// repl: replacement-level PPG for the group (from norms). No games = no PPG
// (null), never zero.
function seasonPPG(sportKey, group, t, games, repl) {
  const gp = gamesFor(sportKey, group, t, games);
  if (!gp) return null;
  const pts = points(sportKey, group, t);
  const ks = SAMPLE_K[sportKey];
  const k = ks[group] ?? ks[setFor(sportKey, group)] ?? 5;
  const prior = Number.isFinite(repl) ? repl : pts / gp;
  const mppg = gp >= k ? pts / gp : (pts + prior * (k - gp)) / k;
  return { gp, pts: r2(pts), ppg: r2(pts / gp), mppg: r2(mppg), k, small: gp < k };
}

// The scoring rules, for the docs, the API and the "How it works" page.
function describe(sportKey) {
  const f = FORMULAS[sportKey];
  return {
    name: f.name,
    sets: Object.entries(f.sets).map(([set, rows]) => ({ set, rows: rows.map(([k, w, label]) => ({ k, label, pts: r2(w) })) })),
    omitted: OMITTED[sportKey],
  };
}

module.exports = { FORMULAS, OMITTED, SAMPLE_K, setFor, points, breakdown, gamesFor, seasonPPG, describe, derive, paTier };

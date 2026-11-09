// Games: parsing, fantasy scoring, chemistry, normalization, squad rules, the
// simulator and the challenge lifecycle. Everything here runs offline on
// SYNTHETIC fixtures (made-up players and box scores shaped like ESPN's) and
// synthetic normalization data. They test the machinery, not history.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const parse = require('../lib/games/parse');
const fantasy = require('../lib/games/fantasy');
const chemistry = require('../lib/games/chemistry');
const norms = require('../lib/games/norms');
const pool = require('../lib/games/pool');
const squad = require('../lib/games/squad');
const sim = require('../lib/games/sim');
const { SPORTS, seasonsFor, slotKeys, publicSport } = require('../lib/games/sports');
const { createStore } = require('../lib/predict/persist');
const { createService } = require('../lib/games/service');
const { createHistory } = require('../lib/games/history');

// ---------- synthetic normalization (not the calibrated file) ----------
// A smooth comparison distribution for 8-man NBA rosters centered on 150 PPG.
const spread = (mid, sd, n = 400) => Array.from({ length: n }, (_, i) => mid + sd * norms.probit((i + 0.5) / n)).sort((a, b) => a - b);
const TEST_NORMS = {
  sports: {
    nba: { repl: { G: 8, F: 8, C: 7 }, sample: spread(150, 25), h: 4, alpha: 0.5, Lref: 100, b: 0.12, z0: 0 },
    nfl: { repl: { QB: 8, RB: 2, WR: 3, TE: 2.5, K: 6, DST: 4 }, sample: spread(80, 12), h: 2, alpha: 1, Lref: 22, b: 0.5, z0: 0 },
    mlb: { repl: { C: 1, '1B': 1.5, '2B': 1, '3B': 1, SS: 1, OF: 1.5, DH: 1.5, SP: 6, RP: 1 }, sample: spread(60, 8), h: 1.5, alpha: 0.5, Lref: 4.5, b: 0.3, z0: 0 },
    nhl: { repl: { F: 1, D: 0.8, G: 3 }, sample: spread(25, 4), h: 0.8, alpha: 0.5, Lref: 2.9, b: 0.4, z0: 0 },
    epl: { repl: { GK: 2.5, DEF: 2.5, MID: 2.5, FWD: 2.5 }, sample: spread(45, 6), h: 1, alpha: 0.5, Lref: 1.35, b: 0.6, z0: 0 },
  },
};
norms.use(TEST_NORMS);

// ---------- synthetic fixtures ----------
const ath = (id, name, pos) => ({ id: String(id), displayName: name, shortName: name.replace(/^(\w)\w*\s/, '$1. '), position: pos ? { abbreviation: pos } : undefined });
const NBA_KEYS = ['minutes', 'points', 'fieldGoalsMade-fieldGoalsAttempted', 'threePointFieldGoalsMade-threePointFieldGoalsAttempted', 'freeThrowsMade-freeThrowsAttempted', 'rebounds', 'assists', 'turnovers', 'steals', 'blocks', 'offensiveRebounds', 'defensiveRebounds', 'fouls', 'plusMinus'];
function nbaSummary(teamId, rows, otherRows = []) {
  const block = (rs) => [{ keys: NBA_KEYS, athletes: rs.map(([id, name, pos, stats, extra]) => ({ athlete: ath(id, name, pos), stats, ...extra })) }];
  return {
    header: { competitions: [{ competitors: [{ team: { id: teamId, displayName: 'Test City Testers', abbreviation: 'TST' } }, { team: { id: '99', displayName: 'Other' } }] }] },
    boxscore: { players: [{ team: { id: teamId }, statistics: block(rows) }, { team: { id: '99' }, statistics: block(otherRows) }] },
  };
}

// A synthetic NBA team-season in the shape history.teamSeason() returns.
// PPG is real-shaped: points-league fantasy points from per-game stats.
function fakeNbaSeason({ games = 82, season = 2010 } = {}) {
  const mk = (i, pos, rate, gp = 70) => {
    const elig = pos === 'C' ? ['C'] : pos.includes('G') ? ['G'] : ['F'];
    const t = Object.fromEntries(Object.entries(rate).map(([k, v]) => [k, v * gp]));
    const fp = Object.fromEntries(elig.map((g) => [g, { ...fantasy.seasonPPG('nba', g, t, gp, TEST_NORMS.sports.nba.repl[g]), parts: [] }]));
    const g0 = elig[0];
    return { id: `p${i}`, name: `Player ${i}`, pos, elig, group: g0, gp, key: [['GP', gp]], line: `${rate.pts} pts`, rate, fp, pg: Object.fromEntries(elig.map((g) => [g, fp[g].mppg])), ppg: fp[g0].ppg, mppg: fp[g0].mppg };
  };
  const players = [
    mk(1, 'PG', { pts: 25, reb: 5, ast: 8, stl: 2, blk: 0.3, tpm: 2, tov: 3 }), mk(2, 'SG', { pts: 15, reb: 3, ast: 3, stl: 1, blk: 0.2, tpm: 2, tov: 1.5 }),
    mk(3, 'G', { pts: 5, reb: 2, ast: 2, stl: 0.5, blk: 0.1, tpm: 0.5, tov: 1 }), mk(4, 'SF', { pts: 20, reb: 7, ast: 4, stl: 1, blk: 0.5, tpm: 1, tov: 2 }),
    mk(5, 'PF', { pts: 12, reb: 9, ast: 2, stl: 0.5, blk: 1, tpm: 0, tov: 1 }), mk(6, 'F', { pts: 3, reb: 3, ast: 1, stl: 0.3, blk: 0.2, tpm: 0, tov: 0.5 }),
    mk(7, 'C', { pts: 14, reb: 11, ast: 2, stl: 0.5, blk: 2, tpm: 0, tov: 1.5 }), mk(8, 'C', { pts: 4, reb: 4, ast: 0.5, stl: 0.2, blk: 0.6, tpm: 0, tov: 0.5 }),
    mk(9, 'F', { pts: 8, reb: 4, ast: 1, stl: 0.6, blk: 0.4, tpm: 0.8, tov: 0.8 }), mk(10, 'G', { pts: 7, reb: 2, ast: 3, stl: 0.7, blk: 0.1, tpm: 1, tov: 1 }),
  ];
  // Verified connections: p1 + p4 college and two prior seasons; p2 + p5 one prior season.
  const bios = {
    p1: { college: { id: 'c1', name: 'State U' }, past: [{ s: 2007, t: '1' }, { s: 2008, t: '1' }], nat: [] },
    p4: { college: { id: 'c1', name: 'State U' }, past: [{ s: 2007, t: '1' }, { s: 2008, t: '1' }], nat: [] },
    p2: { college: null, past: [{ s: 2006, t: '9' }], nat: [] },
    p5: { college: null, past: [{ s: 2006, t: '9' }], nat: [] },
  };
  return {
    sport: 'nba', season, seasonLabel: '2009-10', team: { id: '1', name: 'Test City Testers', abbr: 'TST', logo: null },
    record: { w: 50, l: 32, t: 0, otl: 0, gp: 82 }, league: { avgFor: 100, teams: 30 },
    schedule: Array.from({ length: games }, (_, i) => ({ id: `g${i}`, date: new Date(2010, 0, 1 + i).toISOString(), home: i % 2 === 0, opp: { id: String(2 + (i % 29)), abbr: `O${i % 29}`, name: `Opp ${i % 29}` }, real: { us: 100, them: 95 }, oppStr: { off: 0.9 + (i % 5) * 0.05, def: 0.9 + (i % 7) * 0.03 } })),
    players, coverage: { boxScores: games, games, history: { players: 10, known: 4 } }, source: { provider: 'synthetic test fixture', kind: 'test' },
    bios: Object.fromEntries(players.map((p) => [p.id, { college: bios[p.id]?.college?.name || null, known: !!bios[p.id] }])),
    pairs: chemistry.pairsFor(players, bios, { teams: { '2007|1': 'Testers', '2008|1': 'Testers', '2006|9': 'Others' } }),
  };
}
const WEAK = { 'G.0': 'p3', 'G.1': 'p10', 'F.0': 'p6', 'F.1': 'p9', 'C.0': 'p8', 'BENCH.0': 'p5', 'BENCH.1': 'p2', 'BENCH.2': 'p7' };

// ---------- rules ----------
test('sports: every challenge has seasons, slots and a clear objective', () => {
  for (const key of Object.keys(SPORTS)) {
    const p = publicSport(key);
    assert.ok(p.picks >= 8, `${key} squad size`);
    assert.ok(['perfect', 'undefeated'].includes(p.objective));
    assert.ok(seasonsFor(key).length > 10);
    assert.equal(slotKeys(key).length, p.picks);
  }
  assert.ok(!seasonsFor('nhl').includes(2005), 'cancelled 2004-05 NHL season is excluded');
  assert.equal(SPORTS.nba.seasonLabel(1996), '1995-96');
  assert.equal(SPORTS.epl.seasonLabel(2003), '2003-04');
  assert.deepEqual(SPORTS.nfl.slots.map((s) => `${s.n}${s.id}`), ['1QB', '2RB', '2WR', '1TE', '1FLEX', '1K', '1DST'], 'standard fantasy lineup with D/ST');
});

// ---------- fantasy scoring ----------
test('fantasy: each sport\'s formula, by hand', () => {
  // NFL QB: 300 yds (12) + 3 TD (12) - 1 INT (-2) + 20 rush yds (2) - 1 fumble lost (-2) = 22
  assert.equal(fantasy.points('nfl', 'QB', { passYds: 300, passTD: 3, int: 1, rushYds: 20, fumLost: 1 }), 22);
  // NFL WR, full PPR: 8 rec (8) + 110 yds (11) + 1 TD (6) = 25
  assert.equal(fantasy.points('nfl', 'WR', { rec: 8, recYds: 110, recTD: 1 }), 25);
  // NFL K: 2/3 FG (6 - 1) + 3/3 XP (3) = 8
  assert.equal(fantasy.points('nfl', 'K', { fgm: 2, fga: 3, xpm: 3, xpa: 3 }), 8);
  // NFL D/ST: 3 sacks (3) + 1 INT (2) + 1 FR (2) + 1 TD (6) + held to 10 (4) = 17
  assert.equal(fantasy.points('nfl', 'DST', { dstSack: 3, dstInt: 1, dstFr: 1, dstTd: 1, paPts: fantasy.paTier(10) }), 17);
  assert.deepEqual([0, 6, 13, 20, 27, 34, 35].map(fantasy.paTier), [10, 7, 4, 1, 0, -1, -4]);
  // NBA: 30 pts + 2 threes (1) + 10 reb (12.5) + 10 ast (15) + 2 stl (4) + 1 blk (2) - 4 tov (-2) + triple-double (3) + double-double (1.5)
  assert.equal(fantasy.points('nba', 'G', { pts: 30, tpm: 2, reb: 10, ast: 10, stl: 2, blk: 1, tov: 4, dd: 1, td3: 1 }), 67);
  // MLB hitter: 3 H = 1 single + 1 double + 1 HR (1 + 2 + 4) + 2 R + 3 RBI + 1 BB + 1 SB - 1 K = 13
  assert.equal(fantasy.points('mlb', 'OF', { h: 3, d2: 1, d3: 0, hr: 1, r: 2, rbi: 3, bb: 1, sb: 1, so: 1 }), 13);
  // MLB pitcher: 7 IP (21) - 5 H - 2 ER (-4) - 1 BB + 8 K + W (2) = 21
  assert.equal(fantasy.points('mlb', 'SP', { ip: 7, ha: 5, er: 2, pbb: 1, pk: 8, w: 1 }), 21);
  assert.equal(fantasy.points('mlb', 'RP', { ip: 1, pk: 2, sv: 1 }), 10);
  // NHL skater: 1 G (3) + 2 A (4) + plus-2 (2) + 5 shots (2) = 11. Goalie: W (3) + 30 sv (6) - 2 GA = 7
  assert.equal(fantasy.points('nhl', 'F', { g: 1, a: 2, pm: 2, sog: 5 }), 11);
  assert.equal(Math.round(fantasy.points('nhl', 'G', { w: 1, sv: 30, ga: 2, so: 0 }) * 100) / 100, 7);
  // Soccer scores by position: the same goal is worth 6 to a defender, 4 to a forward.
  const line = { app: 1, starts: 1, goals: 1 };
  assert.equal(fantasy.points('epl', 'DEF', line) - fantasy.points('epl', 'FWD', line), 2);
  // A starting keeper: start (2) + clean sheet (4) + 6 saves (2) = 8
  assert.equal(Math.round(fantasy.points('epl', 'GK', { app: 1, starts: 1, cs: 1, saves: 6, gaStart: 0 }) * 100) / 100, 8);
  // Every sport documents its formula and what it leaves out.
  for (const k of Object.keys(SPORTS)) { const d = fantasy.describe(k); assert.ok(d.sets.length && d.omitted); }
});

test('fantasy: PPG is per game actually played; no games is null (not zero); small samples lean to replacement', () => {
  const big = fantasy.seasonPPG('nba', 'G', { pts: 2000, reb: 400 }, 80, 10);
  assert.equal(big.gp, 80);
  assert.equal(big.ppg, (2000 + 400 * 1.25) / 80, 'season total / games played');
  assert.equal(big.mppg, big.ppg, 'a real sample is used exactly as it is');
  const tiny = fantasy.seasonPPG('nba', 'G', { pts: 90 }, 2, 10);
  assert.equal(tiny.ppg, 45, 'real number is kept');
  assert.equal(tiny.mppg, (90 + 10 * 8) / 10, 'two games are topped up with eight replacement-level games');
  assert.equal(fantasy.seasonPPG('nba', 'G', { pts: 300 }, 10, 10).mppg, 30, 'at the minimum sample: real PPG');
  assert.equal(fantasy.seasonPPG('mlb', 'SP', { bGames: 30, h: 20 }, 0, 6), null, 'never pitched: no pitching PPG at all');
  assert.equal(fantasy.seasonPPG('nba', 'G', {}, 0, 10), null);
  // Roles count their own games: a two-way MLB player.
  const two = { bGames: 100, pGames: 20, h: 100, r: 50, ip: 120, pk: 130 };
  assert.equal(fantasy.gamesFor('mlb', 'DH', two, 0), 100);
  assert.equal(fantasy.gamesFor('mlb', 'SP', two, 0), 20);
});

// ---------- parsing ----------
test('parse: only the rolled team counts, DNPs are skipped, stats sum across games, double-doubles counted', () => {
  const acc = parse.newAcc();
  const line = (min, pts, reb = '6') => [String(min), String(pts), '5-10', '1-3', '2-2', reb, '4', '2', '1', '0', '1', '5', '2', '+3'];
  parse.addGame('basketball', acc, nbaSummary('1', [['10', 'Ace', 'PG', line(30, 20, '11')], ['11', 'Bench', 'C', ['0'], { didNotPlay: true }]], [['50', 'Enemy', 'SF', line(40, 40)]]), '1', 'e1');
  parse.addGame('basketball', acc, nbaSummary('1', [['10', 'Ace', 'PG', line(32, 30)]]), '1', 'e2');
  assert.equal(acc.boxes, 2);
  assert.deepEqual(Object.keys(acc.players), ['10'], 'other team and DNP excluded');
  const p = acc.players['10'];
  assert.equal(p.games.size, 2);
  assert.equal(p.t.pts, 50);
  assert.equal(p.t.dd, 1, '20 pts + 11 reb is a double-double; 30 + 6 is not');
  const [built] = pool.build('nba', acc);
  assert.deepEqual(built.elig, ['G']);
  assert.equal(built.gp, 2);
  assert.equal(built.ppg, Math.round(fantasy.points('nba', 'G', p.t) / 2 * 100) / 100, 'pool PPG = formula on real totals / games');
  assert.ok(built.fp.G.parts.length, 'breakdown of where points came from');
});

test('parse: NFL defensive TDs aren\'t double counted, fumbles lost and team D/ST come from the box score', () => {
  const cat = (name, labels, rows) => ({ name, labels, athletes: rows.map(([id, nm, stats]) => ({ athlete: ath(id, nm), stats })) });
  const sum = { boxscore: { players: [
    { team: { id: '17' }, statistics: [
      cat('passing', ['C/ATT', 'YDS', 'AVG', 'TD', 'INT', 'SACKS', 'QBR', 'RTG'], [['1', 'Quarterback', ['20/30', '250', '8.3', '2', '1', '2-10', '', '']]]),
      cat('fumbles', ['FUM', 'LOST', 'REC'], [['1', 'Quarterback', ['2', '1', '1']]]),
      // a pick-six: the defensive TD column already includes it
      cat('defensive', ['TOT', 'SOLO', 'SACKS', 'TFL', 'PD', 'QB HTS', 'TD'], [['5', 'Corner', ['4', '3', '0', '0', '2', '0', '1']], ['6', 'End', ['3', '2', '2', '1', '0', '2', '0']]]),
      cat('interceptions', ['INT', 'YDS', 'TD'], [['5', 'Corner', ['1', '40', '1']]]),
      cat('kickReturns', ['NO', 'YDS', 'AVG', 'LONG', 'TD'], [['8', 'Returner', ['2', '120', '60', '100', '1']]]),
    ] },
    { team: { id: '9' }, statistics: [cat('fumbles', ['FUM', 'LOST', 'REC'], [['70', 'Their back', ['1', '1', '0']]])] },
  ] } };
  const acc = parse.newAcc();
  parse.addGame('football', acc, sum, '17', 'g1', { real: { us: 31, them: 10 } });
  assert.equal(acc.players['5'].t.defTD, 1, 'pick-six counted once');
  assert.equal(acc.players['1'].t.fumLost, 1);
  assert.deepEqual(acc.team.dst, { dstGames: 1, dstSack: 2, dstInt: 1, dstFr: 1, dstTd: 2, paPts: 4, pa: 10 }, 'D/ST: our sacks and picks, their lost fumble, pick-six + return TD, 10 allowed');
  const players = pool.build('nfl', acc, { positions: { 1: 'QB', 5: 'CB', 6: 'DE', 8: 'WR' }, games: 1, team: { id: '17', short: 'Patriots' } });
  assert.ok(!players.some((p) => p.id === '5' || p.id === '6'), 'individual defenders live in the D/ST');
  const dst = players.find((p) => p.elig.includes('DST'));
  assert.equal(dst.name, 'Patriots D/ST');
  assert.equal(dst.ppg, 2 + 2 + 2 + 12 + 4);
});

test('parse: NHL shots come from S (SOG is shootout goals); goalie wins and shutouts from the real score', () => {
  const L = ['BS', 'HT', 'TK', '+/-', 'TOI', 'PPTOI', 'SHTOI', 'ESTOI', 'SHFT', 'G', 'YTDG', 'A', 'S', 'SM', 'SOG', 'FW', 'FL', 'FO%', 'GV', 'PN', 'PIM'];
  const GL = ['GA', 'SA', 'SOS', 'SOSA', 'SV', 'SV%', 'ESSV', 'PPSV', 'SHSV', 'TOI', 'YTDG', 'PIM'];
  const sum = (ga) => ({ boxscore: { players: [{ team: { id: '5' }, statistics: [
    { name: 'forwards', labels: L, athletes: [{ athlete: ath(1, 'Winger'), stats: ['0', '0', '0', '1', '18:00', '', '', '', '20', '1', '1', '1', '4', '0', '0', '0', '0', '0', '0', '0', '0'] }] },
    { name: 'goalies', labels: GL, athletes: [{ athlete: ath(2, 'Keeper'), stats: [String(ga), '30', '0', '0', String(30 - ga), '', '', '', '', '60:00', '0', '0'] }] },
  ] }] } });
  const acc = parse.newAcc();
  parse.addGame('hockey', acc, sum(0), '5', 'g1', { real: { us: 3, them: 0 } });
  parse.addGame('hockey', acc, sum(4), '5', 'g2', { real: { us: 2, them: 4 } });
  assert.equal(acc.players['1'].t.sog, 8, 'shots from S');
  assert.equal(acc.players['2'].t.w, 1);
  assert.equal(acc.players['2'].t.so, 1);
});

test('parse: MLB doubles, triples and steals are matched by name from the notes; ambiguous names are counted, not guessed', () => {
  const bat = (rows) => ({ type: 'batting', labels: ['H-AB', 'AB', 'R', 'H', 'RBI', 'HR', 'BB', 'K'], athletes: rows });
  const sum = { boxscore: {
    players: [{ team: { id: '10' }, statistics: [
      bat([
        { athlete: ath(1, 'Derek Jeter'), position: { abbreviation: 'SS' }, stats: ['2-4', '4', '1', '2', '0', '0', '0', '1'] },
        { athlete: ath(2, 'Randy Johnson'), position: { abbreviation: 'LF' }, stats: ['1-4', '4', '0', '1', '1', '0', '0', '0'] },
        { athlete: ath(3, 'Reed Johnson'), position: { abbreviation: 'RF' }, stats: ['1-3', '3', '0', '1', '0', '0', '1', '0'] },
      ]),
      { type: 'pitching', labels: ['IP', 'H', 'R', 'ER', 'BB', 'K', 'HR', 'PC-ST', 'ERA', 'PC'], athletes: [
        { athlete: ath(9, 'Ace Starter'), stats: ['7.0', '4', '1', '1', '1', '9', '0', '', '', ''], notes: [{ type: 'pitchingDecision', text: 'W, 5-2' }] },
        { athlete: ath(8, 'Closer Guy'), stats: ['1.0', '0', '0', '0', '0', '2', '0', '', '', ''], notes: [{ type: 'pitchingDecision', text: 'S, 12' }] }] },
    ] }],
    teams: [{ team: { id: '10' }, details: [{ name: 'battingDetails', stats: [
      { name: 'doubles', displayValue: 'D Jeter 2 (10, Smith 2); Ra Johnson (3, Smith)' },
      { name: 'triples', displayValue: 'Johnson (1, Smith)' }, // two Johnsons batted: ambiguous
      { name: 'stolenBases', displayValue: 'D Jeter (5, 2nd base off B Neal/J Varitek)' },
    ] }] }],
  } };
  const acc = parse.newAcc();
  parse.addGame('baseball', acc, sum, '10', 'g1');
  assert.equal(acc.players['1'].t.d2, 2, '"D Jeter 2" is two doubles');
  assert.equal(acc.players['2'].t.d2, 1, '"Ra Johnson" is Randy, not Reed');
  assert.equal(acc.players['1'].t.sb, 1);
  assert.equal(acc.players['2'].t.d3 || 0, 0);
  assert.equal(acc.players['3'].t.d3 || 0, 0, 'ambiguous "Johnson" is credited to nobody');
  assert.equal(acc.team.unmatched, 1);
  assert.equal(acc.players['9'].t.w, 1);
  assert.equal(acc.players['9'].t.gs, 1, 'first pitcher listed started');
  assert.equal(acc.players['8'].t.sv, 1);
  // Pure pitchers make the pool with their roles (they have no fielding position).
  const players = pool.build('mlb', acc);
  assert.deepEqual(players.find((p) => p.id === '9').elig, ['SP']);
  assert.deepEqual(players.find((p) => p.id === '8').elig, ['RP']);
  assert.equal(players.find((p) => p.id === '9').ppg, 21 - 4 - 2 - 1 + 9 + 2, '7 IP, 4 H, 1 ER, 1 BB, 9 K, W');
  assert.ok(players.find((p) => p.id === '1').elig.includes('SS'));
});

test('parse: soccer clean sheets come from the real score, not the feed\'s GA field; own goals count', () => {
  const sum = (ga, og = 0) => ({ rosters: [{ team: { id: '359' }, roster: [{ athlete: ath(1, 'Keeper'), starter: true, position: { abbreviation: 'G' }, stats: [{ abbreviation: 'APP', value: 1 }, { abbreviation: 'GA', value: ga }, { abbreviation: 'SV', value: 3 }, { abbreviation: 'OG', value: og }] }] }] });
  const acc = parse.newAcc();
  parse.addGame('soccer', acc, sum(0, 1), '359', 'm1', { real: { us: 2, them: 1 } }); // feed says 0, team conceded 1
  parse.addGame('soccer', acc, sum(0), '359', 'm2', { real: { us: 1, them: 0 } });
  assert.equal(acc.players['1'].t.cs, 1);
  assert.equal(acc.players['1'].t.gaStart, 1);
  assert.equal(acc.players['1'].t.og, 1);
  assert.equal(parse.soccerGroup('CD-L'), 'DEF');
  assert.equal(parse.soccerGroup('DM'), 'MID');
  assert.equal(parse.soccerGroup('CF-R'), 'FWD');
});

// ---------- history (fake fetch) ----------
function fakeEspn({ events, lines, failing = new Set(), logs = {}, colleges = {}, teams = {} }) {
  return async (url) => {
    if (url.includes('/standings')) return { children: [{ standings: { entries: Array.from({ length: 12 }, (_, i) => ({ team: { id: String(i + 1), displayName: i ? `Team ${i}` : 'Test  City Testers', abbreviation: i ? `T${i}` : 'TST' }, stats: [{ name: 'wins', value: i ? 6 : 10 }, { name: 'losses', value: i ? 6 : 1 }, { name: 'pointsFor', value: 1200 }, { name: 'pointsAgainst', value: 1150 }] })) } }] };
    if (url.includes('/schedule')) return { events };
    if (url.includes('summary?event=')) {
      const id = url.split('event=')[1];
      if (failing.has(id)) throw new Error('ESPN 429');
      return typeof lines === 'function' ? lines(id) : lines;
    }
    const log = url.match(/athletes\/([^/]+)\/statisticslog/);
    if (log) { if (failing.has(`log:${log[1]}`)) throw new Error('ESPN 503'); return logs[log[1]] || null; }
    const athlete = url.match(/athletes\/([^/?]+)$/);
    if (athlete) return colleges[athlete[1]] ? { college: { $ref: `http://sports.core.api.espn.com/v2/colleges/${colleges[athlete[1]]}?lang=en` } } : { id: athlete[1] };
    const college = url.match(/colleges\/(\w+)/);
    if (college) return { id: college[1], name: `College ${college[1]}` };
    const team = url.match(/seasons\/(\d+)\/teams\/(\w+)/);
    if (team) return teams[`${team[1]}|${team[2]}`] ? { displayName: teams[`${team[1]}|${team[2]}`] } : null;
    return null;
  };
}
const comp = (id, date, us, them, home = true) => ({
  id, date, seasonType: { type: 2 },
  competitions: [{ status: { type: { completed: true, state: 'post' } }, competitors: [
    { homeAway: home ? 'home' : 'away', team: { id: '1', abbreviation: 'TST' }, score: { value: us } },
    { homeAway: home ? 'away' : 'home', team: { id: '2', abbreviation: 'OPP', displayName: 'Opp  City' }, score: { value: them } }] }],
});
const NBA_LINE = ['30', '20', '8-15', '1-3', '3-4', '6', '5', '2', '1', '0', '1', '5', '2', '+4'];
const logOf = (...seasons) => ({ entries: seasons.map(([s, t]) => ({ season: { $ref: `http://x/leagues/nba/seasons/${s}?lang=en` }, statistics: [{ type: 'total' }, { type: 'team', team: { $ref: `http://x/leagues/nba/seasons/${s}/teams/${t}?lang=en` } }] })) });

test('history: builds a team-season with fantasy PPG and verified chemistry (fake fetch)', async () => {
  const events = Array.from({ length: 12 }, (_, i) => comp(`e${i}`, `2010-01-${String(i + 1).padStart(2, '0')}T00:00Z`, 100 + i, 95));
  events.push(comp('stub', '2010-01-05T03:00Z', 0, 0)); // ESPN's duplicate 0-0 "final" of e4
  events.push({ ...comp('pp', '2010-01-20T00:00Z', 0, 0), competitions: [{ ...comp('pp', '', 0, 0).competitions[0], status: { type: { completed: false, state: 'post', name: 'STATUS_POSTPONED' } } }] });
  const lines = (id) => (id === 'stub' ? nbaSummary('1', []) : nbaSummary('1', [['10', 'Ace', 'PG', NBA_LINE], ['11', 'Wing', 'SF', NBA_LINE], ['12', 'Big', 'C', NBA_LINE]], [['50', 'Enemy', 'C', NBA_LINE]]));
  const fetchJson = fakeEspn({
    events, lines,
    // Ace and Wing: same college, and both on team 7 in 2008. Big was on team 7 in 2006 (not with them).
    // A shared season in 2010 itself (the rolled season) never counts.
    logs: { 10: logOf([2008, 7], [2009, 8], [2010, 1]), 11: logOf([2008, 7], [2010, 1]), 12: logOf([2006, 7], [2010, 1]) },
    colleges: { 10: 'c1', 11: 'c1' }, teams: { '2008|7': 'Old Town Oldies' },
  });
  const h = createHistory({ fetchJson, cacheDir: null, concurrency: 3 });
  const ts = await h.teamSeason('nba', 2010, '1');
  assert.equal(ts.schedule.length, 12, '0-0 duplicate stub and postponed game dropped');
  assert.equal(ts.coverage.boxScores, 12);
  assert.deepEqual([ts.record.w, ts.record.l], [12, 0], 'record recounted from real results when standings don\'t add up');
  assert.equal(ts.schedule[0].opp.name, 'Opp City', 'padded names tidied');
  assert.deepEqual(ts.players.map((p) => p.name).sort(), ['Ace', 'Big', 'Wing'], 'only the rolled team\'s players');
  const ace = ts.players.find((p) => p.name === 'Ace');
  assert.equal(ace.gp, 12);
  assert.equal(ace.ppg, Math.round((fantasy.points('nba', 'G', { pts: 20, tpm: 1, reb: 6, ast: 5, stl: 1, blk: 0, tov: 2 }) * 12) / 12 * 100) / 100, 'PPG from that season\'s real box scores');
  assert.equal(ts.bios['10'].college, 'College c1');
  const link = ts.pairs[chemistry.pairKey('10', '11')];
  assert.deepEqual(link.kinds.map((k) => k.kind), ['college', 'teammates']);
  assert.equal(link.kinds[1].seasons, 1, 'only 2008 counts: 2010 is the rolled season');
  assert.match(link.kinds[1].text, /Old Town Oldies/, 'period-correct team name');
  assert.equal(ts.pairs[chemistry.pairKey('10', '12')], undefined, 'same franchise, different years: not teammates');
  assert.equal(ts.coverage.history.known, 3);
  const again = await h.teamSeason('nba', 2010, '1');
  assert.equal(again, ts, 'cached');
});

test('history: wrong-score duplicates and empty stubs are dropped; failed fetches (box scores or histories) are never cached or drafted', async () => {
  const day = (i) => `2010-01-${String(i + 1).padStart(2, '0')}`;
  const events = Array.from({ length: 12 }, (_, i) => comp(`e${i}`, `${day(i)}T20:00Z`, 100, 90 + i));
  events.push(comp('ghost3', `${day(3)}T20:00Z`, 70, 120, false)); // Fulham 2009-10: second copy at the same kickoff, other venue and score, no lines
  events.push(comp('stub', '2010-01-20T17:00Z', 0, 0)); // Nets 1999-00: 0-0 placeholder on its own day, no lines
  const failing = new Set(['e7', 'log:10']);
  const lines = (id) => (id === 'ghost3' || id === 'stub' ? nbaSummary('1', []) : nbaSummary('1', [['10', 'Ace', 'PG', NBA_LINE]]));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-hist-'));
  try {
    const h = createHistory({ fetchJson: fakeEspn({ events, lines, failing }), cacheDir: dir, concurrency: 4 });
    const p = await h.teamSeason('nba', 2010, '1');
    assert.equal(p.partial, true, 'a failed download marks the season partial');
    assert.equal(p.coverage.failed.boxScores, 1);
    assert.equal(p.coverage.failed.bios, 1, 'a failed career history counts too');
    assert.equal(p.coverage.boxScores, 11, 'the failed game is not counted as a box score');
    assert.equal(p.players[0].gp, 11, 'a missing game is not treated as a zero-production game');
    assert.ok(!fs.readdirSync(dir).some((f) => f.includes('-1.json')), 'a partial season is never written to the cache');

    const svc = createService({ store: createStore(null), history: { standings: () => h.standings('nba', 2010), teamSeason: () => h.teamSeason('nba', 2010, '1') }, random: () => 0 });
    await assert.rejects(svc.roll('u-1', 'nba'), (e) => e.code === 503);

    failing.clear();
    const ts = await h.teamSeason('nba', 2010, '1');
    assert.equal(ts.partial, false, 'refetched once ESPN recovers');
    assert.equal(ts.schedule.length, 12, 'duplicate copy and empty 0-0 stub dropped');
    assert.equal(ts.schedule[3].real.them, 93, 'the real copy of the duplicated game was kept');
    assert.deepEqual([ts.coverage.boxScores, ts.coverage.games], [12, 12]);
    assert.equal(ts.bios['10'].known, false, 'no log on ESPN (404): history unknown, nothing invented');
    assert.ok(fs.readdirSync(dir).some((f) => f.includes('-1.json')), 'complete season cached');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('history: same-time copies are one game; real doubleheaders and home-and-home series are two', async () => {
  const at = (id, iso, us, them, opp = '2') => ({ ...comp(id, iso, us, them), competitions: [{ ...comp(id, iso, us, them).competitions[0], competitors: [{ homeAway: 'home', team: { id: '1' }, score: { value: us } }, { homeAway: 'away', team: { id: opp }, score: { value: them } }] }] });
  const events = Array.from({ length: 10 }, (_, i) => at(`e${i}`, `2003-06-${String(i + 1).padStart(2, '0')}T23:05Z`, 5, 3, String(3 + i)));
  events.push(at('tb1', '2003-05-03T17:05Z', 6, 8), at('tb2', '2003-05-03T17:05Z', 6, 8)); // 2003 Tigers: the same game listed twice
  events.push(at('dh1', '2003-05-01T17:05Z', 2, 5), at('dh2', '2003-05-01T20:35Z', 4, 6)); // a real doubleheader, 3.5 hours apart
  events.push(at('hh1', '2003-05-10T23:00Z', 3, 1), at('hh2', '2003-05-11T18:00Z', 1, 2)); // home-and-home, same UTC date
  const BAT = { type: 'batting', labels: ['H-AB', 'AB', 'R', 'H', 'RBI', 'HR', 'BB', 'K'], athletes: [{ athlete: ath(7, 'Hitter One'), position: { abbreviation: 'CF' }, stats: ['1-4', '4', '1', '1', '1', '0', '0', '1'] }] };
  const h = createHistory({ fetchJson: fakeEspn({ events, lines: { boxscore: { players: [{ team: { id: '1' }, statistics: [BAT] }] } } }), cacheDir: null });
  const ts = await h.teamSeason('mlb', 2010, '1');
  const ids = ts.schedule.map((g) => g.id);
  assert.equal(ids.filter((x) => x.startsWith('tb')).length, 1, 'exact copy dropped');
  assert.deepEqual(ids.filter((x) => x.startsWith('dh')), ['dh1', 'dh2'], 'doubleheader kept');
  assert.deepEqual(ids.filter((x) => x.startsWith('hh')), ['hh1', 'hh2'], 'home-and-home kept');
  assert.equal(ts.schedule.length, 15);
});

test('history: soccer national-team links need a shared competition season on a team ESPN flags isNational', async () => {
  const events = Array.from({ length: 12 }, (_, i) => comp(`m${i}`, `2009-09-${String(i + 1).padStart(2, '0')}T15:00Z`, 2, 1));
  const roster = (id) => ({ rosters: [{ team: { id: '1' }, roster: [1, 2, 3].map((n) => ({ athlete: ath(n, `Player ${n}`), starter: true, position: { abbreviation: 'CM' }, stats: [{ abbreviation: 'APP', value: 1 }] })) }] });
  const entry = (lg, s, t) => ({ season: { $ref: `http://x/sports/soccer/leagues/${lg}/seasons/${s}?lang=en` }, statistics: [{ type: 'total', team: { $ref: `http://x/sports/soccer/leagues/${lg}/seasons/${s}/teams/${t}?lang=en` } }] });
  const logs = {
    1: { entries: [entry('fifa.world', 2006, '448'), entry('fifa.friendly', 2006, '999')] },
    2: { entries: [entry('fifa.world', 2006, '448'), entry('fifa.friendly', 2006, '999')] },
    3: { entries: [entry('fifa.world', 2002, '448')] }, // England too, but never in the same competition season
  };
  const base = fakeEspn({ events, lines: roster, logs });
  const fetchJson = async (url) => {
    const t = url.match(/soccer\/teams\/(\w+)$/);
    if (t) return { displayName: t[1] === '448' ? 'England' : 'Club XI', isNational: t[1] === '448' };
    return base(url);
  };
  const h = createHistory({ fetchJson, cacheDir: null, concurrency: 3 });
  const ts = await h.teamSeason('epl', 2009, '1');
  const l12 = ts.pairs[chemistry.pairKey('1', '2')];
  assert.deepEqual(l12.kinds.map((k) => k.kind), ['national']);
  assert.match(l12.kinds[0].text, /England: 2006 World Cup/);
  assert.equal(ts.pairs[chemistry.pairKey('1', '3')], undefined, 'same country, different tournaments: no link');
  assert.ok(!JSON.stringify(ts.pairs).includes('Club XI'), 'a non-national team in a friendly is ignored');
});

// ---------- chemistry ----------
test('chemistry: verified links only, bonuses in PPG, capped, nothing double counted', () => {
  const A = { college: { id: 'c1', name: 'State U' }, past: [{ s: 2001, t: '5' }, { s: 2002, t: '5' }, { s: 2003, t: '5' }, { s: 2004, t: '5' }, { s: 2002, t: '6' }], nat: [] };
  const B = { college: { id: 'c1', name: 'State U' }, past: [{ s: 2001, t: '5' }, { s: 2002, t: '5' }, { s: 2003, t: '5' }, { s: 2004, t: '5' }, { s: 2002, t: '6' }], nat: [] };
  const C = { college: { id: 'c2' }, past: [{ s: 2001, t: '7' }], nat: [] };
  const p = chemistry.pair(A, B);
  // college 1% + teammates (4 distinct seasons, capped at 3 -> 1.5%) = 2.5%, capped at the 2% pair cap
  assert.equal(p.kinds.find((k) => k.kind === 'teammates').seasons, 4, '2002 on two franchises counts once');
  assert.equal(p.kinds.find((k) => k.kind === 'teammates').rate, 0.015, 'seasons beyond 3 add nothing');
  assert.equal(p.rate, 0.02);
  assert.equal(chemistry.pair(A, C), null, 'no shared college or season');
  assert.equal(chemistry.pair(A, { college: null, past: [{ s: 2001, t: '9' }], nat: [] }), null, 'same year, different franchise is not a connection');
  // Bonuses are a share of each player's own PPG, and a player's total is capped at 3%.
  const pairs = {};
  const ids = ['a', 'b', 'c', 'd'];
  for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) pairs[chemistry.pairKey(ids[i], ids[j])] = { rate: 0.02, kinds: [{ kind: 'college', text: 'x' }] };
  const out = chemistry.compute(ids.map((id) => ({ id, name: id, ppg: 20 })), pairs);
  assert.equal(out.players.a.rate, 0.03, 'three links at 2% each are capped at 3%');
  assert.equal(out.players.a.bonus, 0.6, '3% of 20 PPG');
  assert.equal(out.total, 2.4);
  assert.equal(out.links.length, 6, 'each pair once');
  // Chemistry can't rescue a weak player: 8% of a little is a little.
  assert.ok(chemistry.compute([{ id: 'a', ppg: 2 }, { id: 'b', ppg: 2 }], pairs).total < 0.5);
  // What a candidate would add.
  const d = chemistry.delta([{ id: 'a', name: 'A', ppg: 20 }], { id: 'b', name: 'B', ppg: 10 }, pairs);
  assert.equal(d.ppg, Math.round((20 * 0.02 + 10 * 0.02) * 100) / 100);
  assert.deepEqual(d.with.map((w) => w.id), ['a']);
});

// ---------- normalization ----------
test('norms: percentile within the sport\'s own distribution, era-adjusted, monotonic, keeps rising past the best roster seen', () => {
  const n = TEST_NORMS.sports.nba;
  const mid = norms.strength('nba', 150, 100), hi = norms.strength('nba', 200, 100), top = norms.strength('nba', 400, 100);
  assert.ok(Math.abs(mid.pct - 0.5) < 0.03, `median roster ~ 50th percentile (${mid.pct})`);
  assert.ok(hi.z > mid.z && top.z > hi.z, 'more PPG, more strength');
  assert.ok(top.z <= norms.ZMAX && top.z > 3.5, 'past the sample, still rising (smoothed tail), clamped');
  assert.ok(norms.strength('nba', 220, 100).z > norms.strength('nba', 210, 100).z, 'elite rosters still separate in the tail');
  // Era: the same raw PPG in a higher-scoring league is worth less.
  assert.ok(norms.strength('nba', 160, 110).z < norms.strength('nba', 160, 95).z);
  assert.equal(norms.eraFactor('nba', n.Lref), 1);
  // Sports are never compared on raw PPG: 150 is average in the NBA but huge in the NFL.
  assert.ok(norms.strength('nfl', 150, 22).z > norms.strength('nba', 150, 100).z + 3);
});

test('norms.json: every sport has a calibrated distribution and win model', () => {
  const file = JSON.parse(fs.readFileSync(norms.FILE, 'utf8'));
  for (const key of Object.keys(SPORTS)) {
    const n = file.sports[key];
    assert.ok(n, `${key} calibrated`);
    assert.ok(n.sample.length >= 200 && n.sample.every((x, i) => i === 0 || x >= n.sample[i - 1]), `${key} sample sorted`);
    assert.ok(n.h > 0 && n.b > 0 && Number.isFinite(n.z0) && n.Lref > 0 && n.alpha >= 0, `${key} constants`);
    for (const s of SPORTS[key].slots) for (const g of s.elig) assert.ok(Number.isFinite(n.repl[g]), `${key} replacement level for ${g}`);
  }
});

// ---------- squad rules ----------
test('squad: duplicates, players from other rosters and wrong positions are rejected', () => {
  const ts = fakeNbaSeason();
  const P = ts.players;
  let c = squad.check('nba', P, { 'G.0': 'p1', 'G.1': 'p1' });
  assert.match(c.errors[0], /already in your squad/);
  c = squad.check('nba', P, { 'G.0': 'someone-else' });
  assert.match(c.errors[0], /wasn't on this team's roster/);
  c = squad.check('nba', P, { 'C.0': 'p1' });
  assert.match(c.errors[0], /can't fill a Center slot/);
  c = squad.check('nba', P, { 'BENCH.0': 'p7' });
  assert.deepEqual(c.errors, [], 'bench takes anyone');
  c = squad.check('nba', P, { 'G.0': 'p1' }, { complete: true });
  assert.match(c.errors[0], /Still to fill: 1 Guard, 2 Forwards, 1 Center, 3 bench spots/);
  c = squad.check('nba', P, { 'G.0': 'p1', 'C.0': 'p1' });
  assert.match(c.errors[0], /already in your squad/, 'a duplicate is reported as a duplicate first');
  c = squad.check('nba', P, { 'XX.0': 'p1' });
  assert.match(c.errors[0], /no XX.0 slot/);
  const best = squad.best('nba', P);
  assert.equal(squad.check('nba', P, best, { complete: true }).errors.length, 0);
  assert.equal(new Set(Object.values(best)).size, 8);
  // resolve carries each pick's model PPG in the slot he fills
  const res = squad.resolve('nba', P, best);
  assert.ok(res.every((s) => s.ppg === s.player.pg[s.group]));
});

// ---------- simulator ----------
test('sim: combined PPG = sum of picks + chemistry; seeded; every game counted', () => {
  const ts = fakeNbaSeason();
  const res = squad.resolve('nba', ts.players, squad.best('nba', ts.players));
  const prof = sim.profile('nba', ts, res);
  const sumPPG = res.reduce((a, s) => a + s.ppg, 0);
  assert.ok(Math.abs(prof.base - sumPPG) < 0.01, 'base is the sum of the picks\' PPG');
  assert.ok(prof.chem.total > 0, 'p1 + p4 and p2 + p5 have verified links');
  assert.ok(Math.abs(prof.combined - (sumPPG + prof.chem.total)) < 0.02);
  const a = sim.simulateSeason({ sportKey: 'nba', ts, res, seed: 'x:1' });
  const b = sim.simulateSeason({ sportKey: 'nba', ts, res, seed: 'x:1' });
  const c = sim.simulateSeason({ sportKey: 'nba', ts, res, seed: 'x:2' });
  assert.deepEqual(a.games.map((g) => [g.us, g.them]), b.games.map((g) => [g.us, g.them]), 'same seed, same season');
  assert.notDeepEqual(a.games.map((g) => g.us), c.games.map((g) => g.us), 'new seed, new season');
  assert.equal(a.games.length, 82);
  const r = a.record;
  assert.equal(r.w + r.l + r.t + r.otl, 82);
  for (const g of a.games) assert.equal(g.res, g.us > g.them ? 'W' : 'L', 'no ties in the NBA');
  assert.equal(a.perfect, r.w === 82);
  assert.equal(a.players.length, 8);
  assert.ok(a.games.every((g) => g.star && g.star.name));
  // Simulated production is scored with the same formula and lands near the real PPG.
  const p1 = a.players.find((p) => p.id === 'p1');
  assert.ok(Math.abs(p1.simPpg - p1.ppg) / p1.ppg < 0.35, `p1 sim ${p1.simPpg} vs real ${p1.ppg}`);
  assert.equal(a.team.combined, prof.combined);
  assert.ok(a.closest.length === 3 && a.maxLoseStreak >= 0 && a.mvp && a.weakest);
});

test('sim: stronger rosters win more, chemistry helps a little, and nothing is guaranteed', () => {
  const ts = fakeNbaSeason();
  const strong = squad.resolve('nba', ts.players, squad.best('nba', ts.players));
  const weak = squad.resolve('nba', ts.players, WEAK);
  const s = sim.odds({ sportKey: 'nba', ts, res: strong, runs: 200, seed: 's' });
  const w = sim.odds({ sportKey: 'nba', ts, res: weak, runs: 200, seed: 's' });
  assert.ok(s.profile.combined > w.profile.combined);
  assert.ok(s.avgWins > w.avgWins + 10, `strong ${s.avgWins} vs weak ${w.avgWins}`);
  const noChem = sim.odds({ sportKey: 'nba', ts, res: strong, runs: 2000, seed: 'c', chem: false });
  const withChem = sim.odds({ sportKey: 'nba', ts, res: strong, runs: 2000, seed: 'c' });
  assert.ok(withChem.profile.strength.s > noChem.profile.strength.s, 'chemistry raises roster strength');
  assert.ok(withChem.avgWins >= noChem.avgWins, `chemistry doesn't cost wins (${withChem.avgWins} vs ${noChem.avgWins})`);
  assert.ok(withChem.avgWins - noChem.avgWins < (s.avgWins - w.avgWins) / 4, 'and it\'s worth far less than the gap between a strong and a weak roster');
  // Randomness: even the strong roster loses games and doesn't go 82-0 every time.
  assert.ok(s.low < s.high, 'win totals vary from season to season');
  assert.ok(s.chance < 1);
  // A historically dominant roster (99.9th percentile) should still drop games.
  const ts2 = fakeNbaSeason();
  for (const p of ts2.players) { p.pg = Object.fromEntries(Object.keys(p.pg).map((g) => [g, p.pg[g] * 2.2])); }
  const elite = sim.odds({ sportKey: 'nba', ts: ts2, res: squad.resolve('nba', ts2.players, squad.best('nba', ts2.players)), runs: 200, seed: 'e' });
  assert.ok(elite.avgWins > s.avgWins && elite.avgWins < 82, `elite averages ${elite.avgWins}`);
});

test('sim: the schedule is the real one (length, opponents, home/away); MLB rotates its starters', () => {
  const ts = fakeNbaSeason({ games: 66 }); // a lockout-length season stays 66 games
  const res = squad.resolve('nba', ts.players, squad.best('nba', ts.players));
  const r = sim.simulateSeason({ sportKey: 'nba', ts, res, seed: 'len' });
  assert.equal(r.games.length, 66);
  assert.deepEqual(r.games.map((g) => g.opp.abbr), ts.schedule.map((g) => g.opp.abbr));
  assert.deepEqual(r.games.map((g) => g.home), ts.schedule.map((g) => g.home));
  // MLB: the day's starter changes that game's strength.
  const prof = { perGame: [1, -1], strength: { s: 0 } };
  const E = sim.expectations('mlb', { league: { avgFor: 4.5 }, schedule: [{ home: true }, { home: true }] }, prof);
  assert.ok(E[0].us > E[1].us && E[0].them < E[1].them, 'ace day vs. fourth-starter day');
});

test('sim: NHL uses each era\'s overtime rules', () => {
  assert.deepEqual(sim.nhlRules(1996), { ot: 5, rate: 1, shootout: false, otLoss: 'L' });
  assert.equal(sim.nhlRules(2003).otLoss, 'OTL');
  assert.equal(sim.nhlRules(2010).shootout, true);
  assert.equal(sim.nhlRules(2020).rate, 2, '3-on-3 OT');
  const R = sim.rng('ties');
  const even = { us: 2.5, them: 2.5 };
  let ties1996 = 0, ties2010 = 0;
  for (let i = 0; i < 2000; i++) {
    if (sim.playGame('nhl', 1996, even, R).res === 'T') ties1996++;
    if (sim.playGame('nhl', 2010, even, R).res === 'T') ties2010++;
  }
  assert.ok(ties1996 > 50, 'ties happen before the shootout era');
  assert.equal(ties2010, 0, 'shootout era never ties');
});

test('sim: soccer allows draws and the objective is going unbeaten', () => {
  const R = sim.rng('epl');
  let draws = 0;
  for (let i = 0; i < 500; i++) if (sim.playGame('epl', 2010, { us: 1.3, them: 1.3 }, R).res === 'T') draws++;
  assert.ok(draws > 60);
  assert.equal(sim.tier('epl', { w: 30, l: 0, t: 8, otl: 0 }, 38).id, 'unbeaten');
  assert.equal(sim.tier('epl', { w: 38, l: 0, t: 0, otl: 0 }, 38).id, 'perfect');
  assert.equal(sim.tier('nfl', { w: 16, l: 1, t: 0, otl: 0 }, 17).id, 'close');
  assert.equal(sim.tier('nba', { w: 75, l: 7, t: 0, otl: 0 }, 82).id, 'record');
});


// ---------- the draft: one pick per random team-season ----------
// A fake history with many team-seasons. Each roster is a synthetic NBA team
// with its own player ids, except one star athlete ("star") who played in
// every season (the same person can't be drafted twice). p4 on every roster
// went to the same college as the star.
function fakeHistory() {
  const calls = { teamSeason: 0 };
  let failing = false;
  const roster = (season, teamId) => {
    const ts = fakeNbaSeason({ season });
    ts.team = { id: String(teamId), name: `Team ${teamId}`, abbr: `T${teamId}`, logo: null };
    ts.seasonLabel = SPORTS.nba.seasonLabel(season);
    ts.league = { avgFor: 95 + (season % 10), teams: 30, slug: 'nba' };
    const rename = (id) => (id === 'p1' ? 'star' : `${season}-${teamId}-${id}`);
    ts.players = ts.players.map((p) => ({ ...p, id: rename(p.id), name: p.id === 'p1' ? 'Star Player' : `${p.name} (${season} T${teamId})` }));
    ts.chemBios = Object.fromEntries(ts.players.map((p) => [p.id, { college: p.id === 'star' || p.id.endsWith('-p4') ? { id: 'c1', name: 'State U' } : null, past: [], nat: [], log: true }]));
    ts.bios = Object.fromEntries(ts.players.map((p) => [p.id, { college: ts.chemBios[p.id].college?.name || null, known: true }]));
    ts.pairs = {};
    return ts;
  };
  const cache = new Map();
  return {
    calls,
    fail(on) { failing = on; },
    standings: async () => ({ teams: [1, 2, 3, 4].map((i) => ({ id: String(i), name: `Team ${i}`, gp: 82, pf: 8200, pa: 8000 })), avgFor: 100 }),
    teamSeason: async (sport, season, id) => {
      calls.teamSeason++;
      if (failing) throw new Error('ESPN 503');
      const k = `${season}|${id}`;
      if (!cache.has(k)) cache.set(k, roster(season, id));
      return cache.get(k);
    },
    names: async () => ({ teams: {}, nat: {} }),
  };
}
function draftService({ seed = 'draft', store = createStore(null), history = fakeHistory() } = {}) {
  let t = 1_700_000_000_000;
  const R = sim.rng(seed);
  return { svc: createService({ store, history, random: R.next, now: () => t++ }), store, history };
}
const ALICE = 'alice-0000-0000-0000', BOB = 'bob-00000-0000-0000';
const rollKey = (v) => `${v.attempt.roll.season}|${v.attempt.roll.team.abbr}`;
// The best player on the current roll who fits an open slot.
const bestOpen = (v) => {
  const open = v.attempt.open;
  const fits = (p) => v.rules.slots.some((s) => open.some((k) => k.startsWith(`${s.id}.`)) && s.elig.some((g) => p.elig.includes(g)));
  return v.pool.players.filter((p) => fits(p) && !v.attempt.picks.some((x) => x.playerId === p.id)).sort((a, b) => b.ppg - a.ppg)[0];
};

test('draft: the first roll is a real team-season; each pick rolls a new one; picks come only from the current roll', async () => {
  const { svc } = draftService();
  const v1 = await svc.start(ALICE, 'nba');
  assert.equal(v1.attempt.roll.n, 1);
  assert.ok(v1.attempt.roll.season && v1.attempt.roll.team.name, 'team and season rolled');
  assert.equal(v1.pool.seasonLabel, v1.attempt.roll.seasonLabel, 'the roster shown is the rolled one');
  assert.equal(v1.attempt.rerollUsed, false);
  assert.equal(v1.attempt.picks.length, 0);
  const id = v1.attempt.id;

  const p1 = bestOpen(v1);
  const v2 = await svc.pick(ALICE, id, { playerId: p1.id, roll: 1 });
  assert.equal(v2.attempt.picks.length, 1);
  assert.equal(v2.attempt.picks[0].seasonLabel, v1.attempt.roll.seasonLabel, 'the pick remembers where it came from');
  assert.equal(v2.attempt.roll.n, 2, 'a new roll after the pick');
  assert.notEqual(rollKey(v2), rollKey(v1), 'a different team-season');
  assert.ok(v2.pool.players.every((p) => !p.id.startsWith(`${v1.attempt.roll.season}-${v1.attempt.roll.teamId}`)), 'a genuinely new roster from the server');
  assert.equal(v2.attempt.rerollUsed, false, 'automatic rolls don\'t use the reroll');

  // A player from the old roll isn't on the new one.
  const oldPlayer = v1.pool.players.find((p) => p.id !== p1.id && p.id !== 'star');
  await assert.rejects(svc.pick(ALICE, id, { playerId: oldPlayer.id, roll: 2 }), /wasn't on the .* roster/);
  // Somebody else's challenge.
  await assert.rejects(svc.pick(BOB, id, { playerId: bestOpen(v2).id, roll: 2 }), /someone else's/);

  const p2 = bestOpen(v2);
  const v3 = await svc.pick(ALICE, id, { playerId: p2.id, roll: 2 });
  assert.deepEqual(v3.attempt.picks.map((p) => p.playerId), [p1.id, p2.id], 'earlier picks stay, in order');
  assert.equal(v3.attempt.roll.n, 3);
  assert.equal(new Set([rollKey(v1), rollKey(v2), rollKey(v3)]).size, 3, 'no team-season repeats in a draft');
  assert.ok(v3.preview.combined > v2.preview.combined, 'combined PPG grows with each pick');
});

test('draft: one manual reroll, never a second; it swaps team and season, keeps the picks, and survives a refresh', async () => {
  const { svc, store, history } = draftService({ seed: 'reroll' });
  let v = await svc.start(ALICE, 'nba');
  const id = v.attempt.id;
  v = await svc.pick(ALICE, id, { playerId: bestOpen(v).id, roll: 1 });
  const before = v;
  const r = await svc.reroll(ALICE, id, { roll: before.attempt.roll.n });
  assert.equal(r.attempt.rerollUsed, true);
  assert.equal(r.attempt.roll.n, before.attempt.roll.n + 1);
  assert.notEqual(rollKey(r), rollKey(before), 'team and season replaced');
  assert.deepEqual(r.attempt.picks.map((p) => p.playerId), before.attempt.picks.map((p) => p.playerId), 'picks untouched, draft not reset');
  await assert.rejects(svc.reroll(ALICE, id, { roll: r.attempt.roll.n }), /already used your one reroll/);
  // Still unavailable after more automatic rolls.
  v = await svc.pick(ALICE, id, { playerId: bestOpen(r).id, roll: r.attempt.roll.n });
  assert.equal(v.attempt.rerollUsed, true);
  await assert.rejects(svc.reroll(ALICE, id, { roll: v.attempt.roll.n }), /already used your one reroll/);
  // A "refresh": a fresh service on the same stored data resumes exactly.
  const again = createService({ store, history, random: sim.rng('other').next });
  const fresh = await again.view(ALICE, id);
  assert.equal(fresh.attempt.rerollUsed, true);
  assert.equal(fresh.attempt.roll.n, v.attempt.roll.n);
  assert.equal(rollKey(fresh), rollKey(v));
  assert.deepEqual(fresh.attempt.picks.map((p) => p.playerId), v.attempt.picks.map((p) => p.playerId));
  await assert.rejects(again.reroll(ALICE, id, { roll: fresh.attempt.roll.n }), /already used your one reroll/);
});

test('draft: the same athlete can\'t be drafted twice, even from another season', async () => {
  const { svc } = draftService({ seed: 'dup' });
  let v = await svc.start(ALICE, 'nba');
  const id = v.attempt.id;
  v = await svc.pick(ALICE, id, { playerId: 'star', roll: 1 });
  assert.ok(v.pool.players.some((p) => p.id === 'star'), 'the star is on the next roster too (another season)');
  await assert.rejects(svc.pick(ALICE, id, { playerId: 'star', roll: v.attempt.roll.n }), /already in your squad/);
  // A chosen slot must be open and fit.
  await assert.rejects(svc.pick(ALICE, id, { playerId: bestOpen(v).id, roll: v.attempt.roll.n, slot: v.attempt.picks[0].key }), /already filled/);
  const center = v.pool.players.find((p) => p.elig.includes('C'));
  await assert.rejects(svc.pick(ALICE, id, { playerId: center.id, roll: v.attempt.roll.n, slot: 'G.1' }), /can't fill a Guard slot/);
});

test('draft: double clicks and racing requests can\'t draft twice or roll twice', async () => {
  const { svc, history } = draftService({ seed: 'race' });
  const v = await svc.start(ALICE, 'nba');
  const id = v.attempt.id;
  const p = bestOpen(v);
  const calls0 = history.calls.teamSeason;
  const results = await Promise.allSettled([
    svc.pick(ALICE, id, { playerId: p.id, roll: 1 }),
    svc.pick(ALICE, id, { playerId: p.id, roll: 1 }),
    svc.pick(ALICE, id, { playerId: v.pool.players.find((x) => x.id !== p.id).id, roll: 1 }),
  ]);
  assert.equal(results.filter((x) => x.status === 'fulfilled').length, 1, 'exactly one pick lands');
  for (const x of results.filter((y) => y.status === 'rejected')) assert.equal(x.reason.code, 409);
  const now = await svc.view(ALICE, id);
  assert.equal(now.attempt.picks.length, 1);
  assert.equal(now.attempt.roll.n, 2, 'exactly one new roll');
  assert.ok(history.calls.teamSeason - calls0 < 20);
  // Two rerolls at once: one wins, the reroll is used once.
  const rr = await Promise.allSettled([svc.reroll(ALICE, id, { roll: 2 }), svc.reroll(ALICE, id, { roll: 2 })]);
  assert.equal(rr.filter((x) => x.status === 'fulfilled').length, 1);
  assert.equal((await svc.view(ALICE, id)).attempt.roll.n, 3);
});

test('draft: a failed roster download never counts as a roll and never uses the reroll', async () => {
  const { svc, history, store } = draftService({ seed: 'fail' });
  history.fail(true);
  await assert.rejects(svc.start(ALICE, 'nba'), (e) => e.code === 503);
  assert.equal(Object.keys(store.db.attempts).length, 0, 'a failed first roll creates no challenge');
  history.fail(false);
  let v = await svc.start(ALICE, 'nba');
  const id = v.attempt.id;
  // ESPN goes down right after a pick: the pick stands, the next roll can be retried.
  const pick = bestOpen(v);
  const loadPick = await history.teamSeason('nba', v.attempt.roll.season, v.attempt.roll.teamId); // warm
  assert.ok(loadPick);
  // ESPN goes down for anything not already downloaded (cached rosters still load).
  const orig = history.teamSeason;
  const known = new Set([`${v.attempt.roll.season}|${v.attempt.roll.teamId}`]);
  history.teamSeason = async (sport, season, tid) => { if (known.has(`${season}|${tid}`)) return orig(sport, season, tid); throw new Error('ESPN 503'); };
  v = await svc.pick(ALICE, id, { playerId: pick.id, roll: 1 });
  assert.equal(v.attempt.picks.length, 1, 'the pick stands');
  assert.equal(v.attempt.roll, null);
  assert.equal(v.attempt.rollFailed, true, 'the UI is told to offer a retry');
  assert.equal(v.pool, undefined, 'no empty draft screen: no roster is shown');
  await assert.rejects(svc.nextRoll(ALICE, id), (e) => e.code === 503);
  history.teamSeason = orig;
  v = await svc.nextRoll(ALICE, id);
  assert.equal(v.attempt.roll.n, 2);
  assert.equal(v.attempt.rerollUsed, false, 'retrying an automatic roll isn\'t the reroll');
  // A manual reroll that fails keeps the current team and the reroll.
  const cur = await svc.view(ALICE, id);
  const keep = new Set([`${cur.attempt.roll.season}|${cur.attempt.roll.teamId}`, `${cur.attempt.picks[0].season}|${cur.attempt.picks[0].team.abbr.slice(1)}`]);
  history.teamSeason = async (sport, season, tid) => { if (keep.has(`${season}|${tid}`)) return orig(sport, season, tid); throw new Error('ESPN 503'); };
  await assert.rejects(svc.reroll(ALICE, id, { roll: 2 }), (e) => e.code === 503);
  history.teamSeason = orig;
  const after = await svc.view(ALICE, id);
  assert.equal(after.attempt.roll.n, 2);
  assert.equal(after.attempt.rerollUsed, false);
});

test('draft: a complete squad locks, simulates on the first pick\'s real schedule, replays, and can be rebuilt', async () => {
  const { svc } = draftService({ seed: 'full' });
  let v = await svc.start(ALICE, 'nba');
  const id = v.attempt.id, first = v.attempt.roll;
  await assert.rejects(svc.lock(ALICE, id), /Still to fill/);
  await assert.rejects(svc.simulate(ALICE, id), /Lock in your squad/);
  while (!v.attempt.complete) v = await svc.pick(ALICE, id, { playerId: bestOpen(v).id, roll: v.attempt.roll.n });
  assert.equal(v.attempt.picks.length, 8);
  assert.equal(v.attempt.roll, null, 'no roll after the last pick');
  assert.equal(new Set(v.attempt.picks.map((p) => `${p.season}|${p.team.abbr}`)).size, 8, 'eight different team-seasons');
  assert.ok(v.preview.complete && v.preview.odds.avgWins > 0);
  assert.ok(v.preview.chem.links.some((l) => l.kinds.some((k) => k.kind === 'college')) || !v.attempt.picks.some((p) => p.playerId.endsWith('-p4')), 'chemistry works across rosters');
  await assert.rejects(svc.pick(ALICE, id, { playerId: 'x', roll: 9 }), /already complete/);
  const wire = JSON.stringify(v.preview);
  for (const k of ['"pct"', '"z"', '"z0"', '"strength"', '"sample"']) assert.ok(!wire.includes(k), `preview doesn't expose ${k}`);

  await svc.lock(ALICE, id);
  const r1 = await svc.simulate(ALICE, id);
  assert.equal(r1.result.home.seasonLabel, first.seasonLabel, 'the first pick\'s team-season sets the schedule');
  assert.equal(r1.result.games.length, 82);
  assert.ok(r1.result.players.every((p) => p.from), 'every player shows where he was drafted from');
  assert.ok(r1.result.mvp && r1.result.weakest);
  const r2 = await svc.simulate(ALICE, id);
  assert.notDeepEqual(r2.result.games.map((g) => [g.us, g.them]), r1.result.games.map((g) => [g.us, g.them]), 'run it back: a new season');
  const shared = await svc.runView(BOB, id, 1);
  assert.deepEqual(shared.result.record, r1.result.record, 'a shared run replays exactly');
  assert.equal(shared.attempt.roll, null, 'a viewer never sees the owner\'s live roll');

  // Rebuild: a fresh draft with a fresh reroll; old runs keep their squad.
  const rb = await svc.rebuild(ALICE, id);
  assert.equal(rb.attempt.picks.length, 0);
  assert.equal(rb.attempt.rerollUsed, false);
  assert.equal(rb.attempt.locked, false);
  assert.equal(rb.attempt.draft, 2);
  const old = await svc.runView(ALICE, id, 1);
  assert.deepEqual(old.result.record, r1.result.record);
  assert.equal(old.result.picks.length, 8);
  const mine = svc.mine(ALICE);
  assert.equal(mine.totals.runs, 2);
  assert.equal(mine.runs[0].teams, 8);
});

test('draft: challenges saved by the single-roster version still open and replay', async () => {
  const history = fakeHistory();
  const ts = await history.teamSeason('nba', 2010, '1');
  const store = createStore(null);
  const squadMap = squad.best('nba', ts.players);
  // A locked attempt + one run in the old shape.
  const legacy = { id: '00000000-0000-0000-0000-00000000000a', uid: ALICE, sport: 'nba', season: 2010, teamId: '1', team: { name: ts.team.name, abbr: ts.team.abbr }, seasonLabel: ts.seasonLabel, createdAt: 1, squad: squadMap, locked: true, runs: [] };
  store.db.attempts = { [legacy.id]: legacy };
  const { svc } = draftService({ store, history });
  const r = await svc.simulate(ALICE, legacy.id);
  assert.equal(r.result.games.length, 82);
  assert.equal(r.attempt.picks.length, 8);
  assert.equal(r.result.home.seasonLabel, ts.seasonLabel);
  assert.deepEqual((await svc.runView(ALICE, legacy.id, 1)).result.record, r.result.record);
});

test('draft: unknown sports and bad requests fail cleanly', async () => {
  const { svc } = draftService();
  await assert.rejects(svc.start(ALICE, 'curling'), /Pick a sport/);
  const v = await svc.start(ALICE, 'nba');
  await assert.rejects(svc.pick(ALICE, v.attempt.id, { playerId: 'nobody', roll: 1 }), /wasn't on the .* roster/);
  await assert.rejects(svc.pick(ALICE, v.attempt.id, { playerId: bestOpen(v).id, roll: 1, slot: 'XX.0' }), /no XX.0 slot/);
  await assert.rejects(svc.pick(ALICE, v.attempt.id, { playerId: bestOpen(v).id, roll: 7 }), (e) => e.code === 409);
  await assert.rejects(svc.view(ALICE, '00000000-0000-0000-0000-000000000000'), /doesn't exist/);
});

// ---------- old single-roster challenges ----------
const legacyAttempt = (over = {}) => ({ id: '00000000-0000-0000-0000-0000000000b1', uid: ALICE, sport: 'nba', season: 2010, teamId: '1', team: { name: 'Team 1', abbr: 'T1' }, seasonLabel: '2009-10', createdAt: 5, squad: {}, locked: false, runs: [], ...over });
async function legacySetup(attempts) {
  const history = fakeHistory();
  const store = createStore(null);
  store.db.attempts = Object.fromEntries(attempts.map((a) => [a.id, a]));
  return { history, store, ...draftService({ store, history, seed: 'legacy' }) };
}

test('old drafts: an unfinished single-roster draft is upgraded once on open: picks kept, a real new roll, one reroll', async () => {
  const old = legacyAttempt({ squad: { 'G.0': 'star', 'F.0': '2010-1-p4' } });
  const { svc, store, history } = await legacySetup([old]);
  const orig = await history.teamSeason('nba', 2010, '1');
  const v = await svc.open(ALICE, old.id);
  assert.equal(v.attempt.id, old.id, 'same challenge id');
  assert.equal(v.attempt.legacy, false);
  assert.equal(v.attempt.roll.n, 1, 'its first new roll');
  assert.notEqual(`${v.attempt.roll.season}|${v.attempt.roll.teamId}`, '2010|1', 'not the old roster again');
  assert.ok(v.pool.players.length > 0, 'the new roll\'s real roster is shown');
  assert.equal(v.attempt.rerollUsed, false, 'one manual reroll available');
  assert.equal(v.attempt.rollFailed, false, 'no "couldn\'t roll" screen');
  assert.deepEqual(v.attempt.picks.map((p) => [p.key, p.playerId]), [['G.0', 'star'], ['F.0', '2010-1-p4']], 'existing selections kept');
  const star = orig.players.find((p) => p.id === 'star');
  assert.equal(v.attempt.picks[0].player.ppg, star.ppg, 'original player data kept (from his original roster)');
  assert.equal(v.attempt.picks[0].seasonLabel, '2009-10');
  assert.equal(v.homeSeason.seasonLabel, '2009-10', 'the old roster\'s schedule is still the schedule');
  const rec = store.db.attempts[old.id];
  assert.ok(rec.picks && rec.roll && rec.upgradedFrom === 'single-roster' && rec.squad === undefined, 'stored as a new-format draft');

  // Idempotent: reopening and "refreshing" (a new service on the same data) change nothing.
  const again = await svc.open(ALICE, old.id);
  assert.equal(again.attempt.roll.n, 1);
  assert.equal(again.attempt.rolls, 1, 'no extra rolls');
  const svc2 = createService({ store, history, random: sim.rng('other').next });
  const fresh = await svc2.open(ALICE, old.id);
  assert.equal(fresh.attempt.roll.n, 1);
  assert.equal(fresh.attempt.rerollUsed, false, 'the reroll allowance survives a refresh');

  // The reroll works exactly once; automatic rolls continue the draft.
  const rr = await svc2.reroll(ALICE, old.id, { roll: 1 });
  assert.equal(rr.attempt.rerollUsed, true);
  assert.equal(rr.attempt.roll.n, 2);
  assert.equal(rr.attempt.picks.length, 2);
  await assert.rejects(svc2.reroll(ALICE, old.id, { roll: 2 }), /already used your one reroll/);
  const p = await svc2.pick(ALICE, old.id, { playerId: bestOpen(rr).id, roll: 2 });
  assert.equal(p.attempt.picks.length, 3);
  assert.deepEqual(p.attempt.picks.slice(0, 2).map((x) => x.playerId), ['star', '2010-1-p4']);
  assert.equal(p.attempt.roll.n, 3, 'an automatic roll after the pick');
  assert.equal(p.attempt.rerollUsed, true);
  // And it finishes and simulates like any draft.
  let v2 = p;
  while (!v2.attempt.complete) v2 = await svc2.pick(ALICE, old.id, { playerId: bestOpen(v2).id, roll: v2.attempt.roll.n });
  await svc2.lock(ALICE, old.id);
  const r = await svc2.simulate(ALICE, old.id);
  assert.equal(r.result.home.seasonLabel, '2009-10');
  assert.equal(r.result.games.length, 82);
});

test('old drafts: locked, completed and simulated old challenges are never rewritten by opening them', async () => {
  const history = fakeHistory();
  const ts = await history.teamSeason('nba', 2010, '1');
  const full = squad.best('nba', ts.players);
  const lockedOld = legacyAttempt({ id: '00000000-0000-0000-0000-0000000000c1', squad: full, locked: true });
  const doneOld = legacyAttempt({ id: '00000000-0000-0000-0000-0000000000c2', squad: full, locked: false });
  const othersOld = legacyAttempt({ id: '00000000-0000-0000-0000-0000000000c3', uid: BOB, squad: { 'G.0': 'star' } });
  const store = createStore(null);
  store.db.attempts = { [lockedOld.id]: lockedOld, [doneOld.id]: doneOld, [othersOld.id]: othersOld };
  const { svc } = draftService({ store, history, seed: 'locked' });
  // Give the locked one a run history first (simulating is the user's own action).
  const run = await svc.simulate(ALICE, lockedOld.id);
  const snap = () => JSON.stringify([store.db.attempts[lockedOld.id], store.db.attempts[doneOld.id], store.db.attempts[othersOld.id]]);
  const before = snap();
  for (let i = 0; i < 2; i++) {
    await svc.open(ALICE, lockedOld.id);
    await svc.open(ALICE, doneOld.id);
    await svc.open(ALICE, othersOld.id); // someone else's unfinished draft: read-only for Alice
    await svc.open(BOB, lockedOld.id);
    await svc.runView(BOB, lockedOld.id, 1);
  }
  svc.mine(ALICE);
  // Saves caused by other challenges don't rewrite them either.
  const other = await svc.start(ALICE, 'nba');
  await svc.pick(ALICE, other.attempt.id, { playerId: bestOpen(other).id, roll: 1 });
  assert.equal(snap(), before, 'old locked, completed and other people\'s challenges are byte-for-byte unchanged');
  assert.ok(store.db.attempts[lockedOld.id].squad && !store.db.attempts[lockedOld.id].picks, 'still in the old format');
  assert.equal(store.db.attempts[lockedOld.id].runs.length, 1, 'run history preserved');
  const replay = await svc.runView(ALICE, lockedOld.id, 1);
  assert.deepEqual(replay.result.record, run.result.record, 'its run replays exactly');
  const done = await svc.open(ALICE, doneOld.id);
  assert.equal(done.attempt.complete, true);
  assert.equal(done.attempt.roll, null, 'a completed old squad gets no roll');
  assert.equal(done.attempt.rollFailed, false);
  await svc.lock(ALICE, doneOld.id);
  assert.equal(store.db.attempts[doneOld.id].locked, true);
  assert.ok(store.db.attempts[doneOld.id].squad && !store.db.attempts[doneOld.id].picks, 'locking an old finished squad keeps its old format');
});

test('old drafts: if the original roster can\'t load, the old draft is left exactly as it was and upgrades on a later open', async () => {
  const old = legacyAttempt({ squad: { 'G.0': 'star' } });
  const { svc, store, history } = await legacySetup([old]);
  const before = JSON.stringify(store.db.attempts[old.id]);
  history.fail(true);
  const v = await svc.open(ALICE, old.id);
  assert.equal(v.attempt.roll, null);
  assert.equal(v.attempt.rollFailed, true, 'the UI offers a retry instead of a broken page');
  assert.equal(JSON.stringify(store.db.attempts[old.id]), before, 'nothing written');
  await assert.rejects(svc.nextRoll(ALICE, old.id), (e) => e.code === 503);
  assert.equal(JSON.stringify(store.db.attempts[old.id]), before);
  history.fail(false);
  const ok = await svc.open(ALICE, old.id);
  assert.equal(ok.attempt.roll.n, 1);
  assert.equal(ok.attempt.rerollUsed, false);
  assert.deepEqual(ok.attempt.picks.map((p) => p.playerId), ['star']);
});

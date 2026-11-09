// Games: the draftable pool for a team-season. Every player who appeared for
// the rolled team gets his real fantasy PPG from that season (lib/games/
// fantasy.js), per position he can play, plus the per-game rates the simulator
// uses to draw his game lines. No ratings: fantasy production is the measure.
//
// Eligibility is from the real season: NFL positions from ESPN's season-scoped
// athlete record, NBA/NHL/soccer positions from the box scores, MLB fielding
// positions from the lineup and SP/RP roles from real starts and relief work.

const fantasy = require('./fantasy');
const norms = require('./norms');
const { SPORTS } = require('./sports');

const r1 = (v) => Math.round(v * 10) / 10;
const div = (a, b) => (b ? a / b : 0);
const gpOf = (p) => (typeof p.games === 'number' ? p.games : p.games.size);
const pct = (v, d = 1) => (Number.isFinite(v) ? (v * 100).toFixed(d) : '0.0');
const avg3 = (v) => (Number.isFinite(v) ? v.toFixed(3).replace(/^0/, '') : '.000');
const perGame = (t, gp, keys) => Object.fromEntries(keys.map((k) => [k, div(t[k] || 0, gp)]));

// Fantasy numbers for each eligible group.
function scoreGroups(key, t, games, elig) {
  const fp = {};
  for (const g of elig) {
    const s = fantasy.seasonPPG(key, g, t, games, norms.replacement(key, g));
    if (s) fp[g] = { ...s, parts: fantasy.breakdown(key, g, t, s.gp).slice(0, 4) };
  }
  return fp;
}

// ---------- football ----------
const NFL_POS = {
  QB: 'QB', RB: 'RB', HB: 'RB', FB: 'RB', WR: 'WR', TE: 'TE',
  DE: 'DL', DT: 'DL', NT: 'DL', DL: 'DL', EDGE: 'DL',
  LB: 'LB', OLB: 'LB', ILB: 'LB', MLB: 'LB',
  CB: 'DB', S: 'DB', FS: 'DB', SS: 'DB', DB: 'DB', SAF: 'DB',
  K: 'K', PK: 'K',
};
function nflInfer(t) { // only when ESPN has no position on record
  if ((t.att || 0) >= 5) return 'QB';
  if ((t.fga || 0) + (t.xpa || 0) > 0) return 'K';
  if ((t.car || 0) > (t.rec || 0) && (t.car || 0) >= 5) return 'RB';
  if ((t.rec || 0) > 0) return 'WR';
  if ((t.sacks || 0) >= 2 && (t.defInt || 0) === 0) return 'DL';
  if ((t.defInt || 0) + (t.pd || 0) >= 3) return 'DB';
  if ((t.tkl || 0) > 0) return 'LB';
  return null;
}
function passerRating(t) {
  if (!t.att) return 0;
  const c = (x) => Math.max(0, Math.min(2.375, x));
  const a = c((t.cmp / t.att - 0.3) * 5), b = c((t.passYds / t.att - 3) * 0.25), d = c((t.passTD / t.att) * 20), e = c(2.375 - (t.int / t.att) * 25);
  return ((a + b + d + e) / 6) * 100;
}
const NFL_RATES = ['passYds', 'passTD', 'int', 'rushYds', 'rushTD', 'car', 'rec', 'recYds', 'recTD', 'fumLost', 'fgm', 'fga', 'xpm', 'xpa'];
function football(p, ctx) {
  const t = p.t, gp = gpOf(p);
  if (/^team$/i.test(p.name)) return null; // ESPN's team-total row
  // A known non-draftable position (OL, long snapper, punter) stays out even if
  // he made a special-teams tackle; infer only when ESPN is silent.
  const known = String(ctx.positions?.[p.id] || '').toUpperCase();
  const group = known ? NFL_POS[known] : nflInfer(t);
  if (!group) return null;
  let key, line, has;
  switch (group) {
    case 'QB': {
      has = (t.att || 0) > 0;
      const rtg = passerRating(t);
      key = [['GP', gp], ['CMP/ATT', `${t.cmp || 0}/${t.att || 0}`], ['YDS', t.passYds || 0], ['TD', t.passTD || 0], ['INT', t.int || 0], ['RUSH', t.rushYds || 0]];
      line = `${t.passYds || 0} yds · ${t.passTD || 0} TD · ${t.int || 0} INT · ${r1(rtg)} rating`;
      break;
    }
    case 'RB':
      has = (t.car || 0) + (t.rec || 0) > 0;
      key = [['GP', gp], ['CAR', t.car || 0], ['YDS', t.rushYds || 0], ['TD', (t.rushTD || 0) + (t.recTD || 0)], ['REC', t.rec || 0], ['REC YDS', t.recYds || 0]];
      line = `${t.rushYds || 0} rush yds · ${t.rec || 0} rec · ${(t.rushTD || 0) + (t.recTD || 0)} TD`;
      break;
    case 'WR': case 'TE':
      has = (t.rec || 0) > 0;
      key = [['GP', gp], ['REC', t.rec || 0], ['YDS', t.recYds || 0], ['AVG', r1(div(t.recYds || 0, t.rec || 0))], ['TD', t.recTD || 0]];
      line = `${t.rec || 0} rec · ${t.recYds || 0} yds · ${t.recTD || 0} TD`;
      break;
    case 'DL': case 'LB': case 'DB':
      has = (t.tkl || 0) + (t.sacks || 0) + (t.defInt || 0) + (t.pd || 0) > 0;
      key = [['GP', gp], ['TKL', t.tkl || 0], ['SACK', r1(t.sacks || 0)], ['TFL', t.tfl || 0], ['PD', t.pd || 0], ['INT', t.defInt || 0]];
      line = `${t.tkl || 0} tkl · ${r1(t.sacks || 0)} sacks · ${t.defInt || 0} INT`;
      break;
    case 'K':
      has = (t.fga || 0) + (t.xpa || 0) > 0;
      key = [['GP', gp], ['FG', `${t.fgm || 0}/${t.fga || 0}`], ['FG%', pct(div(t.fgm || 0, t.fga || 0))], ['XP', `${t.xpm || 0}/${t.xpa || 0}`]];
      line = `${t.fgm || 0}/${t.fga || 0} FG · ${t.xpm || 0}/${t.xpa || 0} XP`;
      break;
    default: return null;
  }
  if (!has) return null;
  return { pos: known || group, elig: [group], key, line, rate: perGame(t, gp, NFL_RATES), fp: scoreGroups('nfl', t, gp, [group]) };
}

// ---------- basketball ----------
const NBA_POS = { PG: ['G'], SG: ['G'], G: ['G'], SF: ['F'], PF: ['F'], F: ['F'], C: ['C'], GF: ['G', 'F'], 'G-F': ['G', 'F'], 'F-G': ['G', 'F'], FC: ['F', 'C'], 'F-C': ['F', 'C'], 'C-F': ['F', 'C'] };
const NBA_RATES = ['min', 'pts', 'tpm', 'reb', 'ast', 'stl', 'blk', 'tov', 'dd', 'td3'];
function basketball(p) {
  const t = p.t, gp = gpOf(p);
  if (!gp) return null;
  const g = (k) => div(t[k] || 0, gp);
  const seen = Object.entries(p.pos).sort((a, b) => b[1] - a[1]);
  let elig = [...new Set(seen.flatMap(([k]) => NBA_POS[k] || []))];
  if (!elig.length) elig = g('ast') >= 4 ? ['G'] : g('blk') >= 1.2 || g('reb') >= 8 ? ['F', 'C'] : ['F'];
  const order = ['G', 'F', 'C'];
  elig.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return {
    pos: seen[0]?.[0] || elig.join('/'), elig,
    key: [['GP', gp], ['MPG', r1(g('min'))], ['PTS', r1(g('pts'))], ['REB', r1(g('reb'))], ['AST', r1(g('ast'))], ['STL', r1(g('stl'))], ['BLK', r1(g('blk'))]],
    line: `${r1(g('pts'))} pts · ${r1(g('reb'))} reb · ${r1(g('ast'))} ast`,
    rate: perGame(t, gp, NBA_RATES), fp: scoreGroups('nba', t, gp, elig),
  };
}

// ---------- hockey ----------
function hockey(p) {
  const t = p.t, gp = gpOf(p);
  if (!gp) return null;
  const kind = Object.entries(p.pos).sort((a, b) => b[1] - a[1])[0]?.[0];
  if (kind === 'G') {
    const gg = t.gGames || gp;
    const svp = div(t.sv || 0, t.sa || 0);
    const gaa = t.gToi ? div((t.ga || 0) * 60, t.gToi) : div(t.ga || 0, gg);
    return {
      pos: 'G', elig: ['G'],
      key: [['GP', gg], ['W', t.w || 0], ['SV%', avg3(svp)], ['GAA', gaa.toFixed(2)], ['SO', t.so || 0]],
      line: `${t.w || 0} W · ${avg3(svp)} SV% · ${gaa.toFixed(2)} GAA`,
      rate: { ...perGame(t, gg, ['w', 'sv', 'ga', 'so', 'sa']), svp }, fp: scoreGroups('nhl', t, gp, ['G']),
    };
  }
  if (kind !== 'F' && kind !== 'D') return null;
  return {
    pos: kind, elig: [kind],
    key: [['GP', gp], ['G', t.g || 0], ['A', t.a || 0], ['PTS', (t.g || 0) + (t.a || 0)], ['+/-', `${(t.pm || 0) > 0 ? '+' : ''}${t.pm || 0}`], ['SOG', t.sog || 0]],
    line: `${t.g || 0} G · ${t.a || 0} A · ${(t.g || 0) + (t.a || 0)} PTS`,
    rate: perGame(t, gp, ['g', 'a', 'pm', 'sog']), fp: scoreGroups('nhl', t, gp, [kind]),
  };
}

// ---------- baseball ----------
function baseball(p) {
  const t = p.t;
  const out = { elig: [], key: [], line: '', rate: {}, fp: {} };
  const pa = (t.ab || 0) + (t.bb || 0);
  if (t.bGames && pa > 0) {
    const avg = div(t.h || 0, t.ab || 0), obp = div((t.h || 0) + (t.bb || 0), pa);
    const total = Object.values(p.pos).reduce((a, b) => a + b, 0);
    const top = Object.entries(p.pos).sort((a, b) => b[1] - a[1]);
    const fielded = top.filter(([, n], i) => i === 0 || n >= 3 || n >= total * 0.25).map(([k]) => k).filter((k) => k !== 'DH');
    out.elig.push(...fielded, 'DH');
    out.pos = top[0]?.[0] || 'DH';
    out.key = [['G', t.bGames], ['AVG', avg3(avg)], ['HR', t.hr || 0], ['RBI', t.rbi || 0], ['R', t.r || 0], ['SB', t.sb || 0], ['OBP', avg3(obp)]];
    out.line = `${avg3(avg)} AVG · ${t.hr || 0} HR · ${t.rbi || 0} RBI · ${t.sb || 0} SB`;
    out.rate = perGame(t, t.bGames, ['h', 'd2', 'd3', 'hr', 'r', 'rbi', 'bb', 'so', 'sb']);
  }
  if (t.pGames && (t.ip || 0) > 0) {
    const era = div((t.er || 0) * 9, t.ip), whip = div((t.ha || 0) + (t.pbb || 0), t.ip);
    out.pit = { gs: t.gs || 0, relief: t.relief || 0, ip: t.ip }; // roles decided in build()
    const pkey = [['G', t.pGames], ['GS', t.gs || 0], ['IP', r1(t.ip)], ['W-L', `${t.w || 0}-${t.l || 0}`], ['SV', t.sv || 0], ['ERA', era.toFixed(2)], ['K', t.pk || 0]];
    const pline = `${t.w || 0}-${t.l || 0} · ${era.toFixed(2)} ERA · ${whip.toFixed(2)} WHIP · ${t.pk || 0} K${t.sv ? ` · ${t.sv} SV` : ''}`;
    if (!out.key.length) { out.key = pkey; out.line = pline; out.pos = (t.gs || 0) >= (t.relief || 0) ? 'SP' : 'RP'; }
    else { out.pkey = pkey; out.pline = pline; } // two-way player
    Object.assign(out.rate, perGame(t, t.pGames, ['ip', 'ha', 'er', 'pbb', 'pk', 'w', 'l', 'sv', 'hd']), {
      ipPerStart: div(t.gsIp || 0, t.gs || 0) || 5.5, ipPerRelief: div((t.ip || 0) - (t.gsIp || 0), t.relief || 0) || 1, k9: div((t.pk || 0) * 9, t.ip), era,
    });
  }
  if (!out.elig.length && !out.pit) return null;
  out.t = t; // kept until roles are known, then scored
  return out;
}

// SP needs real starts, RP real relief work; relax if the staff is thin.
function assignPitchingRoles(players) {
  const pitchers = players.filter((p) => p.pit);
  const roles = (spMin, rpMin) => {
    for (const p of pitchers) {
      const { gs, relief } = p.pit;
      p.elig = p.elig.filter((e) => e !== 'SP' && e !== 'RP');
      if (gs >= spMin || (gs >= 1 && gs >= relief)) p.elig.push('SP');
      if (relief >= rpMin && relief >= gs * 0.5) p.elig.push('RP');
      if (!p.elig.some((e) => e === 'SP' || e === 'RP')) p.elig.push(gs >= relief ? 'SP' : 'RP');
    }
  };
  roles(3, 5);
  if (pitchers.filter((p) => p.elig.includes('SP')).length < 4 || pitchers.filter((p) => p.elig.includes('RP')).length < 2) roles(1, 1);
  for (const p of pitchers) delete p.pit;
}

// ---------- soccer ----------
function soccer(p) {
  const t = p.t, app = t.app || 0;
  if (!app) return null;
  const total = Object.values(p.pos).reduce((a, b) => a + b, 0);
  let elig = Object.entries(p.pos).filter(([, n]) => n >= Math.max(2, total * 0.25)).sort((a, b) => b[1] - a[1]).map(([k]) => k);
  if (!elig.length && total > 0) elig = [Object.entries(p.pos).sort((a, b) => b[1] - a[1])[0][0]];
  if (!elig.length && (t.saves || 0) > 0) elig = ['GK'];
  if (!elig.length) return null; // never started and no position on record
  const gk = elig[0] === 'GK';
  return {
    pos: elig[0], elig,
    key: gk ? [['APP', app], ['ST', t.starts || 0], ['CS', t.cs || 0], ['SV', t.saves || 0], ['GA', t.gaStart || 0]]
      : [['APP', app], ['ST', t.starts || 0], ['G', t.goals || 0], ['A', t.ast || 0], ['SOT', t.sog || 0], ...(elig.includes('DEF') ? [['CS', t.cs || 0]] : [])],
    line: gk ? `${t.cs || 0} clean sheets · ${t.saves || 0} saves in ${app} apps` : `${t.goals || 0} G · ${t.ast || 0} A in ${app} apps`,
    rate: { ...perGame(t, app, ['goals', 'ast', 'sog', 'saves', 'yc', 'rc', 'og', 'cs']), start: div(t.starts || 0, app) },
    fp: scoreGroups('epl', t, app, elig),
  };
}

// The team's D/ST: one unit, scored from its real games (parse.js).
function dstUnit(acc, ctx) {
  const d = acc.team?.dst;
  if (!d?.dstGames) return null;
  const name = `${ctx.team?.short || ctx.team?.name || 'Team'} D/ST`;
  const g = d.dstGames;
  return {
    id: `dst-${ctx.team?.id || 'team'}`, name, pos: 'DST', elig: ['DST'], unit: true,
    key: [['GP', g], ['SACK', d.dstSack], ['INT', d.dstInt], ['FR', d.dstFr], ['TD', d.dstTd], ['PA/G', r1(div(d.pa, g))]],
    line: `${d.dstSack} sacks · ${d.dstInt + d.dstFr} takeaways · ${d.dstTd} TD · ${r1(div(d.pa, g))} pts allowed a game`,
    rate: perGame(d, g, ['dstSack', 'dstInt', 'dstFr', 'dstTd', 'pa']),
    fp: scoreGroups('nfl', d, g, ['DST']),
  };
}

const BUILDERS = { nfl: football, nba: basketball, mlb: baseball, nhl: hockey, epl: soccer };

// Accumulator -> the draftable pool, best model PPG first.
function build(key, acc, ctx = {}) {
  const players = [];
  const slotGroups = new Set(SPORTS[key].slots.flatMap((s) => s.elig));
  for (const p of Object.values(acc.players)) {
    const r = BUILDERS[key](p, ctx);
    if (!r) continue;
    players.push({ id: p.id, name: p.name, ...r });
  }
  if (key === 'nfl') { const d = dstUnit(acc, ctx); if (d) players.push(d); }
  if (key === 'mlb') { // roles first: a pure pitcher has no position until then
    assignPitchingRoles(players);
    for (const p of players) { p.fp = scoreGroups('mlb', p.t, 0, p.elig); delete p.t; }
  }
  const out = [];
  for (const p of players) {
    // Only groups a slot can use (NFL defenders' work is in the D/ST), and a
    // group needs real games to score in it.
    p.elig = p.elig.filter((g) => slotGroups.has(g) && p.fp[g]);
    if (!p.elig.length) continue;
    p.pg = Object.fromEntries(p.elig.map((g) => [g, p.fp[g].mppg])); // model PPG by group
    const main = p.elig.reduce((a, g) => (p.pg[g] > p.pg[a] ? g : a), p.elig[0]);
    p.group = main;
    p.gp = p.fp[main].gp;
    p.ppg = p.fp[main].ppg; // real season PPG in his best role
    p.mppg = p.fp[main].mppg;
    out.push(p);
  }
  out.sort((a, b) => b.mppg - a.mppg || a.name.localeCompare(b.name));
  return out;
}

module.exports = { build, NFL_POS, passerRating };

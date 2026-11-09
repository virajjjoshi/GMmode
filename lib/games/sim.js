// Games: the season simulator. Pure and seeded: the same squad, season and
// seed always produce the same season, so any result can be re-derived and
// checked. No network, no UI. docs/GAMES.md explains the model in plain words.
//
// Roster strength is fantasy production, nothing else:
//   1. Combined PPG = each drafted player's real model PPG (from the season
//      being played) + verified chemistry bonuses (lib/games/chemistry.js).
//   2. That total is era-adjusted and placed among comparable rosters from the
//      same sport's real history -> a percentile -> a normal score z.
//   3. Strength s = b * (z - z0) (lib/games/norms.js, calibrated per sport).
//   4. Each game's expected scores use the league's real scoring level L and
//      that opponent's real points for/against (opponent strength):
//         us   = L * e^(+s/2) * oppDefense * home * form
//         them = L * oppOffense * e^(-s/2) / home * form
//      MLB: the day's starter rotates, so s is recomputed per game with that
//      starter standing in for the whole rotation.
//   5. A score is drawn from a distribution shaped like the sport, and ties go
//      to that season's real overtime rules.
//   6. Player lines are drawn from each player's real per-game rates, kept
//      consistent with the score, and scored with the same fantasy formula.

const { SPORTS } = require('./sports');
const fantasy = require('./fantasy');
const chemistry = require('./chemistry');
const norms = require('./norms');

// home: home-field scoring multiplier. form: game-to-game noise in each side's level.
const MODEL = {
  nfl: { home: 1.055, form: 0.10 },
  nba: { home: 1.014, form: 0.03 },
  mlb: { home: 1.02, form: 0.08 },
  nhl: { home: 1.04, form: 0.08 },
  epl: { home: 1.15, form: 0.10 },
};

// ---------- randomness ----------
function hashSeed(s) { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function rng(seed) {
  let a = typeof seed === 'number' ? seed >>> 0 : hashSeed(seed);
  const next = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const normal = () => { let u = 0; while (!u) u = next(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next()); };
  const poisson = (l) => {
    if (!(l > 0)) return 0;
    if (l > 40) return Math.max(0, Math.round(l + Math.sqrt(l) * normal()));
    const L = Math.exp(-l); let k = 0, p = 1; do { k++; p *= next(); } while (p > L); return k - 1;
  };
  const gamma = (shape) => { // Marsaglia-Tsang, shape >= 1
    const d = shape - 1 / 3, c = 1 / Math.sqrt(9 * d);
    for (;;) { let x, v; do { x = normal(); v = 1 + c * x; } while (v <= 0); v = v * v * v; const u = next(); if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v; }
  };
  const lognorm = (sd) => Math.exp(sd * normal() - (sd * sd) / 2);
  const pick = (items, w) => { const tot = w.reduce((a, b) => a + b, 0); if (tot <= 0) return items[Math.floor(next() * items.length)]; let r = next() * tot; for (let i = 0; i < items.length; i++) { r -= w[i]; if (r <= 0) return items[i]; } return items[items.length - 1]; };
  return { next, normal, poisson, gamma, lognorm, pick };
}

const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;
const fx = (n, d = 0) => Number(n.toFixed(d));

// ---------- 1-3. squad -> combined PPG -> strength ----------
function profile(sportKey, ts, res, { chem = true } = {}) {
  const filled = res.filter((s) => s.player);
  const members = filled.map((s) => ({ id: s.player.id, name: s.player.name, ppg: s.ppg || 0 }));
  const base = members.reduce((a, m) => a + m.ppg, 0);
  const c = chem ? chemistry.compute(members, ts.pairs || {}) : { total: 0, players: {}, links: [] };
  const combined = base + c.total;
  const complete = filled.length === res.length;
  const L = ts.league.avgFor;
  let strength = null, perGame = null;
  if (complete) {
    strength = norms.strength(sportKey, combined, L);
    if (sportKey === 'mlb') {
      const sps = filled.filter((s) => s.slot.id === 'SP');
      const val = (s) => (s.ppg || 0) + (c.players[s.player.id]?.bonus || 0);
      const rot = sps.reduce((a, s) => a + val(s), 0);
      perGame = sps.map((s) => norms.strength(sportKey, combined - rot + sps.length * val(s), L).s);
    }
  }
  return {
    complete, base: r2(base), chem: c, combined: r2(combined), strength, perGame, filled: filled.length, of: res.length,
    slots: res.map((s) => ({ key: s.key, ppg: s.player ? r2(s.ppg || 0) : null, bonus: s.player ? (c.players[s.player.id]?.bonus || 0) : null })),
  };
}

// ---------- 4. expected scores ----------
function expectations(sportKey, ts, prof) {
  const m = MODEL[sportKey], L = ts.league.avgFor;
  return ts.schedule.map((g, i) => {
    const s = prof.perGame ? prof.perGame[i % prof.perGame.length] : prof.strength.s;
    const h = g.home ? m.home : 1 / m.home;
    return {
      us: L * Math.exp(s / 2) * (g.oppStr?.def ?? 1) * h,
      them: L * (g.oppStr?.off ?? 1) * Math.exp(-s / 2) / h,
    };
  });
}

// ---------- 5. one game ----------
function nhlRules(season) {
  if (season <= 1999) return { ot: 5, rate: 1, shootout: false, otLoss: 'L' };
  if (season <= 2004) return { ot: 5, rate: 1.3, shootout: false, otLoss: 'OTL' };
  return { ot: 5, rate: season >= 2016 ? 2 : 1.3, shootout: true, otLoss: 'OTL' };
}

function playGame(sportKey, season, E, R, ctx = {}) {
  const m = MODEL[sportKey];
  const eu = E.us * R.lognorm(m.form), et = E.them * R.lognorm(m.form);
  const share = eu / (eu + et);
  let us, them, res, extra = '';
  switch (sportKey) {
    case 'nfl': {
      const pts = (e) => { const td = R.poisson(e / 10), fg = R.poisson(e / 10); return { td, fg, p: td * 7 + fg * 3 + (R.next() < 0.01 ? 2 : 0) }; };
      const a = pts(eu), b = pts(et);
      us = a.p; them = b.p; ctx.td = a.td; ctx.fg = a.fg;
      if (us === them) {
        extra = 'OT';
        if (R.next() < 0.05) res = 'T';
        else {
          const p = Math.max(0.1, Math.min(0.9, 0.5 + (share - 0.5) * 0.8));
          const add = R.next() < 0.6 ? 3 : 6;
          if (R.next() < p) { us += add; if (add === 3) ctx.fg++; else ctx.td++; } else them += add;
        }
      }
      break;
    }
    case 'nba':
      us = Math.max(60, Math.round(eu + 11 * R.normal())); them = Math.max(60, Math.round(et + 11 * R.normal()));
      while (us === them) { extra = extra ? `${(Number(extra.replace(/\D/g, '')) || 1) + 1}OT` : 'OT'; us += Math.max(0, Math.round(eu * 5 / 48 + 3 * R.normal())); them += Math.max(0, Math.round(et * 5 / 48 + 3 * R.normal())); }
      break;
    case 'mlb': {
      const runs = (e) => R.poisson(R.gamma(8) * (e / 8));
      us = runs(eu); them = runs(et);
      if (us === them) { extra = `F/${10 + Math.floor(R.next() * 3)}`; if (R.next() < share) us++; else them++; }
      break;
    }
    case 'nhl': {
      us = R.poisson(eu); them = R.poisson(et);
      if (us === them) {
        const rules = nhlRules(season);
        const otGoal = 1 - Math.exp(-(eu + et) * rules.rate * (rules.ot / 60));
        if (R.next() < otGoal) { extra = 'OT'; if (R.next() < share) us++; else { them++; res = rules.otLoss; } }
        else if (rules.shootout) { extra = 'SO'; if (R.next() < 0.5 + (share - 0.5) * 0.3) us++; else { them++; res = 'OTL'; } }
        else { extra = 'OT'; res = 'T'; }
      }
      break;
    }
    case 'epl':
      us = R.poisson(eu); them = R.poisson(et);
      if (us === them) res = 'T';
      break;
    default: throw new Error('sport');
  }
  if (!res) res = us > them ? 'W' : 'L';
  return { us, them, res, extra };
}

// ---------- 6. player lines (detail runs only) ----------
// Lines come from real per-game rates, scaled by how the game went, with the
// scoring plays tied to the actual score. Every line is then scored with the
// sport's fantasy formula, so simulated production is measured like real.
function lines(sportKey, res, game, E, R, ctx) {
  const out = {};
  const P = res.filter((s) => s.player);
  const st = (s) => (out[s.player.id] ||= { slot: s.slot.id, group: s.group });
  const f = Math.max(0.3, Math.min(2.2, (game.us + 1) / (E.us + 1)));
  const fd = Math.max(0.3, Math.min(2.5, (E.them + 1) / (game.them + 1)));
  const rate = (s) => s.player.rate || {};
  const P0 = (x) => R.poisson(x || 0);
  if (sportKey === 'nfl') {
    const qb = P.find((s) => s.slot.id === 'QB'), k = P.find((s) => s.slot.id === 'K');
    const rec = P.filter((s) => ['WR', 'TE', 'FLEX', 'RB'].includes(s.slot.id));
    const rush = P.filter((s) => ['RB', 'FLEX', 'QB'].includes(s.slot.id) && (rate(s).car || 0) > 0.5);
    const passTDr = qb ? rate(qb).passTD || 0 : 1, rushTDr = rush.reduce((a, s) => a + (rate(s).rushTD || 0), 0);
    const dst = P.find((s) => s.slot.id === 'DST');
    // Some of the team's touchdowns are defensive or return TDs, at the D/ST's real rate.
    const dstShare = dst ? Math.min(0.3, (rate(dst).dstTd || 0) / Math.max(1, E.us / 10)) : 0;
    if (dst) Object.assign(st(dst), { dstTd: 0 });
    if (qb) { const q = st(qb); q.passYds = Math.round((rate(qb).passYds || 0) * f ** 0.5 * R.lognorm(0.25)); q.passTD = 0; q.int = P0((rate(qb).int || 0) / f ** 0.5); }
    for (let i = 0; i < (ctx.td || 0); i++) {
      if (dst && R.next() < dstShare) { st(dst).dstTd++; continue; }
      if (qb && R.next() < passTDr / (passTDr + rushTDr + 0.2)) {
        st(qb).passTD++;
        const c = R.pick(rec, rec.map((s) => (rate(s).recTD || 0) + 0.05)); if (c) { const x = st(c); x.recTD = (x.recTD || 0) + 1; }
      } else if (rush.length) { const c = R.pick(rush, rush.map((s) => (rate(s).rushTD || 0) + 0.05)); const x = st(c); x.rushTD = (x.rushTD || 0) + 1; }
    }
    const passScale = qb ? (st(qb).passYds + 1) / ((rate(qb).passYds || 1) + 1) : f;
    for (const s of rec) { const x = st(s); x.rec = P0((rate(s).rec || 0) * passScale); x.recYds = x.rec ? Math.round((rate(s).recYds || 0) * passScale * R.lognorm(0.35)) : 0; }
    for (const s of rush) { const x = st(s); x.rushYds = Math.round((rate(s).rushYds || 0) * f ** 0.4 * R.lognorm(0.35)); }
    for (const s of [...rec, ...rush, ...(qb ? [qb] : [])]) { const x = st(s); x.fumLost = (x.fumLost || 0) || P0(rate(s).fumLost); }
    if (dst) {
      const x = st(dst), r = rate(dst);
      x.dstSack = P0((r.dstSack || 0) * fd ** 0.5); x.dstInt = P0((r.dstInt || 0) * fd ** 0.5); x.dstFr = P0((r.dstFr || 0) * fd ** 0.3);
      x.pa = game.them; x.paPts = fantasy.paTier(game.them);
    }
    if (k) { const x = st(k), r = rate(k); x.fgm = ctx.fg || 0; x.fga = x.fgm + P0(Math.max(0, (r.fga || 0) - (r.fgm || 0))); x.xpm = ctx.td || 0; x.xpa = x.xpm; }
  } else if (sportKey === 'nba') {
    const w = P.map((s) => (rate(s).pts || 0.5) * R.lognorm(0.3));
    const tot = w.reduce((a, b) => a + b, 0) || 1;
    let left = game.us;
    P.forEach((s, i) => {
      const x = st(s), r = rate(s);
      x.pts = i === P.length - 1 ? Math.max(0, left) : Math.round((game.us * w[i]) / tot); left -= x.pts;
      x.tpm = Math.min(Math.floor(x.pts / 3), P0((r.tpm || 0) * (x.pts + 1) / ((r.pts || 0) + 1)));
      x.reb = P0((r.reb || 0) * R.lognorm(0.15)); x.ast = P0((r.ast || 0) * R.lognorm(0.15)); x.stl = P0(r.stl); x.blk = P0(r.blk); x.tov = P0(r.tov);
      const tens = [x.pts, x.reb, x.ast, x.stl, x.blk].filter((v) => v >= 10).length;
      x.dd = tens >= 2 ? 1 : 0; x.td3 = tens >= 3 ? 1 : 0;
    });
  } else if (sportKey === 'nhl') {
    const sk = P.filter((s) => s.slot.id !== 'G'), g = P.find((s) => s.slot.id === 'G');
    for (const s of sk) Object.assign(st(s), { g: 0, a: 0, pm: 0, sog: P0((rate(s).sog || 0) * f ** 0.5) });
    for (let i = 0; i < game.us; i++) {
      const sc = R.pick(sk, sk.map((s) => (rate(s).g || 0) + 0.02)); if (!sc) break; st(sc).g++;
      st(sc).sog = Math.max(st(sc).sog, st(sc).g);
      const others = sk.filter((s) => s !== sc);
      for (const pr of [0.88, 0.62]) if (R.next() < pr) { const a = R.pick(others, others.map((s) => (rate(s).a || 0) + 0.02)); if (a) st(a).a++; }
    }
    // Plus-minus: roughly two in five of your skaters are on the ice for any goal.
    for (const s of sk) { const x = st(s); for (let i = 0; i < game.us; i++) if (R.next() < 0.4) x.pm++; for (let i = 0; i < game.them; i++) if (R.next() < 0.4) x.pm--; }
    if (g) { const x = st(g); const sa = Math.max(game.them, P0((rate(g).sa || 29) * Math.sqrt(1 / fd))); Object.assign(x, { sa, sv: sa - game.them, ga: game.them, so: game.them === 0 ? 1 : 0, w: game.res === 'W' ? 1 : 0 }); }
  } else if (sportKey === 'mlb') {
    const hit = P.filter((s) => !['SP', 'RP'].includes(s.slot.id));
    const sps = P.filter((s) => s.slot.id === 'SP'), rps = P.filter((s) => s.slot.id === 'RP');
    for (const s of hit) {
      const x = st(s), r = rate(s);
      x.h = P0((r.h || 0.8) * f ** 0.6); x.hr = Math.min(x.h, P0((r.hr || 0.1) * f ** 0.7));
      const xb = Math.max(0, x.h - x.hr), p2 = r.h ? (r.d2 || 0) / r.h : 0.2, p3 = r.h ? (r.d3 || 0) / r.h : 0.02;
      x.d2 = 0; x.d3 = 0; for (let i = 0; i < xb; i++) { const u = R.next(); if (u < p3) x.d3++; else if (u < p3 + p2) x.d2++; }
      x.bb = P0(r.bb); x.so = P0(r.so); x.sb = P0(r.sb); x.rbi = 0; x.r = 0;
    }
    for (let i = 0; i < game.us; i++) { const a = R.pick(hit, hit.map((s) => (rate(s).rbi || 0.3) + st(s).hr)); if (a) st(a).rbi++; const b = R.pick(hit, hit.map((s) => (rate(s).r || 0.3) + st(s).hr)); if (b) st(b).r++; }
    const sp = sps.length ? sps[ctx.i % sps.length] : null;
    if (sp) {
      const x = st(sp), r = rate(sp);
      x.ip = Math.max(1, Math.min(9, Math.round(((r.ipPerStart || 5.5) + 1.2 * R.normal()) * 3) / 3));
      x.er = Math.min(game.them, Math.round(game.them * (x.ip / 9) * 1.1)); x.pk = P0(((r.k9 || 7) * x.ip) / 9);
      x.ha = P0(((r.ha || 0) / (r.ip || 1)) * x.ip); x.pbb = P0(((r.pbb || 0) / (r.ip || 1)) * x.ip); x.gs = 1;
      if (game.res === 'W' && x.ip >= 5) x.w = 1; else if (game.res === 'L') x.l = 1;
    }
    let closer = false;
    for (const s of rps) if (R.next() < 0.45) {
      const x = st(s); x.ip = (x.ip || 0) + 1; x.pk = (x.pk || 0) + P0((rate(s).k9 || 8) / 9);
      if (!closer && game.res === 'W' && game.us - game.them <= 3) { x.sv = 1; closer = true; }
    }
  } else if (sportKey === 'epl') {
    const field = P.filter((s) => s.slot.id !== 'GK'), gk = P.find((s) => s.slot.id === 'GK');
    const base = { FWD: 0.06, MID: 0.025, DEF: 0.006 };
    for (const s of P) {
      const x = Object.assign(st(s), { st: 1, sub: 0, goals: 0, ast: 0, sog: P0((rate(s).sog || 0) * f ** 0.5), yc: P0(rate(s).yc), rc: P0(rate(s).rc) });
      x.cs = game.them === 0 && ['GK', 'DEF', 'MID'].includes(s.group) ? 1 : 0;
      if (['GK', 'DEF'].includes(s.group)) x.gaStart = game.them;
    }
    for (let i = 0; i < game.us; i++) {
      const sc = R.pick(field, field.map((s) => (rate(s).goals || 0) + (base[s.group] || 0.01))); if (!sc) break; const x = st(sc); x.goals++; x.sog = Math.max(x.sog, x.goals);
      if (R.next() < 0.75) { const o = field.filter((s) => s !== sc); const a = R.pick(o, o.map((s) => (rate(s).ast || 0) + 0.01)); if (a) st(a).ast++; }
    }
    if (gk) st(gk).saves = P0(Math.max(2, rate(gk).saves || 2.5) / Math.sqrt(fd));
  }
  for (const s of P) { const x = out[s.player.id]; if (x) x.fp = fantasy.points(sportKey, s.group, x); }
  return out;
}

function gameLine(sportKey, x) {
  const v = (k) => x[k] || 0;
  switch (sportKey) {
    case 'nfl':
      if (x.slot === 'QB') return `${v('passYds')} pass yds, ${v('passTD')} TD${v('int') ? `, ${v('int')} INT` : ''}${v('rushTD') ? `, ${v('rushTD')} rush TD` : ''}`;
      if (x.slot === 'K') return `${v('fgm')}/${v('fga')} FG, ${v('xpm')} XP`;
      if (x.slot === 'DST') return [`${v('pa')} allowed`, v('dstSack') && `${v('dstSack')} sack${v('dstSack') > 1 ? 's' : ''}`, (v('dstInt') + v('dstFr')) && `${v('dstInt') + v('dstFr')} takeaway${v('dstInt') + v('dstFr') > 1 ? 's' : ''}`, v('dstTd') && `${v('dstTd')} TD`].filter(Boolean).join(', ');
      return [v('rushYds') && `${v('rushYds')} rush yds`, v('rec') && `${v('rec')} catches for ${v('recYds')}`, (v('rushTD') + v('recTD')) && `${v('rushTD') + v('recTD')} TD`].filter(Boolean).join(', ') || 'quiet day';
    case 'nba': return `${v('pts')} pts, ${v('reb')} reb, ${v('ast')} ast${v('td3') ? ' (triple-double)' : ''}`;
    case 'nhl': return x.slot === 'G' ? `${v('sv')} saves${v('so') ? ', shutout' : ''}` : `${v('g')} G, ${v('a')} A`;
    case 'mlb': return x.gs || x.ip ? `${fx(v('ip'), 1)} IP, ${v('er')} ER, ${v('pk')} K${v('w') ? ', W' : ''}${v('sv') ? ', SV' : ''}` : `${v('h')} H${v('hr') ? `, ${v('hr')} HR` : ''}, ${v('rbi')} RBI${v('sb') ? `, ${v('sb')} SB` : ''}`;
    case 'epl': return x.slot === 'GK' ? `${v('saves')} saves${v('cs') ? ', clean sheet' : ''}` : [v('goals') && `${v('goals')} goal${v('goals') > 1 ? 's' : ''}`, v('ast') && `${v('ast')} assist${v('ast') > 1 ? 's' : ''}`, !v('goals') && !v('ast') && v('cs') && 'clean sheet'].filter(Boolean).join(', ') || 'steady shift';
    default: return '';
  }
}

function seasonLine(sportKey, slot, t, gp) {
  const v = (k) => t[k] || 0, pg = (k) => (gp ? (v(k) / gp).toFixed(1) : '0.0');
  switch (sportKey) {
    case 'nfl':
      if (slot === 'QB') return `${v('passYds')} yds · ${v('passTD')} TD · ${v('int')} INT`;
      if (slot === 'K') return `${v('fgm')}/${v('fga')} FG · ${v('xpm')} XP`;
      if (slot === 'DST') return `${v('dstSack')} sacks · ${v('dstInt') + v('dstFr')} takeaways · ${v('dstTd')} TD · ${gp ? (v('pa') / gp).toFixed(1) : '0.0'} allowed/game`;
      return slot === 'RB' ? `${v('rushYds')} rush yds · ${v('recYds')} rec yds · ${v('rushTD') + v('recTD')} TD` : `${v('rec')} rec · ${v('recYds')} yds · ${v('recTD') + v('rushTD')} TD`;
    case 'nba': return `${pg('pts')} pts · ${pg('reb')} reb · ${pg('ast')} ast`;
    case 'nhl': return slot === 'G' ? `${v('w')} W · ${v('sa') ? (v('sv') / v('sa')).toFixed(3).replace(/^0/, '') : '.000'} SV% · ${v('so')} SO` : `${v('g')} G · ${v('a')} A · ${v('g') + v('a')} PTS`;
    case 'mlb': return slot === 'SP' || slot === 'RP' ? `${v('ip') ? ((v('er') * 9) / v('ip')).toFixed(2) : '0.00'} ERA · ${v('pk')} K in ${fx(v('ip'), 1)} IP${v('w') ? ` · ${v('w')} W` : ''}${v('sv') ? ` · ${v('sv')} SV` : ''}` : `${v('h')} H · ${v('hr')} HR · ${v('rbi')} RBI · ${v('sb')} SB`;
    case 'epl': return slot === 'GK' ? `${v('cs')} clean sheets · ${v('saves')} saves` : slot === 'DEF' ? `${v('cs')} clean sheets · ${v('goals')} G · ${v('ast')} A` : `${v('goals')} G · ${v('ast')} A`;
    default: return '';
  }
}

// ---------- seasons ----------
function simulateSeason({ sportKey, ts, res, seed }) {
  const R = rng(seed);
  const prof = profile(sportKey, ts, res);
  const E = expectations(sportKey, ts, prof);
  const totals = {};
  const games = ts.schedule.map((g, i) => {
    const ctx = { i };
    const r = playGame(sportKey, ts.season, E[i], R, ctx);
    const pl = lines(sportKey, res, r, E[i], R, ctx);
    let star = null, teamFp = 0;
    for (const [id, x] of Object.entries(pl)) {
      const t = (totals[id] ||= { gp: 0, fp: 0, best: null });
      t.gp++;
      for (const [k, val] of Object.entries(x)) if (typeof val === 'number' && k !== 'fp') t[k] = (t[k] || 0) + val;
      t.fp += x.fp; teamFp += x.fp;
      if (!t.best || x.fp > t.best.fp) t.best = { fp: x.fp, n: i + 1, line: gameLine(sportKey, x) };
      if (!star || x.fp > star.fp) star = { id, fp: x.fp, line: gameLine(sportKey, x) };
    }
    return {
      n: i + 1, date: g.date, home: g.home, opp: g.opp, us: r.us, them: r.them, res: r.res, extra: r.extra, real: g.real,
      exp: { us: fx(E[i].us, 1), them: fx(E[i].them, 1) }, fp: r1(teamFp), star: star ? { id: star.id, line: star.line, fp: r1(star.fp) } : null,
    };
  });
  return summarize(sportKey, ts, res, prof, games, totals);
}

function summarize(sportKey, ts, res, prof, games, totals) {
  const rec = { w: 0, l: 0, t: 0, otl: 0 };
  let streak = 0, maxStreak = 0, lstreak = 0, maxLoseStreak = 0, firstBlemish = null, pf = 0, pa = 0;
  for (const g of games) {
    rec[{ W: 'w', L: 'l', T: 't', OTL: 'otl' }[g.res]]++;
    pf += g.us; pa += g.them;
    if (g.res === 'W') { streak++; maxStreak = Math.max(maxStreak, streak); lstreak = 0; }
    else { streak = 0; if (firstBlemish === null) firstBlemish = g.n; }
    if (g.res === 'L' || g.res === 'OTL') { lstreak++; maxLoseStreak = Math.max(maxLoseStreak, lstreak); } else if (g.res === 'W') lstreak = 0;
  }
  const objective = SPORTS[sportKey].objective;
  const perfect = rec.w === games.length;
  const undefeated = rec.l === 0 && rec.otl === 0;
  const nameOf = (id) => res.find((s) => s.player?.id === id)?.player.name || '';
  for (const g of games) if (g.star) g.star.name = nameOf(g.star.id);

  // Value over a replacement-level player at the same position, so a kicker
  // isn't judged against a quarterback.
  const players = res.filter((s) => s.player).map((s) => {
    const t = totals[s.player.id] || { gp: 0, fp: 0 };
    const simPpg = t.gp ? t.fp / t.gp : 0;
    const repl = norms.replacement(sportKey, s.group) ?? 0;
    const real = s.player.fp?.[s.group];
    return {
      id: s.player.id, name: s.player.name, pos: s.player.pos, slot: s.slot.id, slotLabel: s.slot.label, group: s.group,
      ppg: real?.ppg ?? null, mppg: r2(s.ppg || 0), gpReal: real?.gp ?? null, bonus: prof.chem.players[s.player.id]?.bonus || 0,
      gp: t.gp, simPpg: r1(simPpg), simFp: r1(t.fp), vor: r1(simPpg - repl),
      sim: seasonLine(sportKey, s.slot.id, t, t.gp), real: s.player.pline && ['SP', 'RP'].includes(s.group) ? s.player.pline : s.player.line,
      best: t.best ? { n: t.best.n, line: t.best.line, fp: r1(t.best.fp) } : null,
    };
  });
  const byVor = [...players].sort((a, b) => b.vor - a.vor);
  const performances = games.filter((g) => g.star)
    .map((g) => ({ n: g.n, opp: g.opp.abbr, home: g.home, name: g.star.name, line: g.star.line, res: g.res, score: `${g.us}-${g.them}`, fp: g.star.fp }))
    .sort((a, b) => b.fp - a.fp).slice(0, 5);
  const margin = (g) => g.us - g.them;
  const wins = games.filter((g) => g.res === 'W'), losses = games.filter((g) => g.res !== 'W');
  const best = (xs, f) => xs.reduce((a, b) => (!a || f(b) > f(a) ? b : a), null);
  const closest = [...games].sort((a, b) => Math.abs(margin(a)) - Math.abs(margin(b)) || a.n - b.n).slice(0, 3);
  const real = ts.record;
  const realPct = (real.w + 0.5 * real.t) / (real.gp || 1), simPct = (rec.w + 0.5 * rec.t) / games.length;
  // Same basis as combined PPG: each player's simulated PPG over his own games
  // (an MLB starter pitches one game in four, but his PPG is per start).
  const simSum = players.reduce((a, p) => a + p.simPpg, 0);
  return {
    games, record: rec, played: games.length, objective, perfect, undefeated,
    success: objective === 'undefeated' ? undefeated : perfect,
    firstBlemish, maxStreak, maxLoseStreak, pf, pa, winPct: r1(simPct * 100),
    team: { combined: prof.combined, base: prof.base, chem: prof.chem.total, simPpg: r1(simSum) },
    chemistry: { total: prof.chem.total, links: prof.chem.links.slice(0, 8).map((l) => ({ a: l.aName, b: l.bName, ppg: l.ppg, text: l.kinds.map((k) => k.text).join(' · '), kinds: l.kinds.map((k) => k.kind) })) },
    players, mvp: byVor[0] || null, weakest: byVor[byVor.length - 1] || null,
    bestWin: best(wins, margin), worstLoss: best(losses, (g) => -margin(g)), closest,
    topPerformances: performances,
    beatReal: simPct > realPct,
    tier: tier(sportKey, rec, games.length),
  };
}

// How good was it, in words, against history.
function tier(sportKey, rec, n) {
  const objective = SPORTS[sportKey].objective;
  const losses = rec.l + rec.otl + (objective === 'undefeated' ? 0 : rec.t);
  if (objective === 'undefeated' ? rec.l === 0 : losses === 0) return rec.w === n ? { id: 'perfect', label: 'Perfect season' } : { id: 'unbeaten', label: 'Invincible' };
  const wpct = rec.w / n;
  const bm = SPORTS[sportKey].benchmark?.wins, full = { nba: 82, nhl: 82, mlb: 162 }[sportKey];
  if (losses === 1) return { id: 'close', label: 'One away' };
  if (bm && full && rec.w > bm * (n / full)) return { id: 'record', label: 'Record breaker' };
  if (wpct >= 0.75) return { id: 'elite', label: 'Juggernaut' };
  if (wpct >= 0.6) return { id: 'good', label: 'Contender' };
  if (wpct >= 0.45) return { id: 'mid', label: 'Bubble team' };
  return { id: 'bad', label: 'Lottery bound' };
}

// Fast Monte Carlo: chance of the objective and the spread of wins. No lines.
function odds({ sportKey, ts, res, runs = 400, seed = 'odds', chem = true }) {
  const R = rng(seed);
  const prof = profile(sportKey, ts, res, { chem });
  const E = expectations(sportKey, ts, prof);
  const objective = SPORTS[sportKey].objective;
  let hits = 0, wins = 0, ties = 0; const dist = [];
  for (let r = 0; r < runs; r++) {
    let w = 0, bad = 0;
    for (let i = 0; i < E.length; i++) {
      const g = playGame(sportKey, ts.season, E[i], R, { i });
      if (g.res === 'W') w++;
      else { if (g.res === 'T') ties++; if (objective === 'perfect' || g.res === 'L' || g.res === 'OTL') bad++; }
    }
    if (!bad) hits++;
    wins += w; dist.push(w);
  }
  dist.sort((a, b) => a - b);
  return {
    runs, objective, chance: hits / runs, avgWins: fx(wins / runs, 1), avgTies: fx(ties / runs, 1), games: E.length,
    low: dist[Math.floor(runs * 0.1)], high: dist[Math.floor(runs * 0.9)], profile: prof,
  };
}

module.exports = { MODEL, rng, hashSeed, profile, expectations, playGame, simulateSeason, odds, tier, nhlRules, lines };

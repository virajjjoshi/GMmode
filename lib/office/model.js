// GM Mode: the baseball model. Pure functions, no I/O, so it's easy to test.
//
// Everything is in "wins above replacement" (WAR), the common currency of
// baseball front offices. We compute a rough WAR from public stats, project it
// forward one season with an aging curve, and price it at a market rate per
// WAR. None of this is official: real salaries aren't in any free feed, so
// contracts and budgets are ESTIMATES and the UI says so.

const MIN_SALARY = 0.78;      // $M, league minimum (approx.)
const DOLLARS_PER_WAR = 9.0;  // $M per WAR on the free-agent market (approx.)
const MAX_SALARY = 45;        // $M, nobody earns more than this per year

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const round1 = (x) => Math.round(x * 10) / 10;
const money = (x) => Math.round(x * 100) / 100;

// "158.2" innings means 158 and 2/3.
function innings(ip) {
  if (ip == null) return 0;
  const [w, f] = String(ip).split('.');
  return Number(w) + (Number(f || 0) / 3);
}

// Position adjustment per 650 PA: catchers and shortstops are worth more than
// the same bat at first base or DH.
const POS_ADJ = { C: 1.1, SS: 0.7, CF: 0.3, '2B': 0.3, '3B': 0.2, LF: -0.4, RF: -0.4, OF: -0.3, '1B': -0.8, DH: -1.4, TWP: -1.0 };

// One season of hitting → WAR. OPS relative to a replacement-level .620,
// scaled so a .900 OPS everyday player is ~6 WAR and a league-average bat ~2.
function hitWar(st, pos) {
  const pa = Number(st?.plateAppearances) || 0;
  const ops = Number(st?.ops);
  if (!pa || !Number.isFinite(ops)) return null;
  const sb = Number(st?.stolenBases) || 0;
  return ((ops - 0.62) / 0.28) * 6 * (pa / 650) + (POS_ADJ[pos] ?? 0) * (pa / 650) + sb * 0.02;
}

// One season of pitching → WAR. Runs allowed are a blend of ERA and FIP (so a
// lucky ERA is pulled back toward strikeouts, walks and homers). Starters are
// measured against a 5.30 replacement level, relievers against 4.70.
function pitWar(st) {
  const ip = innings(st?.inningsPitched);
  if (!ip) return null;
  const k = Number(st.strikeOuts) || 0, bb = (Number(st.baseOnBalls) || 0) + (Number(st.hitByPitch) || 0), hr = Number(st.homeRuns) || 0;
  const era = Number(st.era);
  const fip = (13 * hr + 3 * bb - 2 * k) / ip + 3.15;
  const ra = Number.isFinite(era) ? 0.5 * era + 0.5 * fip : fip;
  const starter = isStarter(st);
  const rep = starter ? 5.3 : 4.7;
  const saves = Number(st.saves) || 0;
  return ((rep - ra) * ip) / 90 + (starter ? 0 : Math.min(0.6, saves * 0.012));
}
const isStarter = (st) => (Number(st?.gamesStarted) || 0) >= Math.max(3, (Number(st?.gamesPitched) || 0) * 0.5);

// How a player's value changes from age A to A+1 (in WAR at full playing time).
function agingDelta(age) {
  if (age <= 24) return 0.5;
  if (age <= 26) return 0.25;
  if (age <= 28) return 0.05;
  if (age <= 30) return -0.15;
  if (age <= 32) return -0.4;
  if (age <= 34) return -0.6;
  return -0.85;
}

// Project next season from up to two seasons [{hit, pit, w}] (newest first).
// Rates are per full season, weighted by recency and playing time, and pulled
// toward a modest baseline when the sample is small.
function project(p) {
  const seasons = p.seasons || [];
  const out = { hit: null, pit: null };

  const h = seasons.filter((s) => s.hit && (Number(s.hit.plateAppearances) || 0) > 0);
  if (h.length) {
    let num = 0, den = 0, pt = 0, ptw = 0;
    for (const s of h) {
      const pa = Number(s.hit.plateAppearances);
      const rate = hitWar(s.hit, p.pos) / (pa / 650);
      num += rate * pa * s.w; den += pa * s.w; pt += pa * s.w; ptw += s.w;
    }
    const BALLAST = 250, BASE = 0.6;
    const rate = (num + BALLAST * BASE) / (den + BALLAST);
    const ptNext = clamp(pt / ptw, 120, 650);
    out.hit = { war: rate * (ptNext / 650) + agingDelta(p.age) * (ptNext / 650), pa: Math.round(ptNext) };
  }

  const q = seasons.filter((s) => s.pit && innings(s.pit.inningsPitched) > 0);
  if (q.length) {
    const starter = isStarter(q[0].pit);
    const full = starter ? 180 : 65;
    let num = 0, den = 0, pt = 0, ptw = 0;
    for (const s of q) {
      const ip = innings(s.pit.inningsPitched);
      const rate = pitWar(s.pit) / (ip / full);
      num += rate * ip * s.w; den += ip * s.w; pt += ip * s.w; ptw += s.w;
    }
    const BALLAST = starter ? 60 : 25, BASE = starter ? 1.2 : 0.3;
    const rate = (num + BALLAST * BASE) / (den + BALLAST);
    const ptNext = clamp(pt / ptw, starter ? 60 : 20, starter ? 190 : 75);
    out.pit = { war: rate * (ptNext / full) + agingDelta(p.age) * 0.8 * (ptNext / full), ip: Math.round(ptNext), starter };
  }

  let war;
  if (!out.hit && !out.pit) war = p.age <= 24 ? 0.4 : p.age <= 27 ? 0.2 : 0; // no MLB track record
  else war = (out.hit?.war || 0) + (out.pit?.war || 0);
  return { war: round1(clamp(war, -2, 11)), hit: out.hit, pit: out.pit };
}

// The role a player fills on a depth chart.
function roleOf(p, proj) {
  if (p.pos === 'TWP') return 'TWP';
  if (p.pos === 'P') return proj.pit?.starter ? 'SP' : 'RP';
  return 'H';
}

// 35–99 display rating from projected WAR (0 WAR ≈ 50, 2 ≈ 63, 6 ≈ 89).
const ovr = (war) => clamp(Math.round(50 + war * 6.5), 35, 99);

// Service time from the MLB debut date (approximate: ignores time back in the minors).
function serviceYears(debut, asOf) {
  if (!debut) return 0;
  const yrs = (new Date(asOf) - new Date(debut)) / (365.25 * 864e5);
  return Math.max(0, Math.floor(yrs));
}

// Estimated contract for a rostered player next season, plus years of team control.
function contract(p) {
  const svc = p.svc;
  const market = Math.max(MIN_SALARY, p.war * DOLLARS_PER_WAR);
  if (svc < 3) return { cls: 'pre', salary: MIN_SALARY, years: Math.max(1, 6 - svc) };
  if (svc < 6) {
    const share = [0.2, 0.33, 0.5][svc - 3];
    return { cls: 'arb', salary: money(clamp(market * share, MIN_SALARY, 32)), years: 6 - svc };
  }
  // Veterans signed their deals earlier, usually when they were at least this good.
  const peak = Math.max(p.war, p.recentWar ?? p.war);
  const salary = money(clamp((peak + 0.6) * DOLLARS_PER_WAR * 0.9, 1.5, MAX_SALARY));
  const years = p.age <= 29 ? 4 : p.age <= 32 ? 3 : p.age <= 34 ? 2 : 1;
  return { cls: 'vet', salary, years };
}

// What a free agent asks for: years by age, dollars by projected value.
function ask(p) {
  const years = p.war < 1 ? 1 : p.age <= 27 ? 7 : p.age <= 29 ? 5 : p.age <= 31 ? 4 : p.age <= 33 ? 3 : p.age <= 35 ? 2 : 1;
  // Long deals pay for decline years, so the per-year price is a bit higher than one season's value.
  const premium = years >= 5 ? 1.08 : years >= 3 ? 1.03 : 1;
  const aav = money(clamp(p.war * DOLLARS_PER_WAR * premium, MIN_SALARY, MAX_SALARY));
  return { aav: aav < 2 ? Math.max(MIN_SALARY, Math.round(aav * 4) / 4) : Math.round(aav * 2) / 2, years };
}

// Will a free agent take this offer? Players value guaranteed money; a short
// deal for an older player is worth less to him than the same yearly amount
// over the years he wants. Good teams get a small discount, bad ones pay a tax.
function judgeOffer(p, offer, { teamWins = 81, noise = 0 } = {}) {
  const a = Number(offer.aav), y = Number(offer.years);
  if (!(a >= MIN_SALARY) || !(y >= 1 && y <= 10)) return { verdict: 'invalid', message: 'Offers need at least the league minimum and 1 to 10 years.' };
  const want = p.ask;
  const shortBy = Math.max(0, want.years - y);
  const extra = Math.max(0, y - want.years);
  const offerValue = a * Math.min(y, want.years) + 0.5 * a * extra;
  let ratio = (offerValue * (1 - (p.age >= 29 ? 0.07 : 0.03) * shortBy)) / (want.aav * want.years);
  ratio *= teamWins >= 90 ? 1.05 : teamWins >= 84 ? 1.02 : teamWins < 70 ? 0.93 : teamWins < 76 ? 0.97 : 1;
  ratio *= 1 + noise;
  if (ratio >= 1) return { verdict: 'accept', ratio };
  if (ratio >= 0.8) {
    const counterYears = Math.max(y, want.years - (teamWins >= 88 ? 1 : 0));
    const counterAav = Math.max(a, Math.ceil((want.aav * want.years) / counterYears / (1 + noise) * 2) / 2);
    return { verdict: 'counter', ratio, counter: { aav: counterAav, years: counterYears } };
  }
  return { verdict: 'reject', ratio };
}

// ---------- depth chart & team strength ----------
// Positions filled from scarcest to most common. A player can cover the
// positions listed for his own (a shortstop can play second or third).
const FILL = ['C', 'SS', 'CF', '2B', '3B', 'RF', 'LF', '1B'];
const CAN_PLAY = {
  C: ['C'], SS: ['SS'], CF: ['CF'], '2B': ['2B', 'SS'], '3B': ['3B', 'SS', '2B'],
  RF: ['RF', 'CF', 'LF', 'OF'], LF: ['LF', 'CF', 'RF', 'OF'], '1B': ['1B', '3B', 'LF', 'RF', 'C', 'DH', 'OF'],
};
const isHitter = (p) => p.role === 'H' || p.role === 'TWP';
const isPitcher = (p) => p.role === 'SP' || p.role === 'RP' || p.role === 'TWP';
const hitVal = (p) => (p.role === 'TWP' ? p.proj.hit?.war ?? 0 : p.war);
const pitVal = (p) => (p.role === 'TWP' ? p.proj.pit?.war ?? 0 : p.war);

function depthChart(players) {
  const hitters = players.filter(isHitter).sort((a, b) => hitVal(b) - hitVal(a));
  const used = new Set();
  const lineup = [];
  for (const slot of FILL) {
    let pick = hitters.find((p) => !used.has(p.id) && CAN_PLAY[slot].includes(p.pos === 'TWP' ? 'DH' : p.pos));
    let off = false;
    if (!pick) { pick = hitters.find((p) => !used.has(p.id)); off = !!pick; }
    if (pick) used.add(pick.id);
    lineup.push({ slot, id: pick?.id ?? null, war: pick ? hitVal(pick) - (off ? 1 : 0) : -1.5, off });
  }
  const dh = hitters.find((p) => !used.has(p.id));
  if (dh) used.add(dh.id);
  lineup.push({ slot: 'DH', id: dh?.id ?? null, war: dh ? hitVal(dh) + (POS_ADJ.DH - (POS_ADJ[dh.pos] ?? 0)) * 0.6 : -1.5, off: false });
  const bench = hitters.filter((p) => !used.has(p.id)).slice(0, 4).map((p) => ({ id: p.id, war: hitVal(p) * 0.2 }));

  const pitchers = players.filter(isPitcher);
  const sps = pitchers.filter((p) => p.role === 'SP' || p.role === 'TWP').sort((a, b) => pitVal(b) - pitVal(a));
  const pused = new Set();
  const rotation = [];
  for (const p of sps) { if (rotation.length === 5) break; rotation.push({ id: p.id, war: pitVal(p) }); pused.add(p.id); }
  // Not enough starters: the best relievers stretch out (at a discount).
  const rest = pitchers.filter((p) => !pused.has(p.id)).sort((a, b) => pitVal(b) - pitVal(a));
  while (rotation.length < 5 && rest.length) { const p = rest.shift(); rotation.push({ id: p.id, war: pitVal(p) * 1.4 - 0.4, stretched: true }); pused.add(p.id); }
  while (rotation.length < 5) rotation.push({ id: null, war: -1 });
  // A starter beyond the top five pitches out of the bullpen at reliever value.
  const bullpen = rest.slice(0, 8).map((p) => ({ id: p.id, war: p.role === 'SP' ? pitVal(p) * 0.35 : pitVal(p) }));
  while (bullpen.length < 8) bullpen.push({ id: null, war: -0.4 });

  const total = [...lineup, ...bench, ...rotation, ...bullpen].reduce((a, x) => a + x.war, 0);
  return { lineup, bench, rotation, bullpen, war: round1(total) };
}

// Turn every team's WAR into projected wins, centred on 81 (so the model's
// overall calibration doesn't matter, only the gaps between teams).
function projectWins(teamWar) {
  const vals = Object.values(teamWar);
  const mean = vals.reduce((a, b) => a + b, 0) / (vals.length || 1);
  return Object.fromEntries(Object.entries(teamWar).map(([k, w]) => [k, Math.round(clamp(81 + (w - mean) * 0.95, 45, 116))]));
}

// ---------- trade value ----------
// Surplus value: what a player produces (WAR × market price) minus what he's
// paid, over the years a team controls him (up to four). Contenders weigh this
// year more; rebuilding teams want youth and shed veterans.
function tradeValue(p, mode = 'neutral') {
  const years = Math.min(4, Math.max(1, p.years || 1));
  let v = 0, war = p.war, age = p.age;
  for (let y = 0; y < years; y++) {
    const salary = y === 0 ? p.salary : p.cls === 'arb' || p.cls === 'pre' ? Math.min(MAX_SALARY, Math.max(p.salary, war * DOLLARS_PER_WAR * (p.cls === 'pre' && y < 3 - (p.svc || 0) ? 0.1 : 0.55))) : p.salary;
    v += (war * DOLLARS_PER_WAR - salary) * (y === 0 ? 1 : 0.9 ** y);
    war = Math.max(-0.5, war + agingDelta(age) * 0.8); age++;
  }
  // Prospects: young players without a big-league role still carry upside.
  if (p.age <= 24 && p.war < 1.2) v += (25 - p.age) * 2.5 + 3;
  if (mode === 'contend') v += p.war * 4;
  if (mode === 'rebuild') v *= p.age >= 31 ? 0.55 : p.age <= 26 ? 1.25 : 1;
  return round1(v);
}
const modeFor = (wins) => (wins >= 86 ? 'contend' : wins <= 75 ? 'rebuild' : 'neutral');

// ---------- season simulation ----------
const log5 = (a, b) => (a - a * b) / (a + b - 2 * a * b);

// A balanced 162-game schedule: 13 vs each division rival, 6–7 vs the rest of
// the league, 3 vs each interleague team (4 vs the "natural rival").
function schedule(teams) {
  const games = [];
  const byLeague = {};
  for (const t of teams) (byLeague[t.league] ||= []).push(t);
  const leagues = Object.keys(byLeague).sort();
  for (const lg of leagues) {
    const ts = byLeague[lg];
    // Each team plays 7 games vs four non-division teams and 6 vs the other six
    // (64). With three divisions A, B, C of equal size n, team i plays 7 vs
    // B[i], B[i+1], C[i], C[i+1] (from A) and B[i] vs C[i], C[i+2]: everyone
    // ends up with exactly four 7-game opponents.
    const divs = [...new Set(ts.map((t) => t.division))].sort().map((d) => ts.filter((t) => t.division === d));
    const seven = new Set();
    const n = divs[0]?.length || 0;
    if (divs.length === 3 && divs.every((d) => d.length === n)) {
      const [A, B, C] = divs;
      const key = (x, y) => (x.id < y.id ? `${x.id}-${y.id}` : `${y.id}-${x.id}`);
      for (let i = 0; i < n; i++) {
        seven.add(key(A[i], B[i])); seven.add(key(A[i], B[(i + 1) % n]));
        seven.add(key(A[i], C[i])); seven.add(key(A[i], C[(i + 1) % n]));
        seven.add(key(B[i], C[i])); seven.add(key(B[i], C[(i + 2) % n]));
      }
    }
    for (let i = 0; i < ts.length; i++) {
      for (let j = i + 1; j < ts.length; j++) {
        const a = ts[i], b = ts[j];
        const k = a.id < b.id ? `${a.id}-${b.id}` : `${b.id}-${a.id}`;
        const g = a.division === b.division ? 13 : seven.has(k) ? 7 : 6;
        for (let x = 0; x < g; x++) games.push([a.id, b.id]);
      }
    }
  }
  if (leagues.length === 2) {
    const [A, B] = leagues.map((l) => byLeague[l]);
    for (let i = 0; i < A.length; i++) for (let j = 0; j < B.length; j++) {
      const n = i === j ? 4 : 3;
      for (let k = 0; k < n; k++) games.push([A[i].id, B[j].id]);
    }
  }
  return games;
}

function simSeason(teams, wins, rng) {
  const p = Object.fromEntries(teams.map((t) => [t.id, clamp(wins[t.id] / 162, 0.25, 0.75)]));
  const rec = Object.fromEntries(teams.map((t) => [t.id, { w: 0, l: 0 }]));
  for (const [a, b] of schedule(teams)) {
    if (rng() < log5(p[a], p[b])) { rec[a].w++; rec[b].l++; } else { rec[b].w++; rec[a].l++; }
  }
  // Fair shares don't always balance perfectly: report what was played.
  return rec;
}

function seriesWin(a, b, best, p, rng) {
  const need = Math.ceil(best / 2);
  let x = 0, y = 0;
  while (x < need && y < need) { if (rng() < log5(p[a], p[b])) x++; else y++; }
  return { winner: x === need ? a : b, score: [x, y] };
}

// 12-team postseason: per league, 3 division winners + 3 wild cards. Seeds 1–2 get byes.
function postseason(teams, rec, wins, rng) {
  const p = Object.fromEntries(teams.map((t) => [t.id, clamp(wins[t.id] / 162, 0.25, 0.75)]));
  const byPct = (a, b) => rec[b].w - rec[a].w || wins[b] - wins[a];
  const rounds = [];
  const champs = {};
  for (const lg of [...new Set(teams.map((t) => t.league))].sort()) {
    const ts = teams.filter((t) => t.league === lg);
    const divWinners = [...new Set(ts.map((t) => t.division))].map((d) => ts.filter((t) => t.division === d).map((t) => t.id).sort(byPct)[0]).sort(byPct);
    const wc = ts.map((t) => t.id).filter((id) => !divWinners.includes(id)).sort(byPct).slice(0, 3);
    const seeds = [...divWinners, ...wc];
    const wc1 = seriesWin(seeds[2], seeds[5], 3, p, rng), wc2 = seriesWin(seeds[3], seeds[4], 3, p, rng);
    const ds1 = seriesWin(seeds[0], wc2.winner, 5, p, rng), ds2 = seriesWin(seeds[1], wc1.winner, 5, p, rng);
    const cs = seriesWin(ds1.winner, ds2.winner, 7, p, rng);
    rounds.push({ league: lg, seeds, series: [
      { round: 'Wild Card', a: seeds[2], b: seeds[5], ...wc1 }, { round: 'Wild Card', a: seeds[3], b: seeds[4], ...wc2 },
      { round: 'Division Series', a: seeds[0], b: wc2.winner, ...ds1 }, { round: 'Division Series', a: seeds[1], b: wc1.winner, ...ds2 },
      { round: 'Championship Series', a: ds1.winner, b: ds2.winner, ...cs },
    ] });
    champs[lg] = cs.winner;
  }
  const [l1, l2] = Object.keys(champs).sort();
  const ws = seriesWin(champs[l1], champs[l2], 7, p, rng);
  return { rounds, worldSeries: { round: 'World Series', a: champs[l1], b: champs[l2], ...ws }, champion: ws.winner };
}

function seeded(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

module.exports = {
  MIN_SALARY, DOLLARS_PER_WAR, MAX_SALARY, innings, hitWar, pitWar, project, roleOf, ovr, serviceYears, contract, ask, judgeOffer,
  depthChart, projectWins, tradeValue, modeFor, schedule, simSeason, postseason, seeded, clamp, round1, money, agingDelta,
};

// GM Mode: the model and the save logic, on a small fake league (no network).
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../lib/office/model');
const { createService } = require('../lib/office/service');
const { createStore } = require('../lib/predict/persist');

// ---------- model ----------
test('hitting WAR: a .900 OPS regular is a star, a .620 OPS is replacement level', () => {
  assert.ok(Math.abs(M.hitWar({ plateAppearances: 650, ops: '.900' }, 'RF') - 5.6) < 0.2);
  assert.ok(Math.abs(M.hitWar({ plateAppearances: 650, ops: '.620' }, 'LF') + 0.4) < 0.1);
  assert.ok(M.hitWar({ plateAppearances: 600, ops: '.720' }, 'C') > M.hitWar({ plateAppearances: 600, ops: '.720' }, '1B'));
});

test('pitching WAR: an ace beats a replacement starter; innings like "158.2" parse', () => {
  assert.equal(M.innings('158.2'), 158 + 2 / 3);
  const ace = M.pitWar({ inningsPitched: '190', era: '2.80', strikeOuts: 220, baseOnBalls: 40, homeRuns: 15, gamesStarted: 31, gamesPitched: 31 });
  const meh = M.pitWar({ inningsPitched: '150', era: '5.30', strikeOuts: 110, baseOnBalls: 55, homeRuns: 25, gamesStarted: 28, gamesPitched: 28 });
  assert.ok(ace > 4 && ace < 7, `ace ${ace}`);
  assert.ok(meh < 0.5, `meh ${meh}`);
});

test('projection: small samples regress, old players decline, prospects get a floor', () => {
  const vet = M.project({ age: 36, pos: 'RF', seasons: [{ hit: { plateAppearances: 600, ops: '.850' }, w: 3 }] });
  const young = M.project({ age: 24, pos: 'RF', seasons: [{ hit: { plateAppearances: 600, ops: '.850' }, w: 3 }] });
  assert.ok(young.war > vet.war + 1);
  const fluke = M.project({ age: 28, pos: 'RF', seasons: [{ hit: { plateAppearances: 60, ops: '1.300' }, w: 3 }] });
  assert.ok(fluke.war < 2, `fluke ${fluke.war}`);
  assert.equal(M.project({ age: 22, pos: 'SS', seasons: [] }).war, 0.4);
});

test('contracts: pre-arb at the minimum, arbitration scales with value, free agents ask by age', () => {
  assert.deepEqual(M.contract({ svc: 1, war: 4, age: 24 }), { cls: 'pre', salary: M.MIN_SALARY, years: 5 });
  const arb = M.contract({ svc: 4, war: 4, age: 27 });
  assert.equal(arb.cls, 'arb'); assert.ok(arb.salary > 5 && arb.salary < 20);
  assert.equal(M.ask({ war: 5, age: 26 }).years, 7);
  assert.equal(M.ask({ war: 5, age: 35 }).years, 2);
  assert.equal(M.ask({ war: 0.5, age: 30 }).years, 1);
});

test('free agents: full ask is accepted, close gets a counter, lowball is rejected', () => {
  const p = { age: 30, ask: { aav: 30, years: 4 } };
  assert.equal(M.judgeOffer(p, { aav: 30, years: 4 }).verdict, 'accept');
  const c = M.judgeOffer(p, { aav: 27, years: 4 });
  assert.equal(c.verdict, 'counter'); assert.ok(c.counter.aav >= 27);
  assert.equal(M.judgeOffer(p, { aav: 10, years: 1 }).verdict, 'reject');
  // A contender gets a small hometown... er, ring discount.
  assert.equal(M.judgeOffer(p, { aav: 28.8, years: 4 }, { teamWins: 95 }).verdict, 'accept');
  assert.equal(M.judgeOffer(p, { aav: 0.1, years: 4 }).verdict, 'invalid');
});

test('schedule: 162 games for every team; the postseason crowns exactly one champion', () => {
  const teams = []; let id = 1;
  for (const lg of ['AL', 'NL']) for (const d of ['East', 'Central', 'West']) for (let k = 0; k < 5; k++) teams.push({ id: id++, league: lg, division: `${lg} ${d}` });
  const n = {}; for (const [a, b] of M.schedule(teams)) { n[a] = (n[a] || 0) + 1; n[b] = (n[b] || 0) + 1; }
  assert.deepEqual([...new Set(Object.values(n))], [162]);
  // Real teams come sorted by name, so divisions are interleaved: still 162 each.
  for (let k = 0; k < 20; k++) {
    const r = M.seeded(`order${k}`);
    const mixed = [...teams].sort(() => r() - 0.5);
    const c = {}; for (const [a, b] of M.schedule(mixed)) { c[a] = (c[a] || 0) + 1; c[b] = (c[b] || 0) + 1; }
    assert.deepEqual([...new Set(Object.values(c))], [162], `order ${k}`);
  }
  const wins = Object.fromEntries(teams.map((t) => [t.id, 70 + t.id]));
  const rng = M.seeded('t');
  const rec = M.simSeason(teams, wins, rng);
  assert.equal(Object.values(rec).reduce((a, r) => a + r.w, 0), 2430);
  const post = M.postseason(teams, rec, wins, rng);
  assert.equal(post.rounds.length, 2);
  assert.ok(post.rounds.every((r) => r.seeds.length === 6));
  assert.ok([post.worldSeries.a, post.worldSeries.b].includes(post.champion));
});

test('depth chart: fills every position, uses relievers when starters run out', () => {
  const mk = (id, pos, war, role = 'H') => ({ id, pos, war, role, proj: {} });
  const roster = [mk(1, 'C', 2), mk(2, 'SS', 4), mk(3, 'SS', 3), mk(4, 'CF', 2), mk(5, '1B', 1), mk(6, 'LF', 1), mk(7, 'RF', 1), mk(8, 'DH', 2), mk(9, '3B', 1),
    mk(20, 'P', 3, 'SP'), mk(21, 'P', 2, 'SP'), mk(22, 'P', 1, 'RP'), mk(23, 'P', 1, 'RP'), mk(24, 'P', 0.5, 'RP')];
  const c = M.depthChart(roster);
  assert.equal(c.lineup.length, 9);
  assert.ok(c.lineup.find((x) => x.slot === '2B').id === 3, 'backup SS plays second');
  assert.equal(c.rotation.length, 5);
  assert.ok(c.rotation.some((x) => x.stretched));
});

test('trade value: cheap young stars are worth far more than expensive old ones', () => {
  const young = { war: 4, salary: M.MIN_SALARY, years: 5, age: 24, cls: 'pre', svc: 1 };
  const old = { war: 3, salary: 35, years: 3, age: 34, cls: 'vet' };
  assert.ok(M.tradeValue(young) > 50);
  assert.ok(M.tradeValue(old) < 0);
  assert.ok(M.tradeValue(old, 'rebuild') > M.tradeValue(old) - 1);
});

// ---------- service on a fake league ----------
function fakeWorld() {
  const teams = []; const rosters = {}; const players = {};
  let pid = 1000;
  const mk = (pos, war, extra = {}) => {
    const id = pid++;
    const role = pos === 'SP' ? 'SP' : pos === 'RP' ? 'RP' : 'H';
    const p = { id, name: `Player ${id}`, age: 28, pos: role === 'H' ? pos : 'P', role, war, ovr: M.ovr(war), proj: {}, svc: 7, cls: 'vet', salary: 10, years: 2, line: {}, ...extra };
    players[id] = p; return id;
  };
  let tid = 1;
  for (const lg of ['AL', 'NL']) for (const d of ['East', 'Central', 'West']) for (let k = 0; k < 5; k++) {
    const t = { id: tid, name: `Team ${tid}`, short: `T${tid}`, abbr: `T${tid}`, league: lg, division: `${lg} ${d}`, budget: 200 };
    teams.push(t);
    const q = 1 + (tid % 5) * 0.3;
    rosters[tid] = [...['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH'].map((pos) => mk(pos, 1.5 * q)), ...Array.from({ length: 5 }, () => mk('SP', 2 * q)), ...Array.from({ length: 8 }, () => mk('RP', 0.4 * q))];
    tid++;
  }
  const star = mk('SS', 6, { cls: 'fa', salary: 0, years: 0, age: 29, ask: { aav: 50, years: 5 } });
  const cheap = mk('RP', 1, { cls: 'fa', salary: 0, years: 0, age: 31, ask: { aav: 4, years: 1 } });
  const prospect = mk('SS', 0.4, { age: 21, cls: 'pre', svc: 0, salary: M.MIN_SALARY, years: 6 });
  rosters[1].push(prospect);
  return { version: 'test', asOf: '2026-11-23', season: 2026, next: 2027, teams, rosters, players, freeAgents: [star, cheap], moves: [], counts: {}, ids: { star, cheap, prospect } };
}

function setup() {
  const w = fakeWorld();
  const store = createStore(null);
  let t = 1_000;
  const svc = createService({ store, worlds: { get: (v) => (v === w.version ? w : null) }, now: () => ++t });
  return { w, svc };
}

test('a save starts from the snapshot and only its owner can open it', () => {
  const { w, svc } = setup();
  const s = svc.create('fan-a', w, 1);
  const v = svc.view('fan-a', s.id);
  assert.equal(v.team.id, 1);
  assert.equal(v.freeAgents.length, 2);
  assert.equal(v.team.rosterSize, 23);
  assert.throws(() => svc.view('fan-b', s.id), /someone else/);
  assert.throws(() => svc.create('fan-a', w, 999), /real team/);
});

test('signing: budget and roster limits hold; a fair offer signs him and improves the team', () => {
  const { w, svc } = setup();
  const s = svc.create('fan', w, 1);
  const pay = svc.view('fan', s.id).team.payroll;
  assert.throws(() => svc.sign('fan', s.id, { playerId: w.ids.star, aav: 60, years: 5 }), /Ownership said no/);
  w.teams[0].budget = pay + 60;
  const low = svc.sign('fan', s.id, { playerId: w.ids.star, aav: 20, years: 2 });
  assert.equal(low.verdict, 'reject');
  // A bad team pays a premium: the agent counters, and taking the counter signs him.
  const c = svc.sign('fan', s.id, { playerId: w.ids.star, aav: 50, years: 5 });
  assert.equal(c.verdict, 'counter');
  w.teams[0].budget = pay + c.counter.aav;
  const r = svc.sign('fan', s.id, { playerId: w.ids.star, ...c.counter });
  assert.equal(r.verdict, 'accept');
  assert.ok(r.delta > 0, 'a 6-WAR shortstop adds wins');
  assert.ok(r.view.roster.some((p) => p.id === w.ids.star && p.salary === c.counter.aav));
  assert.throws(() => svc.sign('fan', s.id, { playerId: w.ids.star, ...c.counter }), /not a free agent/);
});

test('release: he leaves the roster and his salary stays on the books as dead money', () => {
  const { w, svc } = setup();
  const s = svc.create('fan', w, 1);
  const before = svc.view('fan', s.id).team;
  const victim = w.rosters[1][0];
  const r = svc.release('fan', s.id, { playerId: victim });
  assert.equal(r.view.team.rosterSize, before.rosterSize - 1);
  assert.equal(r.view.team.payroll, before.payroll);
  assert.equal(r.view.team.dead, 10);
});

test('trades: lopsided asks are rejected with a fix; a fair deal executes both ways', () => {
  const { w, svc } = setup();
  const s = svc.create('fan', w, 1);
  const theirs = w.rosters[2][0];
  const no = svc.trade('fan', s.id, { partner: 2, give: [], get: [theirs] });
  assert.equal(no.verdict, 'reject');
  assert.ok(no.gap > 0 && no.reasons.length);
  assert.ok(no.suggestion, 'suggests who to add');
  const yes = svc.trade('fan', s.id, { partner: 2, give: [no.suggestion.add], get: [theirs], execute: true });
  assert.equal(yes.verdict, 'done');
  const v = svc.view('fan', s.id);
  assert.ok(v.roster.some((p) => p.id === theirs));
  assert.ok(!v.roster.some((p) => p.id === no.suggestion.add));
  assert.throws(() => svc.trade('fan', s.id, { partner: 2, give: [no.suggestion.add], get: [] }), /no longer on your roster/);
});

test('advancing weeks lets other teams sign free agents; Opening Day closes the market', () => {
  const { w, svc } = setup();
  const s = svc.create('fan', w, 1);
  for (const t of w.teams) t.budget = 400;
  let v;
  for (let i = 0; i < 12; i++) v = svc.advance('fan', s.id).view;
  assert.equal(v.save.week, 13);
  assert.ok(v.freeAgents.length < 2, 'somebody signed');
  assert.ok(v.news.length >= 1);
  assert.throws(() => svc.advance('fan', s.id), /Opening Day/);
});

test('simulating a season: a 162-game record, a postseason, and a saved result', () => {
  const { w, svc } = setup();
  const s = svc.create('fan', w, 1);
  const { result, view } = svc.simulate('fan', s.id);
  assert.equal(result.record.w + result.record.l, 162);
  assert.ok(result.reached);
  assert.equal(view.sims.length, 1);
  assert.equal(svc.simView('fan', s.id, result.n).n, result.n);
});

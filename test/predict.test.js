// Prediction Leagues: business rules, run with `npm test` (node:test, no deps).
// Uses a fake data source and a controllable clock; nothing touches ESPN.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const S = require('../lib/predict/scoring');
const sports = require('../lib/predict/sports');
const { createStore } = require('../lib/predict/persist');
const { createService } = require('../lib/predict/service');
const { createRoutes } = require('../lib/predict/routes');
const { etYmd } = require('../lib/predict/source');

const H = 3600e3, DAY = 864e5;
const T0 = Date.parse('2026-11-03T12:00:00Z'); // a Tuesday

// ---------- fakes ----------
function fakeWorld() {
  const games = new Map(); // key -> event
  const predictors = new Map();
  let down = false;
  const ev = (league, id, startMs, { home = 'H', away = 'A', homeId = '1', awayId = '2' } = {}) => {
    const sport = league === 'epl' ? 'soccer' : league === 'nba' ? 'basketball' : 'football';
    const e = {
      id: String(id), league, sport, date: new Date(startMs).toISOString(), season: 2026,
      status: { state: 'pre', name: 'STATUS_SCHEDULED', completed: false, short: 'Scheduled' },
      home: { id: homeId, abbr: home, name: home, score: null, winner: false },
      away: { id: awayId, abbr: away, name: away, score: null, winner: false },
    };
    games.set(`${league}:${id}`, e);
    return e;
  };
  const finish = (key, hs, as, { name = 'STATUS_FINAL' } = {}) => {
    const e = games.get(key);
    e.status = { state: 'post', name, completed: true, short: 'Final' };
    e.home.score = hs; e.away.score = as;
    e.home.winner = hs > as; e.away.winner = as > hs;
  };
  const setStatus = (key, state, name, completed = false) => { games.get(key).status = { state, name, completed, short: name }; };
  const source = {
    name: 'fake', probabilitySource: 'ESPN Matchup Predictor',
    async day(league, ymd) {
      if (down) throw new Error('down');
      return [...games.values()].filter((e) => e.league === league && etYmd(Date.parse(e.date)) === ymd).map((e) => structuredClone(e));
    },
    async game(league, id) {
      if (down) throw new Error('down');
      const e = games.get(`${league}:${id}`);
      if (!e) throw new Error('404');
      return { event: structuredClone(e), predictor: predictors.get(`${league}:${id}`) || null };
    },
  };
  return { games, predictors, source, ev, finish, setStatus, setDown: (v) => { down = v; } };
}

function setup({ file = null, prob = true } = {}) {
  const w = fakeWorld();
  if (!prob) w.source.probabilitySource = null;
  let clock = T0;
  const store = createStore(file, { saveDelay: 0 });
  const svc = createService({ store, source: w.source, now: () => clock, log: { error() {} } });
  return { w, svc, store, at: (t) => { clock = t; }, now: () => clock };
}

const ALICE = 'alice-0000000000000001', BOB = 'bob-00000000000000000002', CARL = 'carl-0000000000000000003', DANA = 'dana-0000000000000000004';
const P = (name) => ({ name, avatar: '🐐' });
const baseLeague = (over = {}) => ({
  name: 'Office Pool', visibility: 'private', sports: ['nfl'],
  seasonStart: T0 - H, seasonEnd: T0 + 10 * 7 * DAY, format: 'weekly_season', ...over,
});

// ================= scoring (pure) =================
test('grade: classic pick\'em points', () => {
  assert.deepEqual(S.grade({ pick: 'home', outcome: 'home' }).points, 1);
  assert.equal(S.grade({ pick: 'home', outcome: 'home' }).result, 'correct');
  assert.equal(S.grade({ pick: 'away', outcome: 'home' }).result, 'incorrect');
  assert.equal(S.grade({ pick: 'away', outcome: 'home' }).points, 0);
  assert.equal(S.grade({ pick: null, outcome: 'home', countMiss: true }).result, 'missed');
  assert.equal(S.grade({ pick: null, outcome: 'home', countMiss: false }).result, 'none');
  assert.equal(S.grade({ pick: 'home', outcome: 'void' }).result, 'void');
  assert.equal(S.grade({ pick: 'home', outcome: 'void' }).counted, false);
  assert.equal(S.grade({ pick: 'home', outcome: null }).result, 'pending');
  assert.equal(S.grade({ pick: 'home', outcome: 'tie' }).result, 'push');
  assert.equal(S.grade({ pick: 'draw', outcome: 'tie', drawPick: true }).result, 'correct');
  assert.equal(S.grade({ pick: 'home', outcome: 'tie', drawPick: true }).result, 'incorrect');
  const auto = S.grade({ pick: null, outcome: 'home', countMiss: true, rules: { ...S.DEFAULT_RULES, missed: 'home' } });
  assert.equal(auto.result, 'correct'); assert.equal(auto.auto, true);
});

test('rank: shared ties vs tiebreakers', () => {
  const rows = () => [
    { mid: 'a', points: 5, correct: 5, missed: 1, accuracy: 60, joinedAt: 2 },
    { mid: 'b', points: 5, correct: 5, missed: 0, accuracy: 70, joinedAt: 1 },
    { mid: 'c', points: 3, correct: 3, missed: 0, accuracy: 50, joinedAt: 0 },
  ];
  const shared = S.rank(rows(), 'shared');
  assert.deepEqual(shared.map((r) => r.rank), [1, 1, 3]);
  assert.ok(shared[0].tied);
  const broken = S.rank(rows(), 'break');
  assert.deepEqual(broken.map((r) => [r.mid, r.rank]), [['b', 1], ['a', 2], ['c', 3]]);
});

test('weeks: a DST hour at the end of the season is not a phantom week', () => {
  const start = Date.parse('2026-10-20T04:00:00Z'); // Tue local midnight, EDT
  const l = { seasonStart: start, seasonEnd: start + 18 * S.WEEK_MS + 3600e3 }; // +1h after "fall back"
  assert.equal(S.weekCount(l), 18);
  assert.equal(S.weekOf(l, l.seasonEnd - 1), 18);
  assert.equal(S.weekRange(l, 18).end, l.seasonEnd);
  assert.equal(S.weekCount({ seasonStart: 0, seasonEnd: 3 * S.WEEK_MS + 2 * 864e5 }), 4, 'a real partial week still counts');
});

test('sports: phase and outcome never assume final from the clock', () => {
  const base = { home: { score: 3, winner: false }, away: { score: 1, winner: false } };
  assert.equal(sports.outcome({ ...base, state: 'in', statusName: 'STATUS_IN_PROGRESS' }), null);
  assert.equal(sports.outcome({ ...base, state: 'post', completed: false, statusName: 'STATUS_FINAL' }), null);
  assert.equal(sports.outcome({ ...base, state: 'post', completed: true, statusName: 'STATUS_FINAL' }), 'home');
  assert.equal(sports.outcome({ ...base, state: 'post', completed: false, statusName: 'STATUS_CANCELED' }), 'void');
  assert.equal(sports.phase({ state: 'post', completed: false, statusName: 'STATUS_POSTPONED' }), 'postponed');
  // Penalties: level score, winner flag decides
  assert.equal(sports.outcome({ state: 'post', completed: true, statusName: 'STATUS_FINAL_PEN', home: { score: 1, winner: false }, away: { score: 1, winner: true } }), 'away');
});

// ================= league management =================
test('create league: validation and owner', () => {
  const { svc } = setup();
  assert.throws(() => svc.createLeague(ALICE, baseLeague({ name: 'x' }), P('Alice')), /3 to 40/);
  assert.throws(() => svc.createLeague(ALICE, baseLeague({ sports: [] }), P('Alice')), /at least one sport/);
  assert.throws(() => svc.createLeague(ALICE, baseLeague({ sports: ['curling'] }), P('Alice')), /Unknown sport/);
  assert.throws(() => svc.createLeague(ALICE, baseLeague({ seasonEnd: T0 - 2 * H }), P('Alice')), /end after it starts/);
  assert.throws(() => svc.createLeague(ALICE, baseLeague({ rules: { format: 'confidence' } }), P('Alice')), /isn't available yet/);
  assert.throws(() => svc.createLeague(ALICE, baseLeague(), P('')), /display name/);
  const l = svc.createLeague(ALICE, baseLeague(), P('Alice'));
  assert.equal(l.perms.owner, true);
  assert.equal(l.members, 1);
  assert.equal(l.rules.picks, 'all');
  assert.equal(l.settings.picksVisible, 'after_lock');
});

test('join: public, private invite, invalid/revoked/expired codes, duplicates, capacity', () => {
  const { svc, at } = setup();
  const pub = svc.createLeague(ALICE, baseLeague({ visibility: 'public', name: 'Open League', settings: { maxMembers: 2 } }), P('Alice'));
  assert.equal(svc.discover(BOB).length, 1);
  svc.join(BOB, pub.id, { profile: P('Bob') });
  assert.throws(() => svc.join(BOB, pub.id, { profile: P('Bob') }), /already in/);
  assert.throws(() => svc.join(CARL, pub.id, { profile: P('Carl') }), /full/);
  assert.equal(svc.discover(CARL).length, 0, 'full leagues are not discoverable');

  const priv = svc.createLeague(ALICE, baseLeague(), P('Alice'));
  assert.throws(() => svc.join(BOB, priv.id, { profile: P('Bob') }), /not found/, 'private league needs an invite');
  assert.equal(svc.discover(BOB).some((x) => x.id === priv.id), false);
  const { invite } = svc.getInvite(ALICE, priv.id);
  assert.throws(() => svc.invitePreview(BOB, 'ZZZZZZZZ'), /doesn't exist/);
  const prev = svc.invitePreview(BOB, invite.code.toLowerCase());
  assert.equal(prev.league.name, 'Office Pool');
  assert.equal(prev.problem, null);
  svc.join(BOB, null, { code: invite.code, profile: P('Bob') });

  // owner revokes; old code stops working, new one works
  svc.manageInvite(ALICE, priv.id, { action: 'regenerate', expiresInDays: 1 });
  assert.throws(() => svc.join(CARL, null, { code: invite.code, profile: P('Carl') }), /turned off/);
  const fresh = svc.getInvite(ALICE, priv.id).invite;
  at(T0 + 2 * DAY);
  assert.throws(() => svc.join(CARL, null, { code: fresh.code, profile: P('Carl') }), /expired/);
  at(T0);
  svc.manageInvite(ALICE, priv.id, { action: 'regenerate', maxUses: 1 });
  const once = svc.getInvite(ALICE, priv.id).invite;
  svc.join(CARL, null, { code: once.code, profile: P('Carl') });
  assert.throws(() => svc.join(DANA, null, { code: once.code, profile: P('Dana') }), /used up/);
});

test('permissions: only owners administer; outsiders see nothing private', async () => {
  const { svc } = setup();
  const l = svc.createLeague(ALICE, baseLeague(), P('Alice'));
  const code = svc.getInvite(ALICE, l.id).invite.code;
  svc.join(BOB, null, { code, profile: P('Bob') });
  const bob = svc.members(BOB, l.id).members.find((m) => m.me);
  assert.throws(() => svc.updateLeague(BOB, l.id, { name: 'Hacked' }), /Only the league owner/);
  assert.throws(() => svc.manageInvite(BOB, l.id, { action: 'revoke' }), /Only the league owner/);
  assert.throws(() => svc.archiveLeague(BOB, l.id), /Only the league owner/);
  const alice = svc.members(ALICE, l.id).members.find((m) => m.me);
  assert.throws(() => svc.removeMember(BOB, l.id, alice.mid), /Only the league owner/);
  await assert.rejects(svc.leagueOverview(CARL, l.id), /not found/);
  await assert.rejects(svc.slate(CARL, l.id), /not found/);
  await assert.rejects(svc.savePicks(CARL, l.id, [{ game: 'nfl:1', pick: 'home' }]), /not found/);
  assert.throws(() => svc.memberProfile(CARL, l.id, bob.mid), /not found/);
  // core settings lock once the season has started
  assert.throws(() => svc.updateLeague(ALICE, l.id, { sports: ['nba'] }), /lock once the season starts/);
  assert.equal(svc.updateLeague(ALICE, l.id, { name: 'Renamed' }).name, 'Renamed');
  // removal
  svc.removeMember(ALICE, l.id, bob.mid);
  await assert.rejects(svc.slate(BOB, l.id), /not found/);
  assert.throws(() => svc.join(BOB, null, { code, profile: P('Bob') }), /removed you/);
  assert.throws(() => svc.leave(ALICE, l.id), /Archive it instead/);
});

test('late joins can be disallowed', () => {
  const { svc } = setup();
  const l = svc.createLeague(ALICE, baseLeague({ visibility: 'public', settings: { lateJoin: false } }), P('Alice'));
  assert.throws(() => svc.join(BOB, l.id, { profile: P('Bob') }), /after the season starts/);
});

// ================= predictions =================
test('picks: submit, update, deadline enforced server-side, eligibility', async () => {
  const { w, svc, at } = setup();
  const l = svc.createLeague(ALICE, baseLeague({ sports: ['nfl', 'epl'] }), P('Alice'));
  w.ev('nfl', 1, T0 + 5 * H);
  w.ev('nfl', 2, T0 + 30 * H);
  w.ev('nba', 3, T0 + 5 * H);              // not in this league
  w.ev('nfl', 4, T0 + 90 * 7 * DAY);       // outside the season
  w.ev('epl', 5, T0 + 6 * H);

  let r = await svc.savePicks(ALICE, l.id, [{ game: 'nfl:1', pick: 'home' }]);
  assert.equal(r.saved, 1);
  r = await svc.savePicks(ALICE, l.id, [{ game: 'nfl:1', pick: 'away' }]);
  assert.equal(r.saved, 1, 'can change before lock');
  r = await svc.savePicks(ALICE, l.id, [{ game: 'nfl:1', pick: 'away' }]);
  assert.equal(r.saved, 0); assert.equal(r.results[0].ok, true, 'same pick again is a no-op');
  r = await svc.savePicks(ALICE, l.id, [{ game: 'nba:3', pick: 'home' }, { game: 'nfl:4', pick: 'home' }, { game: 'nfl:2', pick: 'draw' }, { game: 'epl:5', pick: 'draw' }]);
  assert.match(r.results[0].error, /isn't part of this league/);
  assert.match(r.results[1].error, /outside this league's season/);
  assert.match(r.results[2].error, /Pick a team/, 'no draw option in the NFL');
  assert.equal(r.results[3].ok, true, 'draw allowed in soccer');

  const slate = await svc.slate(ALICE, l.id);
  const g1 = slate.games.find((g) => g.key === 'nfl:1');
  assert.equal(g1.mine.pick, 'away'); assert.equal(g1.status, 'submitted');
  assert.equal(slate.games.find((g) => g.key === 'nfl:2').status, 'needed');
  assert.ok(!slate.games.some((g) => g.key === 'nba:3'));

  // Deadline: the clock passes kickoff even though the feed still says "pre".
  at(T0 + 5 * H + 1000);
  r = await svc.savePicks(ALICE, l.id, [{ game: 'nfl:1', pick: 'home' }]);
  assert.match(r.results[0].error, /locked/);
  // Feed says the game started early: also locked.
  w.setStatus('nfl:2', 'in', 'STATUS_IN_PROGRESS');
  r = await svc.savePicks(ALICE, l.id, [{ game: 'nfl:2', pick: 'home' }]);
  assert.match(r.results[0].error, /locked/);
  const after = await svc.slate(ALICE, l.id);
  assert.equal(after.games.find((g) => g.key === 'nfl:1').mine.pick, 'away', 'locked pick unchanged');
});

test('picks: postponed games, no-edit leagues, provider outage', async () => {
  const { w, svc } = setup();
  const l = svc.createLeague(ALICE, baseLeague({ settings: { allowEdits: false } }), P('Alice'));
  w.ev('nfl', 1, T0 + 5 * H); w.ev('nfl', 2, T0 + 6 * H); w.ev('nfl', 3, T0 + 7 * H);
  await svc.savePicks(ALICE, l.id, [{ game: 'nfl:1', pick: 'home' }]);
  let r = await svc.savePicks(ALICE, l.id, [{ game: 'nfl:1', pick: 'away' }]);
  assert.match(r.results[0].error, /final in this league/);
  w.setStatus('nfl:2', 'post', 'STATUS_POSTPONED');
  r = await svc.savePicks(ALICE, l.id, [{ game: 'nfl:2', pick: 'home' }]);
  assert.match(r.results[0].error, /postponed/);
  w.setDown(true);
  r = await svc.savePicks(ALICE, l.id, [{ game: 'nfl:3', pick: 'home' }]);
  assert.match(r.results[0].error, /Couldn't confirm/, 'no unverified saves when the provider is down');
  await assert.rejects(svc.savePicks(ALICE, l.id, [{ game: 'not a game', pick: 'home' }]), /Unknown game/);
  await assert.rejects(svc.savePicks(ALICE, l.id, Array.from({ length: 61 }, (_, i) => ({ game: `nfl:${i}`, pick: 'home' }))), /at most 60/);
});

test('picks persist across a restart and stay unique per league+fan+game', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pl-')), 'predictions.json');
  const a = setup({ file });
  const l = a.svc.createLeague(ALICE, baseLeague(), P('Alice'));
  a.w.ev('nfl', 1, T0 + 5 * H);
  await a.svc.savePicks(ALICE, l.id, [{ game: 'nfl:1', pick: 'home' }]);
  await a.svc.savePicks(ALICE, l.id, [{ game: 'nfl:1', pick: 'away' }]);
  a.store.flush();
  const disk = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(Object.keys(disk.picks).length, 1);
  assert.equal(disk.version, 1);
  const b = createService({ store: createStore(file), source: a.w.source, now: () => T0 });
  const s = await b.slate(ALICE, l.id);
  assert.equal(s.games[0].mine.pick, 'away');
});

// ================= results & standings =================
async function playedLeague(rules = {}) {
  const ctx = setup();
  const { w, svc, at } = ctx;
  const l = svc.createLeague(ALICE, baseLeague({ visibility: 'public', rules }), P('Alice'));
  svc.join(BOB, l.id, { profile: P('Bob') });
  // week 1
  w.ev('nfl', 1, T0 + 5 * H); w.ev('nfl', 2, T0 + 6 * H); w.ev('nfl', 3, T0 + 7 * H); w.ev('nfl', 4, T0 + 8 * H);
  // week 2
  w.ev('nfl', 5, T0 + 7 * DAY + 5 * H);
  await svc.savePicks(ALICE, l.id, [{ game: 'nfl:1', pick: 'home' }, { game: 'nfl:2', pick: 'home' }, { game: 'nfl:3', pick: 'home' }, { game: 'nfl:5', pick: 'home' }]);
  await svc.savePicks(BOB, l.id, [{ game: 'nfl:1', pick: 'away' }, { game: 'nfl:2', pick: 'home' }, { game: 'nfl:4', pick: 'away' }]);
  w.finish('nfl:1', 24, 10);            // home
  w.finish('nfl:2', 7, 21);             // away
  w.finish('nfl:3', 0, 0, { name: 'STATUS_CANCELED' }); w.setStatus('nfl:3', 'post', 'STATUS_CANCELED');
  w.finish('nfl:4', 13, 17);            // away
  at(T0 + 7 * DAY + H);
  return { ...ctx, l };
}

test('scoring: correct, incorrect, missed, void; weekly finalization', async () => {
  const { svc, l } = await playedLeague();
  const wk = await svc.weekBoard(ALICE, l.id, 1);
  assert.equal(wk.week.final, true);
  const a = wk.rows.find((r) => r.name === 'Alice'), b = wk.rows.find((r) => r.name === 'Bob');
  // Alice: 1 correct (g1), 1 wrong (g2), g3 void, g4 missed
  assert.deepEqual([a.points, a.correct, a.incorrect, a.missed, a.void], [1, 1, 1, 1, 1]);
  // Bob: g1 wrong, g2 wrong, g3 void (no pick), g4 correct
  assert.deepEqual([b.points, b.correct, b.incorrect, b.missed], [1, 1, 2, 0]);
  assert.equal(a.accuracy, 50);
  assert.equal(a.rank, 1); assert.equal(b.rank, 1, 'shared rank on equal points');
  const wk2 = await svc.weekBoard(ALICE, l.id, 2);
  assert.equal(wk2.week.final, false, 'unresolved games keep the week open');
});

test('scoring: idempotent across repeated syncs; corrections recalculate; audit log kept', async () => {
  const { w, svc, l } = await playedLeague();
  await svc.sync(); await svc.sync(); await svc.weekBoard(ALICE, l.id, 1);
  let season = await svc.seasonBoard(ALICE, l.id);
  const pts = () => Object.fromEntries(season.rows.map((r) => [r.name, r.points]));
  assert.deepEqual(pts(), { Alice: 1, Bob: 1 });
  // Official result correction: game 2 actually went to the home team.
  w.finish('nfl:2', 24, 21);
  await svc.weekBoard(ALICE, l.id, 1);
  season = await svc.seasonBoard(ALICE, l.id);
  assert.deepEqual(pts(), { Alice: 2, Bob: 2 });
  const log = svc._db.resultLog.filter((e) => e.gameKey === 'nfl:2');
  assert.deepEqual(log.map((e) => [e.from, e.to, e.correction]), [[null, 'away', false], ['away', 'home', true]]);
  // weekly totals and season totals come from the same records
  const wk = await svc.weekBoard(ALICE, l.id, 1);
  for (const r of season.rows) assert.equal(r.weekly.reduce((s, x) => s + x.points, 0), wk.rows.find((x) => x.mid === r.mid).points);
});

test('scoring: missed picks default to home team when configured; select mode ignores unpicked games', async () => {
  const home = await playedLeague({ missed: 'home' });
  const a = (await home.svc.weekBoard(ALICE, home.l.id, 1)).rows.find((r) => r.name === 'Alice');
  assert.equal(a.missed, 0); assert.equal(a.incorrect, 2, 'auto home pick on g4 lost');
  const sel = await playedLeague({ picks: 'select' });
  const a2 = (await sel.svc.weekBoard(ALICE, sel.l.id, 1)).rows.find((r) => r.name === 'Alice');
  assert.equal(a2.missed, 0); assert.equal(a2.points, 1);
});

test('late joiners are not charged misses for games before they joined', async () => {
  const { w, svc, at } = setup();
  const l = svc.createLeague(ALICE, baseLeague({ visibility: 'public' }), P('Alice'));
  w.ev('nfl', 1, T0 + 2 * H);
  w.finish('nfl:1', 10, 3);
  at(T0 + 3 * H);
  svc.join(BOB, l.id, { profile: P('Bob') });
  const b = (await svc.weekBoard(BOB, l.id, 1)).rows.find((r) => r.me);
  assert.equal(b.missed, 0);
  const a = (await svc.weekBoard(BOB, l.id, 1)).rows.find((r) => r.name === 'Alice');
  assert.equal(a.missed, 1);
});

test('deadlines look 7 days ahead; picks open on the next week once this one is played out', async () => {
  const { w, svc, at } = setup();
  const l = svc.createLeague(ALICE, baseLeague(), P('Alice'));
  w.ev('nfl', 1, T0 + 2 * H);
  w.ev('nfl', 2, T0 + 7 * DAY + 2 * H); // week 2
  w.finish('nfl:1', 21, 14);
  at(T0 + 6 * DAY); // late in week 1: its only game is done
  const ov = await svc.leagueOverview(ALICE, l.id);
  assert.equal(ov.week.week, 1);
  assert.equal(ov.soon.needed, 1, 'next week\'s open game counts as due');
  const home = await svc.home(ALICE);
  assert.equal(home.needed, 1);
  assert.equal(home.deadlines[0].at, T0 + 7 * DAY + 2 * H);
  const s = await svc.slate(ALICE, l.id);
  assert.equal(s.week.week, 2);
  assert.equal((await svc.slate(ALICE, l.id, 1)).week.week, 1, 'an explicit week is respected');
});

// ================= privacy =================
test('hidden picks stay hidden until lock', async () => {
  const { w, svc, at } = setup();
  const l = svc.createLeague(ALICE, baseLeague({ visibility: 'public' }), P('Alice'));
  svc.join(BOB, l.id, { profile: P('Bob') });
  w.ev('nfl', 1, T0 + 5 * H);
  await svc.savePicks(ALICE, l.id, [{ game: 'nfl:1', pick: 'home' }]);
  const aliceMid = svc.members(BOB, l.id).members.find((m) => m.name === 'Alice').mid;
  assert.equal(svc.memberProfile(BOB, l.id, aliceMid).picks.length, 0);
  assert.equal((await svc.slate(BOB, l.id)).games[0].split, null);
  assert.equal(svc.memberProfile(ALICE, l.id, aliceMid).picks.length, 1, 'you always see your own');
  at(T0 + 5 * H);
  assert.equal(svc.memberProfile(BOB, l.id, aliceMid).picks[0].pick, 'home');
  assert.deepEqual((await svc.slate(BOB, l.id)).games[0].split, { home: 1, away: 0, draw: 0 });
});

// ================= ESPN Matchup Predictor =================
test('win probability: associated by team id, unavailable when missing or mismatched, never invented', async () => {
  const { w, svc } = setup();
  const l = svc.createLeague(ALICE, baseLeague({ sports: ['nfl'] }), P('Alice'));
  w.ev('nfl', 1, T0 + 5 * H, { homeId: '9', awayId: '29' });
  w.ev('nfl', 2, T0 + 6 * H, { homeId: '10', awayId: '11' });
  w.ev('nfl', 3, T0 + 7 * H, { homeId: '12', awayId: '13' });
  // feed lists teams in the "wrong" order: must still map by id
  w.predictors.set('nfl:1', { header: 'Matchup Predictor', home: { teamId: '29', pct: 35 }, away: { teamId: '9', pct: 64.8 } });
  w.predictors.set('nfl:3', { header: 'Matchup Predictor', home: { teamId: '99', pct: 50 }, away: { teamId: '98', pct: 50 } });
  const s = await svc.slate(ALICE, l.id);
  const by = Object.fromEntries(s.games.map((g) => [g.id, g.prob]));
  assert.equal(by['1'].status, 'ok');
  assert.equal(by['1'].home, 64.8); assert.equal(by['1'].away, 35);
  assert.equal(by['1'].source, 'ESPN Matchup Predictor');
  assert.ok(by['1'].retrievedAt);
  assert.equal(by['2'].status, 'unavailable');
  assert.equal(by['3'].status, 'unavailable', 'team ids that do not match are rejected');
  assert.equal(svc._db.probs['nfl:3'].reason, 'team-mismatch');
  const off = setup({ prob: false });
  const l2 = off.svc.createLeague(ALICE, baseLeague(), P('Alice'));
  off.w.ev('nfl', 1, T0 + 5 * H);
  assert.equal((await off.svc.slate(ALICE, l2.id)).games[0].prob.status, 'disabled');
});

test('espn.summary predictor parser rejects malformed data', () => {
  // The parser is internal to lib/espn.js; exercise it through a tiny shim.
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'espn.js'), 'utf8');
  const body = src.slice(src.indexOf('function predictor('), src.indexOf('module.exports'));
  const predictor = new Function(`${body}; return predictor;`)();
  assert.equal(predictor(undefined), null);
  assert.equal(predictor({ homeTeam: { id: '1', gameProjection: 'abc' }, awayTeam: { id: '2', gameProjection: '40' } }), null);
  assert.equal(predictor({ homeTeam: { id: '1', gameProjection: '140' }, awayTeam: { id: '2', gameProjection: '40' } }), null);
  assert.deepEqual(predictor({ header: 'Matchup Predictor', homeTeam: { id: 1, gameProjection: '60.5' }, awayTeam: { id: 2, gameProjection: '39.5' } }),
    { header: 'Matchup Predictor', home: { teamId: '1', pct: 60.5 }, away: { teamId: '2', pct: 39.5 } });
});

// ================= HTTP =================
test('HTTP: fan ids never leak; errors map to status codes', async () => {
  const { svc, w } = setup();
  const handle = createRoutes(svc);
  class HttpError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
  const send = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  const readBody = async (req) => { let s = ''; for await (const c of req) s += c; return JSON.parse(s || '{}'); };
  const clean = (s, max) => String(s ?? '').trim().slice(0, max);
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const parts = url.pathname.split('/').filter(Boolean).slice(2);
    try { await handle({ req, res, url, parts, me: req.headers['x-fan-id'] || null, ip: 'x', send, readBody, HttpError, clean, limit: () => true }); }
    catch (e) { send(res, e.code || 500, { error: e.message }); }
  });
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}/api/pl`;
  const call = async (p, uid, method = 'GET', body) => {
    const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...(uid ? { 'x-fan-id': uid } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { code: r.status, text: await r.text() };
  };
  try {
    w.ev('nfl', 1, T0 + 5 * H);
    let r = await call('/leagues', ALICE, 'POST', { ...baseLeague({ visibility: 'public' }), name: 'Alice', avatar: '🐐', leagueName: 'Leak Test' });
    assert.equal(r.code, 201, r.text);
    const id = JSON.parse(r.text).id;
    assert.equal(JSON.parse(r.text).name, 'Leak Test');
    r = await call(`/leagues/${id}/join`, BOB, 'POST', { name: 'Bob', avatar: '🦆' });
    assert.equal(r.code, 200, r.text);
    await call(`/leagues/${id}/picks`, BOB, 'POST', { name: 'Bob', picks: [{ game: 'nfl:1', pick: 'home' }] });
    for (const p of ['', '/members', '/season', '/week', '/slate', '/invite']) {
      r = await call(`/leagues/${id}${p}`, ALICE);
      assert.equal(r.code, 200, `${p}: ${r.text}`);
      assert.ok(!r.text.includes(BOB) && !r.text.includes(ALICE), `fan id leaked in ${p}`);
    }
    r = await call('/home', BOB); assert.ok(!r.text.includes(ALICE));
    r = await call('/discover', CARL); assert.ok(!r.text.includes(ALICE));
    r = await call(`/leagues/${id}/archive`, BOB, 'POST', { name: 'Bob' }); assert.equal(r.code, 403);
    r = await call('/leagues/nope-nope', CARL); assert.equal(r.code, 404);
    r = await call('/home'); assert.equal(r.code, 400);
  } finally { server.close(); }
});

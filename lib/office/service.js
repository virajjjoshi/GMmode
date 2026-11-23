// GM Mode: saves and the moves you can make in them.
// A save pins one MLB world snapshot and records everything that changed
// since: who is on which 40-man roster, who is still a free agent, new
// contracts, released players' dead money, your moves, the AI's moves, and
// season simulations. Player data itself always comes from the snapshot.

const crypto = require('node:crypto');
const M = require('./model');

class GmError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
const fail = (code, msg) => { throw new GmError(code, msg); };

const MAX_SAVES = 6;
const ROSTER_MAX = 40;
const WEEKS = 12; // offseason weeks until Opening Day
const BUDGET_SLACK = 0; // $M you can go over budget (none: ownership says no)

const DISCLAIMER = 'Rosters, free agents, stats and real moves come from MLB\'s public Stats API. Salaries, contract years, budgets, ratings and projections are estimates by our model (real contracts aren\'t in any free feed). Simulated seasons never happened.';

function createService({ store, worlds, now = () => Date.now() }) {
  const db = store.db;
  db.saves ||= {};

  // ---------- helpers ----------
  const world = (s) => worlds.get(s.version) || fail(410, 'This save\'s league snapshot is gone. Start a new one.');
  const own = (uid, id) => {
    const s = db.saves[id];
    if (!s) fail(404, 'Save not found.');
    if (s.uid !== uid) fail(403, 'That\'s someone else\'s front office.');
    return s;
  };
  const touch = (s) => { s.updatedAt = now(); store.save(); };
  const teamOf = (w, id) => w.teams.find((t) => t.id === Number(id));
  const salary = (s, w, pid) => s.contracts[pid]?.aav ?? w.players[pid]?.salary ?? 0;
  const years = (s, w, pid) => s.contracts[pid]?.years ?? w.players[pid]?.years ?? 1;
  const player = (s, w, pid) => {
    const p = w.players[pid]; if (!p) return null;
    const c = s.contracts[pid];
    return c ? { ...p, salary: c.aav, years: c.years, cls: c.by === 'you' ? 'signed' : p.cls === 'fa' ? 'vet' : p.cls, signedBy: c.by } : p;
  };
  const rosterOf = (s, w, tid) => (s.rosters[tid] || []).map((pid) => player(s, w, pid)).filter(Boolean);
  const payroll = (s, w, tid) => M.money((s.rosters[tid] || []).reduce((a, pid) => a + salary(s, w, pid), 0) + (s.dead[tid] || 0));
  const budget = (w, tid) => teamOf(w, tid).budget;

  function standings(s, w) {
    const charts = {}, war = {};
    for (const t of w.teams) { charts[t.id] = M.depthChart(rosterOf(s, w, t.id)); war[t.id] = charts[t.id].war; }
    return { charts, wins: M.projectWins(war) };
  }

  function log(s, type, text, extra = {}) {
    s.log.unshift({ t: now(), week: s.week, type, text, ...extra });
    s.log = s.log.slice(0, 200);
  }
  function news(s, w, text, teamId, type) {
    s.news.unshift({ t: now(), week: s.week, text, team: teamId, type });
    s.news = s.news.slice(0, 200);
  }
  // $19.5M stays $19.5M (agents quote exact numbers); big totals round to whole millions.
  const fmt$ = (x) => (x >= 100 ? `$${Math.round(x)}M` : x >= 10 ? `$${(Math.round(x * 10) / 10).toString()}M` : `$${(Math.round(x * 100) / 100).toString()}M`);
  const deal = (aav, y) => `${y} yr${y > 1 ? 's' : ''}, ${fmt$(aav * y)} (${fmt$(aav)}/yr)`;

  // ---------- public views ----------
  function config(w) {
    return {
      sport: 'mlb', season: w.season, next: w.next, asOf: w.asOf, counts: w.counts, weeks: WEEKS, rosterMax: ROSTER_MAX,
      teams: w.teams.map((t) => ({ id: t.id, name: t.name, short: t.short, abbr: t.abbr, league: t.league, division: t.division })),
      disclaimer: DISCLAIMER,
    };
  }

  function list(uid) {
    return Object.values(db.saves).filter((s) => s.uid === uid).sort((a, b) => b.updatedAt - a.updatedAt).map((s) => {
      const w = worlds.get(s.version);
      const t = w && teamOf(w, s.team);
      return { id: s.id, team: s.team, teamName: t?.name, abbr: t?.abbr, week: s.week, moves: s.log.filter((x) => x.mine).length, sims: s.sims.length, updatedAt: s.updatedAt, asOf: w?.asOf, best: s.sims.reduce((b, x) => (!b || x.record.w > b.record.w ? x : b), null) };
    });
  }

  function create(uid, w, teamId) {
    const t = teamOf(w, teamId) || fail(400, 'Pick a real team.');
    const mine = Object.values(db.saves).filter((s) => s.uid === uid).sort((a, b) => a.updatedAt - b.updatedAt);
    while (mine.length >= MAX_SAVES) delete db.saves[mine.shift().id];
    const s = {
      id: crypto.randomUUID(), uid, team: t.id, version: w.version, createdAt: now(), updatedAt: now(), week: 1,
      rosters: Object.fromEntries(Object.entries(w.rosters).map(([k, v]) => [k, v.filter((pid) => w.players[pid])])),
      fa: [...w.freeAgents], contracts: {}, dead: {}, log: [], news: [], sims: [], declined: {},
    };
    s.baseWins = standings(s, w).wins[t.id];
    log(s, 'start', `You took over as GM of the ${t.name}. Data as of ${w.asOf}.`);
    db.saves[s.id] = s;
    touch(s);
    return s;
  }

  function view(uid, id) {
    const s = own(uid, id), w = world(s);
    const { charts, wins } = standings(s, w);
    const t = teamOf(w, s.team);
    const div = w.teams.filter((x) => x.division === t.division).map((x) => ({ id: x.id, abbr: x.abbr, name: x.name, wins: wins[x.id], payroll: payroll(s, w, x.id) })).sort((a, b) => b.wins - a.wins);
    const lg = w.teams.filter((x) => x.league === t.league).map((x) => ({ id: x.id, abbr: x.abbr, wins: wins[x.id], division: x.division })).sort((a, b) => b.wins - a.wins);
    const leagueRank = lg.findIndex((x) => x.id === t.id) + 1;
    return {
      save: { id: s.id, team: s.team, week: s.week, weeks: WEEKS, createdAt: s.createdAt, baseWins: s.baseWins, version: s.version },
      asOf: w.asOf, season: w.season, next: w.next, disclaimer: DISCLAIMER,
      team: { ...t, payroll: payroll(s, w, t.id), budget: budget(w, t.id), dead: s.dead[t.id] || 0, wins: wins[t.id], mode: M.modeFor(wins[t.id]), leagueRank, rosterSize: s.rosters[t.id].length },
      roster: rosterOf(s, w, t.id).sort((a, b) => b.war - a.war),
      chart: charts[t.id],
      division: div,
      league: lg,
      freeAgents: s.fa.map((pid) => w.players[pid]).filter(Boolean).sort((a, b) => b.war - a.war),
      log: s.log.slice(0, 60),
      news: s.news.slice(0, 60),
      realMoves: w.moves.slice(0, 80).map((m) => ({ ...m, mine: m.teams.includes(t.id) })),
      sims: s.sims.slice(0, 8).map(simSummary),
      teams: w.teams.map((x) => ({ id: x.id, abbr: x.abbr, name: x.name, wins: wins[x.id], mode: M.modeFor(wins[x.id]) })),
    };
  }

  function teamView(uid, id, other) {
    const s = own(uid, id), w = world(s);
    const t = teamOf(w, other) || fail(404, 'No such team.');
    const { charts, wins } = standings(s, w);
    const mode = M.modeFor(wins[t.id]);
    const top = rosterOf(s, w, t.id).sort((a, b) => b.war - a.war);
    return {
      team: { ...t, wins: wins[t.id], mode, payroll: payroll(s, w, t.id), budget: budget(w, t.id), rosterSize: s.rosters[t.id].length },
      roster: top.map((p) => ({ ...p, value: M.tradeValue(p, mode), untouchable: mode === 'contend' && top.indexOf(p) < 2 })),
      chart: charts[t.id],
    };
  }

  // ---------- free agency ----------
  function sign(uid, id, { playerId, aav, years: yrs }) {
    const s = own(uid, id), w = world(s);
    const pid = Number(playerId);
    if (!s.fa.includes(pid)) fail(409, 'He\'s not a free agent anymore.');
    if (s.week > WEEKS) fail(409, 'Free agency is closed. It\'s Opening Day.');
    const p = w.players[pid];
    const a = M.money(Number(aav)), y = Math.round(Number(yrs));
    if (s.rosters[s.team].length >= ROSTER_MAX) fail(409, `Your 40-man roster is full. Release someone first.`);
    const pay = payroll(s, w, s.team);
    if (pay + a > budget(w, s.team) + BUDGET_SLACK) fail(409, `Ownership said no: that puts payroll at ${fmt$(pay + a)}, over your ${fmt$(budget(w, s.team))} budget.`);
    // Each player gets a small personal bias (same every time in this save), and
    // his patience shrinks a little with every lowball.
    const tries = s.declined[pid] || 0;
    const noise = (M.seeded(`${s.id}:${pid}`)() - 0.5) * 0.06 - tries * 0.015;
    const { wins } = standings(s, w);
    // A counter from his agent is binding: meeting it (same years, at least that much) signs him.
    const held = s.counters?.[pid];
    const r = held && a >= held.aav && y === held.years ? { verdict: 'accept' } : M.judgeOffer(p, { aav: a, years: y }, { teamWins: wins[s.team], noise });
    const t = teamOf(w, s.team);
    if (r.verdict === 'invalid') fail(400, r.message);
    if (r.verdict === 'accept') {
      s.fa = s.fa.filter((x) => x !== pid);
      if (s.counters) delete s.counters[pid];
      s.rosters[s.team].push(pid);
      s.contracts[pid] = { aav: a, years: y, by: 'you' };
      const after = standings(s, w).wins[s.team];
      log(s, 'sign', `Signed ${p.pos} ${p.name}: ${deal(a, y)}.`, { mine: true, player: pid, delta: after - wins[s.team] });
      news(s, w, `${t.name} sign ${p.pos} ${p.name}: ${deal(a, y)}.`, s.team, 'signing');
      touch(s);
      return { verdict: 'accept', message: `${p.name} signed. ${quote(p, 'yes')}`, delta: after - wins[s.team], view: view(uid, id) };
    }
    s.declined[pid] = tries + 1;
    if (r.verdict === 'counter') { (s.counters ||= {})[pid] = r.counter; }
    touch(s);
    if (r.verdict === 'counter') return { verdict: 'counter', counter: r.counter, message: `${p.name}'s agent: "${quote(p, 'counter')} He'll sign for ${deal(r.counter.aav, r.counter.years)}."` };
    return { verdict: 'reject', message: `${p.name}'s agent: "${quote(p, 'no')}" He's asking for about ${deal(p.ask.aav, p.ask.years)}.` };
  }

  const QUOTES = {
    yes: ['Excited to get to work.', 'He\'s already looking at houses.', 'Pending a physical, it\'s done.'],
    counter: ['We\'re close.', 'There\'s a deal here.', 'Respectful offer. Not quite there.'],
    no: ['We\'re not even in the same ballpark.', 'He\'ll take his chances on the market.', 'Call us when you\'re serious.'],
  };
  const quote = (p, k) => QUOTES[k][p.id % QUOTES[k].length];

  // ---------- release ----------
  function release(uid, id, { playerId }) {
    const s = own(uid, id), w = world(s);
    const pid = Number(playerId);
    if (!s.rosters[s.team].includes(pid)) fail(404, 'He\'s not on your roster.');
    const p = player(s, w, pid);
    const owed = salary(s, w, pid);
    const before = standings(s, w).wins[s.team];
    s.rosters[s.team] = s.rosters[s.team].filter((x) => x !== pid);
    // This season's salary is still owed (dead money). Pre-arb players cost little.
    s.dead[s.team] = M.money((s.dead[s.team] || 0) + owed);
    delete s.contracts[pid];
    const after = standings(s, w).wins[s.team];
    log(s, 'release', `Released ${p.pos} ${p.name}. ${owed > 1 ? `${fmt$(owed)} still owed this season.` : ''}`.trim(), { mine: true, player: pid, delta: after - before });
    touch(s);
    return { message: `${p.name} released.`, view: view(uid, id) };
  }

  // ---------- trades ----------
  function evaluate(s, w, partner, give, get) {
    const { wins } = standings(s, w);
    const mode = M.modeFor(wins[partner]);
    const giveP = give.map((pid) => player(s, w, pid)), getP = get.map((pid) => player(s, w, pid));
    const theirTop = rosterOf(s, w, partner).sort((a, b) => b.war - a.war).slice(0, 2).map((p) => p.id);
    const vGive = M.round1(giveP.reduce((a, p) => a + M.tradeValue(p, mode), 0));
    const vGet = M.round1(getP.reduce((a, p) => a + M.tradeValue(p, mode), 0));
    const need = Math.max(1.5, vGet * 0.05);
    const t = teamOf(w, partner);
    const reasons = [];
    let ok = true;

    const star = mode === 'contend' && getP.find((p) => theirTop.includes(p.id));
    if (star) { ok = false; reasons.push(`They're contending and ${star.name} isn't available.`); }
    const theirPay = payroll(s, w, partner) - getP.reduce((a, p) => a + p.salary, 0) + giveP.reduce((a, p) => a + p.salary, 0);
    if (theirPay > budget(w, partner) + 5 && giveP.reduce((a, p) => a + p.salary, 0) > getP.reduce((a, p) => a + p.salary, 0)) {
      ok = false; reasons.push(`They can't take on the money: it would put them at ${fmt$(theirPay)} against a ${fmt$(budget(w, partner))} budget.`);
    }
    const myPay = payroll(s, w, s.team) - giveP.reduce((a, p) => a + p.salary, 0) + getP.reduce((a, p) => a + p.salary, 0);
    if (myPay > budget(w, s.team) + BUDGET_SLACK && getP.reduce((a, p) => a + p.salary, 0) > giveP.reduce((a, p) => a + p.salary, 0)) {
      ok = false; reasons.push(`Your ownership won't approve: payroll would be ${fmt$(myPay)}, over your ${fmt$(budget(w, s.team))} budget.`);
    }
    if (s.rosters[partner].length - get.length + give.length > ROSTER_MAX) { ok = false; reasons.push('Their 40-man roster would be over 40.'); }
    if (s.rosters[s.team].length - give.length + get.length > ROSTER_MAX) { ok = false; reasons.push('Your 40-man roster would be over 40. Release someone first.'); }

    const blocked = reasons.length > 0; // budget, roster or untouchable problems (not just value)
    const gap = M.round1(need - (vGive - vGet));
    let suggestion = null;
    if (gap > 0) {
      ok = false;
      reasons.unshift(mode === 'rebuild'
        ? `${t.short} are rebuilding and want young, cheap talent. They value this about ${fmt$(gap)} short.`
        : mode === 'contend' ? `${t.short} are trying to win now. They'd need about ${fmt$(gap)} more in value.`
        : `${t.short} want about ${fmt$(gap)} more in value to make it work.`);
      // The cheapest player of yours that closes the gap.
      const mine = rosterOf(s, w, s.team).filter((p) => !give.includes(p.id))
        .map((p) => ({ p, v: M.tradeValue(p, mode) })).filter((x) => x.v >= gap).sort((a, b) => a.v - b.v);
      if (mine[0]) suggestion = { add: mine[0].p.id, name: mine[0].p.name, pos: mine[0].p.pos, text: blocked ? `Adding ${mine[0].p.pos} ${mine[0].p.name} would cover the value gap.` : `Add ${mine[0].p.pos} ${mine[0].p.name} and they'd do it.` };
    }
    return { ok, mode, vGive, vGet, gap, reasons, suggestion, partnerName: t.name };
  }

  function trade(uid, id, { partner, give = [], get = [], execute = false }) {
    const s = own(uid, id), w = world(s);
    const tid = Number(partner);
    if (!teamOf(w, tid) || tid === s.team) fail(400, 'Pick another team to trade with.');
    give = [...new Set(give.map(Number))]; get = [...new Set(get.map(Number))];
    if (!give.length && !get.length) fail(400, 'Add players to the deal.');
    if (give.length > 6 || get.length > 6) fail(400, 'Keep it to six players a side.');
    if (give.some((pid) => !s.rosters[s.team].includes(pid))) fail(409, 'One of your players is no longer on your roster.');
    if (get.some((pid) => !s.rosters[tid].includes(pid))) fail(409, 'One of their players is no longer on their roster.');
    const r = evaluate(s, w, tid, give, get);
    if (!r.ok || !execute) return { ...r, verdict: r.ok ? 'accept' : 'reject' };

    const before = standings(s, w).wins[s.team];
    s.rosters[s.team] = s.rosters[s.team].filter((pid) => !give.includes(pid)).concat(get);
    s.rosters[tid] = s.rosters[tid].filter((pid) => !get.includes(pid)).concat(give);
    const after = standings(s, w).wins[s.team];
    const names = (ids) => ids.map((pid) => `${w.players[pid].pos} ${w.players[pid].name}`).join(', ') || 'nothing';
    const t = teamOf(w, s.team), o = teamOf(w, tid);
    log(s, 'trade', `Traded ${names(give)} to the ${o.name} for ${names(get)}.`, { mine: true, delta: after - before });
    news(s, w, `${t.name} trade ${names(give)} to ${o.name} for ${names(get)}.`, s.team, 'trade');
    touch(s);
    return { ...r, verdict: 'done', delta: after - before, message: `Deal done with the ${o.name}.`, view: view(uid, id) };
  }

  // ---------- the calendar ----------
  // Advancing a week lets the other 29 teams shop. Better players and teams
  // with money and a need move first.
  function advance(uid, id) {
    const s = own(uid, id), w = world(s);
    if (s.week > WEEKS) fail(409, 'It\'s already Opening Day.');
    const rng = M.seeded(`${s.id}:week:${s.week}`);
    let { charts, wins } = standings(s, w);
    const signed = [];
    const pool = s.fa.map((pid) => w.players[pid]).filter(Boolean).sort((a, b) => b.war - a.war);
    const quota = Math.max(3, Math.round(pool.length * (s.week >= WEEKS ? 0.5 : 0.1)));
    for (const p of pool) {
      if (signed.length >= quota) break;
      // Stars wait for the market to settle a little; role players go fast.
      const odds = p.war >= 3 ? 0.25 + s.week * 0.06 : p.war >= 1.5 ? 0.35 : 0.2;
      if (rng() > odds) continue;
      let best = null;
      for (const t of w.teams) {
        if (t.id === s.team || s.rosters[t.id].length >= ROSTER_MAX) continue;
        const aav = M.money(p.ask.aav * (0.92 + rng() * 0.16));
        if (payroll(s, w, t.id) + aav > budget(w, t.id)) continue;
        const gain = M.depthChart([...rosterOf(s, w, t.id), p]).war - charts[t.id].war;
        if (gain < 0.2) continue;
        const score = gain * (wins[t.id] >= 86 ? 1.3 : wins[t.id] <= 74 ? 0.7 : 1) + rng() * 0.8;
        if (!best || score > best.score) best = { t, aav, score };
      }
      if (!best) continue;
      const yrs = Math.max(1, p.ask.years - (rng() < 0.3 ? 1 : 0));
      s.fa = s.fa.filter((x) => x !== p.id);
      if (s.counters) delete s.counters[p.id];
      s.rosters[best.t.id].push(p.id);
      s.contracts[p.id] = { aav: best.aav, years: yrs, by: 'ai' };
      charts = { ...charts, [best.t.id]: M.depthChart(rosterOf(s, w, best.t.id)) };
      signed.push(p.id);
      news(s, w, `${best.t.name} sign ${p.pos} ${p.name}: ${deal(best.aav, yrs)}.`, best.t.id, 'signing');
    }
    s.week++;
    log(s, 'week', s.week > WEEKS ? `Opening Day. ${signed.length} free agents signed in the final week.` : `Week ${s.week}. ${signed.length} free agent${signed.length === 1 ? '' : 's'} signed elsewhere.`);
    touch(s);
    return { signed: signed.map((pid) => ({ id: pid, name: w.players[pid].name })), view: view(uid, id) };
  }

  // ---------- season sim ----------
  function simulate(uid, id) {
    const s = own(uid, id), w = world(s);
    const { wins } = standings(s, w);
    const rng = M.seeded(`${s.id}:sim:${s.sims.length}:${now()}`);
    const rec = M.simSeason(w.teams, wins, rng);
    const post = M.postseason(w.teams, rec, wins, rng);
    const t = teamOf(w, s.team);
    const div = w.teams.filter((x) => x.division === t.division).sort((a, b) => rec[b.id].w - rec[a.id].w);
    // How far did we go?
    // The last series we played in was either a loss or the World Series title.
    const played = [...post.rounds.flatMap((r) => r.series), post.worldSeries].filter((x) => x.a === t.id || x.b === t.id);
    const last = played[played.length - 1];
    const reached = !last ? 'Missed the playoffs'
      : last.winner === t.id ? 'Won the World Series'
      : last.round === 'World Series' ? 'Lost the World Series'
      : `Lost in the ${last.round === 'Wild Card' ? 'Wild Card Series' : last.round}`;
    const result = {
      n: (s.sims[0]?.n || 0) + 1, at: now(), team: t.id, projected: wins[t.id], record: rec[t.id], reached,
      champion: post.champion, divRank: div.findIndex((x) => x.id === t.id) + 1, moves: s.log.filter((x) => x.mine).length,
      standings: Object.fromEntries(w.teams.map((x) => [x.id, rec[x.id]])), post,
    };
    s.sims.unshift(result); s.sims = s.sims.slice(0, 10);
    log(s, 'sim', `Simulated ${w.next}: ${rec[t.id].w}-${rec[t.id].l}. ${reached}.`);
    touch(s);
    return { result, view: view(uid, id) };
  }
  const simSummary = (x) => ({ n: x.n, at: x.at, record: x.record, reached: x.reached, projected: x.projected, divRank: x.divRank, champion: x.champion });
  function simView(uid, id, n) {
    const s = own(uid, id);
    return s.sims.find((x) => x.n === Number(n)) || fail(404, 'No such season.');
  }

  function remove(uid, id) { own(uid, id); delete db.saves[id]; store.save(); return { ok: true }; }
  const versionsInUse = () => [...new Set(Object.values(db.saves).map((s) => s.version))];

  return { config, list, create, view, teamView, sign, release, trade, advance, simulate, simView, remove, versionsInUse, DISCLAIMER };
}

module.exports = { createService, GmError };

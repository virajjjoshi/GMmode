// GM Mode data: the current MLB offseason, from MLB's public Stats API
// (statsapi.mlb.com, no key). Builds a "world" snapshot:
//   - all 30 teams with their current 40-man rosters
//   - the unsigned free agents (everyone who hit free agency or was released
//     this offseason and hasn't signed or landed on a 40-man since), limited
//     to players with real big-league playing time in the last two seasons
//   - two seasons of stats per player, projected forward (model.js)
//   - the real moves feed (MLB signings and trades this offseason)
//
// Snapshots are written to DATA_DIR/office/mlb-<date>.json. A GM save pins the
// snapshot it started from, so its world never changes underneath it; new
// saves use the newest one. A new snapshot is built at most every 6 hours, and
// if MLB is unreachable the last good one keeps serving.

const fs = require('node:fs');
const path = require('node:path');
const M = require('./model');

const API = 'https://statsapi.mlb.com/api/v1';
const REFRESH_MS = Number(process.env.GM_REFRESH_MS) || 6 * 3600_000;

// Rough payroll room by market (beyond each team's estimated payroll), $M.
const BIG = new Set([119, 147, 121, 111, 143, 137, 112, 108, 141, 140, 117, 144, 135]);
const SMALL = new Set([133, 139, 134, 146, 145, 120]);
const room = (id) => (BIG.has(id) ? 32 : SMALL.has(id) ? 12 : 20);
const SHORT_DIV = (name = '') => name.replace('American League', 'AL').replace('National League', 'NL');

async function getJson(url, tries = 3) {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': 'trash-talk-live/1.0' }, signal: AbortSignal.timeout(15000) });
      if (!r.ok) throw Object.assign(new Error(`MLB ${r.status}`), { status: r.status });
      return await r.json();
    } catch (e) {
      if (i + 1 >= tries || e.status === 404) throw e;
      await new Promise((res) => setTimeout(res, 600 * (i + 1)));
    }
  }
}
async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }));
  return out;
}
const ymd = (d) => d.toISOString().slice(0, 10);

// The season that just finished (or is being played) and the one being built for.
function seasons(now = new Date()) {
  const y = now.getUTCFullYear();
  const last = now.getUTCMonth() >= 9 ? y : y - 1; // October onward: this year's season is done
  return { last, next: last + 1, offseasonStart: `${last}-09-28` };
}

function statsOf(person) {
  const out = {};
  for (const s of person.stats || []) {
    const sp = s.splits?.find((x) => !x.team || x.numTeams) || s.splits?.[0];
    if (sp?.stat) out[s.group.displayName] = sp.stat;
  }
  return out;
}

async function build(now = new Date()) {
  const { last, next, offseasonStart } = seasons(now);
  const asOf = ymd(now);

  const teamsRaw = (await getJson(`${API}/teams?sportId=1&season=${last}`)).teams;
  const teams = teamsRaw.map((t) => ({
    id: t.id, name: t.name, short: t.teamName, abbr: t.abbreviation, city: t.locationName || t.franchiseName,
    league: t.league?.name?.startsWith('American') ? 'AL' : 'NL', division: SHORT_DIV(t.division?.name),
  })).sort((a, b) => a.name.localeCompare(b.name));

  const rosters = {};
  await pool(teams, 6, async (t) => {
    const r = await getJson(`${API}/teams/${t.id}/roster?rosterType=40Man&season=${next}`).catch(() => getJson(`${API}/teams/${t.id}/roster?rosterType=40Man`));
    rosters[t.id] = r.roster.map((x) => x.person.id);
  });
  const onRoster = new Set(Object.values(rosters).flat());

  // Free agents: walk this offseason's transactions in order.
  const tx = (await getJson(`${API}/transactions?sportId=1&startDate=${offseasonStart}&endDate=${asOf}`)).transactions
    .filter((x) => x.person && x.date).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const fa = new Map();
  for (const x of tx) {
    const d = x.description || '';
    if (x.typeDesc === 'Declared Free Agency' || x.typeDesc === 'Released' || /elected free agency|became a free agent/i.test(d)) {
      fa.set(x.person.id, { from: x.fromTeam?.id || x.toTeam?.id || null, date: x.date });
    } else if (['Signed as Free Agent', 'Trade', 'Claimed Off Waivers', 'Selected', 'Contract Purchased', 'Signed'].includes(x.typeDesc) || /\bsigned\b/i.test(d)) {
      fa.delete(x.person.id);
    }
  }
  for (const id of onRoster) fa.delete(id);

  // Real moves feed: big-league signings and trades only.
  const moves = tx.filter((x) => (x.typeDesc === 'Trade' || (x.typeDesc === 'Signed as Free Agent' && !/minor league/i.test(x.description || ''))) && x.description)
    .map((x) => ({ date: x.date, type: x.typeDesc === 'Trade' ? 'trade' : 'signing', text: x.description, teams: [x.fromTeam?.id, x.toTeam?.id].filter(Boolean), player: x.person.id }))
    .reverse();
  const seen = new Set();
  const realMoves = moves.filter((m) => { const k = `${m.date}|${m.text}`; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 300);

  // People + two seasons of stats, 100 at a time.
  const ids = [...new Set([...onRoster, ...fa.keys()])];
  const chunks = []; for (let i = 0; i < ids.length; i += 100) chunks.push(ids.slice(i, i + 100));
  const people = new Map();
  const statsBy = { [last]: new Map(), [last - 1]: new Map() };
  await pool(chunks, 4, async (c) => {
    for (const yr of [last, last - 1]) {
      const r = await getJson(`${API}/people?personIds=${c.join(',')}&hydrate=stats(group=[hitting,pitching],type=[season],season=${yr})`);
      for (const p of r.people) {
        if (!people.has(p.id)) people.set(p.id, p);
        statsBy[yr].set(p.id, statsOf(p));
      }
    }
  });

  const players = {};
  for (const id of ids) {
    const raw = people.get(id); if (!raw) continue;
    const pos = raw.primaryPosition?.abbreviation || '?';
    const age = raw.currentAge || (raw.birthDate ? Math.floor((now - new Date(raw.birthDate)) / (365.25 * 864e5)) : 28);
    const sNew = statsBy[last].get(id) || {}, sOld = statsBy[last - 1].get(id) || {};
    const seasonsArr = [{ hit: sNew.hitting, pit: sNew.pitching, w: 3 }, { hit: sOld.hitting, pit: sOld.pitching, w: 2 }].filter((s) => s.hit || s.pit);
    // Pitchers' hitting lines (and position players' mop-up innings) aren't who they are.
    for (const s of seasonsArr) {
      if (pos === 'P') s.hit = null;
      else if (pos !== 'TWP' && s.pit && M.innings(s.pit.inningsPitched) < 15) s.pit = null;
    }
    const base = { id, name: raw.fullName, age, pos, bats: raw.batSide?.code || '', throws: raw.pitchHand?.code || '', debut: raw.mlbDebutDate || null, seasons: seasonsArr };
    const proj = M.project(base);
    const recent = seasonsArr[0] ? (M.hitWar(seasonsArr[0].hit, pos) || 0) + (M.pitWar(seasonsArr[0].pit) || 0) : null;
    const p = {
      id, name: base.name, age, pos, bats: base.bats, throws: base.throws, debut: base.debut,
      svc: M.serviceYears(base.debut, asOf), role: M.roleOf(base, proj), war: proj.war, recentWar: recent == null ? null : M.round1(recent),
      ovr: M.ovr(proj.war), proj: { hit: proj.hit, pit: proj.pit }, prospect: age <= 25 && !seasonsArr.length,
      line: lineFor(sNew, sOld, pos), lineSeason: (sNew.hitting || sNew.pitching) ? last : (sOld.hitting || sOld.pitching) ? last - 1 : null,
    };
    Object.assign(p, M.contract(p));
    players[id] = p;
  }

  // Free-agent pool: real big-league playing time in either of the last two seasons.
  const freeAgents = [];
  for (const [id, info] of fa) {
    const p = players[id]; if (!p) continue;
    const s = [statsBy[last].get(id) || {}, statsBy[last - 1].get(id) || {}];
    const played = s.some((x) => (Number(x.hitting?.plateAppearances) || 0) >= 100 || M.innings(x.pitching?.inningsPitched) >= 20);
    if (!played) continue;
    p.cls = 'fa'; p.salary = 0; p.years = 0; p.from = info.from; p.ask = M.ask(p);
    freeAgents.push(id);
  }
  freeAgents.sort((a, b) => players[b].war - players[a].war);

  // Estimated payrolls and budgets.
  for (const t of teams) {
    t.payroll = M.money(rosters[t.id].reduce((a, id) => a + (players[id]?.salary || 0), 0));
    t.budget = Math.round(t.payroll + room(t.id));
  }

  return {
    version: `${asOf}-${Date.now().toString(36)}`, asOf, builtAt: now.toISOString(), season: last, next,
    teams, rosters, players, freeAgents, moves: realMoves,
    counts: { players: Object.keys(players).length, freeAgents: freeAgents.length, moves: realMoves.length, transactions: tx.length },
  };
}

// A short stat line for the UI, from the most recent season with numbers.
function lineFor(sNew, sOld, pos) {
  const s = sNew.hitting || sNew.pitching ? sNew : sOld;
  const out = {};
  if (s.hitting && pos !== 'P') {
    const h = s.hitting;
    out.hit = { pa: Number(h.plateAppearances) || 0, avg: h.avg, obp: h.obp, slg: h.slg, ops: h.ops, hr: Number(h.homeRuns) || 0, rbi: Number(h.rbi) || 0, sb: Number(h.stolenBases) || 0 };
  }
  if (s.pitching && (pos === 'P' || pos === 'TWP')) {
    const q = s.pitching;
    out.pit = { ip: q.inningsPitched, era: q.era, whip: q.whip, k: Number(q.strikeOuts) || 0, bb: Number(q.baseOnBalls) || 0, w: Number(q.wins) || 0, l: Number(q.losses) || 0, sv: Number(q.saves) || 0, gs: Number(q.gamesStarted) || 0 };
  }
  return out;
}

function createWorlds({ dir }) {
  fs.mkdirSync(dir, { recursive: true });
  const loaded = new Map(); // version -> world (small LRU)
  let latest = null, building = null, lastTry = 0;

  const fileFor = (v) => path.join(dir, `mlb-${v}.json`);
  function remember(w) {
    loaded.set(w.version, w);
    while (loaded.size > 4) loaded.delete(loaded.keys().next().value);
  }
  function newestOnDisk() {
    const files = fs.readdirSync(dir).filter((f) => /^mlb-.+\.json$/.test(f)).sort();
    for (const f of files.reverse()) {
      try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { /* corrupt: try older */ }
    }
    return null;
  }

  async function current() {
    if (!latest) { latest = newestOnDisk(); if (latest) remember(latest); }
    const stale = !latest || Date.now() - new Date(latest.builtAt).getTime() > REFRESH_MS;
    if (stale && !building && Date.now() - lastTry > 60_000) {
      lastTry = Date.now();
      building = build().then((w) => {
        const tmp = `${fileFor(w.version)}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(w)); fs.renameSync(tmp, fileFor(w.version));
        latest = w; remember(w);
        console.log(`[gm] new MLB world ${w.version}: ${w.counts.players} players, ${w.counts.freeAgents} free agents, ${w.counts.moves} moves`);
        return w;
      }).catch((e) => { console.error(`[gm] MLB refresh failed: ${e.message}`); if (!latest) throw e; return latest; })
        .finally(() => { building = null; });
    }
    if (!latest) return building; // first ever build: wait for it
    return latest; // otherwise serve the last good world while a refresh runs
  }

  function get(version) {
    if (loaded.has(version)) return loaded.get(version);
    try { const w = JSON.parse(fs.readFileSync(fileFor(version), 'utf8')); remember(w); return w; } catch { return null; }
  }

  // Remove snapshots older than two weeks that no save uses.
  function prune(inUse) {
    const keep = new Set(inUse); if (latest) keep.add(latest.version);
    for (const f of fs.readdirSync(dir)) {
      const m = /^mlb-(.+)\.json$/.exec(f); if (!m || keep.has(m[1])) continue;
      try { if (Date.now() - fs.statSync(path.join(dir, f)).mtimeMs > 14 * 864e5) fs.unlinkSync(path.join(dir, f)); } catch { /* ignore */ }
    }
  }

  return { current, get, prune };
}

module.exports = { createWorlds, build, seasons };

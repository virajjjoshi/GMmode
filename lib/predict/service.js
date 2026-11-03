// Prediction Leagues: every business rule lives here (permissions, invites,
// deadlines, results, standings). The HTTP layer only parses and forwards, and
// the UI only displays, so nothing security-relevant depends on the browser.
//
// Identity is the app's anonymous fan id (x-fan-id). Member-facing payloads use
// a separate public member id (mid) and never include fan ids.

const crypto = require('node:crypto');
const sports = require('./sports');
const S = require('./scoring');
const { etYmd } = require('./source');

class PlError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
const fail = (code, msg) => { throw new PlError(code, msg); };

const DAY = 864e5;
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L
const newCode = () => Array.from({ length: 8 }, () => CODE_CHARS[crypto.randomInt(CODE_CHARS.length)]).join('');
const newId = () => crypto.randomBytes(6).toString('base64url');
const GAME_KEY = /^[a-z0-9]{2,8}:\d{1,15}$/;
const OPEN = new Set(['scheduled', 'delayed']);

const DEFAULT_SETTINGS = Object.freeze({ maxMembers: 50, allowEdits: true, picksVisible: 'after_lock', lateJoin: true, membersCanInvite: true });
const FORMATS = { weekly_season: 'Weekly rounds + season standings', season: 'Season-long standings' };
const LIMITS = { leaguesOwned: 25, picksPerRequest: 60, seasonDays: 366, maxMembers: 500 };

function createService({ store, source, now = Date.now, log = console }) {
  const db = store.db;

  // ---------------- lookups ----------------
  const league = (id) => (typeof id === 'string' && Object.prototype.hasOwnProperty.call(db.leagues, id) ? db.leagues[id] : null);
  const membership = (lid, uid) => db.members[`${lid}:${uid}`] || null;
  const activeMember = (lid, uid) => { const m = uid && membership(lid, uid); return m?.status === 'active' ? m : null; };
  const activeMembers = (lid) => Object.values(db.members).filter((m) => m.leagueId === lid && m.status === 'active');
  const pickOf = (lid, uid, gameKey) => db.picks[`${lid}:${uid}:${gameKey}`] || null;

  function status(l, t = now()) {
    if (l.archived) return 'archived';
    if (t < l.seasonStart) return 'upcoming';
    if (t >= l.seasonEnd) return 'completed';
    return 'active';
  }

  function perms(l, m) {
    const owner = !!m && m.role === 'owner';
    const open = !l.archived;
    return {
      member: !!m, owner,
      invite: !!m && open && status(l) !== 'completed' && (owner || l.settings.membersCanInvite),
      edit: owner && open,
      pick: !!m && open,
    };
  }

  // A private league doesn't exist to outsiders.
  function viewable(lid, uid) {
    const l = league(lid);
    if (!l) fail(404, 'League not found.');
    const m = activeMember(lid, uid);
    if (!m && l.visibility !== 'public') fail(404, 'League not found.');
    return { l, m };
  }
  function asMember(lid, uid) {
    const { l, m } = viewable(lid, uid);
    if (!m) fail(403, 'Join this league to see that.');
    return { l, m };
  }
  function asOwner(lid, uid) {
    const { l, m } = asMember(lid, uid);
    if (m.role !== 'owner') fail(403, 'Only the league owner can do that.');
    return { l, m };
  }

  function logActivity(lid, type, text, mid = null) {
    const list = (db.activity[lid] ||= []);
    list.push({ at: now(), type, text, mid });
    if (list.length > 100) list.splice(0, list.length - 100);
  }

  // ---------------- games ----------------
  const significant = (g) => JSON.stringify([g.start, g.state, g.statusName, g.completed, g.detail, g.home?.score, g.away?.score, g.home?.winner, g.away?.winner, g.home?.record, g.away?.record, g.home?.logo]);

  function upsertEvent(ev) {
    if (!ev?.id || !sports.isCompetition(ev.league)) return null;
    const rec = sports.toRecord(ev, now());
    const prev = db.games[rec.key];
    rec.outcome = sports.outcome(rec);
    rec.firstSeenAt = prev?.firstSeenAt || rec.fetchedAt;
    if (prev && (prev.outcome ?? null) !== rec.outcome) {
      db.resultLog.push({ at: rec.fetchedAt, gameKey: rec.key, from: prev.outcome ?? null, to: rec.outcome, detail: rec.detail, provider: rec.provider, correction: prev.outcome != null });
      if (db.resultLog.length > 5000) db.resultLog.splice(0, db.resultLog.length - 5000);
    } else if (!prev && rec.outcome) {
      db.resultLog.push({ at: rec.fetchedAt, gameKey: rec.key, from: null, to: rec.outcome, detail: rec.detail, provider: rec.provider, correction: false });
    }
    const changed = !prev || significant(prev) !== significant(rec) || (prev.outcome ?? null) !== rec.outcome;
    db.games[rec.key] = rec;
    if (changed) store.save();
    return rec;
  }

  // Pull every day that overlaps [start, end) for the league's sports.
  // ESPN's ?dates= is a US Eastern day, so pad a day on each side.
  async function loadWindow(l, start, end) {
    const days = new Set();
    for (let t = start - DAY; t < end + DAY; t += DAY) days.add(etYmd(t));
    days.add(etYmd(end + DAY));
    const failed = new Set();
    await Promise.all(l.sports.flatMap((k) => [...days].map((d) => source.day(k, d)
      .then((evs) => { for (const ev of evs) upsertEvent(ev); })
      .catch(() => failed.add(k)))));
    return [...failed];
  }

  function gamesIn(l, start = l.seasonStart, end = l.seasonEnd) {
    const a = Math.max(start, l.seasonStart), b = Math.min(end, l.seasonEnd);
    return Object.values(db.games)
      .filter((g) => l.sports.includes(g.league) && g.start >= a && g.start < b && g.home?.id && g.away?.id)
      .sort((x, y) => x.start - y.start || x.key.localeCompare(y.key));
  }

  // ---------------- ESPN Matchup Predictor ----------------
  const probInflight = new Map();
  function probStale(p, t) {
    if (!p) return true;
    if (p.home) return t - p.retrievedAt > 15 * 60_000;
    return t - p.checkedAt > 30 * 60_000;
  }
  async function fetchProb(g) {
    if (probInflight.has(g.key)) return probInflight.get(g.key);
    const job = (async () => {
      const t = now();
      const prev = db.probs[g.key];
      try {
        const { event, predictor } = await source.game(g.league, g.id);
        const rec = upsertEvent(event) || g;
        // Associate by team id, never by position, so a swapped feed can't flip numbers.
        let home = null, away = null;
        if (predictor) {
          for (const side of [predictor.home, predictor.away]) {
            if (side.teamId === rec.home?.id) home = side.pct;
            else if (side.teamId === rec.away?.id) away = side.pct;
          }
        }
        if (home !== null && away !== null) {
          const snap = { home, away, at: t };
          const history = [...(prev?.history || [])];
          const last = history[history.length - 1];
          if (!last || last.home !== home || last.away !== away) history.push(snap);
          if (history.length > 30) history.splice(0, history.length - 30);
          db.probs[g.key] = {
            gameKey: g.key, home: { teamId: rec.home.id, pct: home }, away: { teamId: rec.away.id, pct: away },
            source: source.probabilitySource, label: predictor.header, retrievedAt: t, checkedAt: t, history,
          };
        } else if (prev?.home) {
          prev.checkedAt = t; // keep the last real values; the UI shows when they're from
        } else {
          db.probs[g.key] = { gameKey: g.key, unavailable: true, reason: predictor ? 'team-mismatch' : 'not-published', checkedAt: t };
        }
        store.save();
      } catch (e) {
        if (!prev) db.probs[g.key] = { gameKey: g.key, unavailable: true, reason: 'fetch-failed', checkedAt: t };
      }
    })().finally(() => probInflight.delete(g.key));
    probInflight.set(g.key, job);
    return job;
  }

  // Fetch missing/stale predictor values for open games, within a time budget.
  async function ensureProbs(games, budgetMs = 2500) {
    if (!source.probabilitySource) return;
    const t = now();
    const need = games.filter((g) => OPEN.has(sports.phase(g)) && g.start > t && g.start - t < 8 * DAY && probStale(db.probs[g.key], t));
    if (!need.length) return;
    // Soonest games first; the rest keep loading in the background after we respond.
    const queue = need.sort((a, b) => a.start - b.start).slice(0, 120);
    const worker = async () => { while (queue.length) await fetchProb(queue.shift()); };
    const all = Promise.all(Array.from({ length: 6 }, worker));
    await Promise.race([all, new Promise((r) => setTimeout(r, budgetMs).unref?.())]);
  }

  function probView(g) {
    if (!source.probabilitySource) return { status: 'disabled' };
    const p = db.probs[g.key];
    // After lock this is the last pregame value we captured, labelled as such.
    if (p?.home) return { status: 'ok', home: p.home.pct, away: p.away.pct, source: p.source, label: p.label, retrievedAt: p.retrievedAt, pregame: now() >= g.start };
    if (probInflight.has(g.key)) return { status: 'loading' };
    if (!p && OPEN.has(sports.phase(g)) && g.start > now() && g.start - now() < 8 * DAY) return { status: 'loading' };
    return { status: 'unavailable' };
  }

  // ---------------- picks ----------------
  function isOpen(g, t) { return OPEN.has(sports.phase(g)) && t < g.start; }

  function gradeFor(l, g, m, p) {
    return S.grade({ pick: p?.pick || null, outcome: g.outcome ?? null, drawPick: sports.drawPick(g.league), countMiss: l.rules.picks === 'all' && g.start >= m.joinedAt, rules: l.rules });
  }

  // needed | submitted | open | locked | in_progress | postponed | correct | incorrect | missed | push | void
  function pickStatus(l, g, m, p, t) {
    const ph = sports.phase(g);
    if (g.outcome != null) {
      const r = gradeFor(l, g, m, p).result;
      return r === 'none' ? (g.outcome === 'void' ? 'void' : 'closed') : r;
    }
    if (isOpen(g, t)) return p ? 'submitted' : l.rules.picks === 'all' ? 'needed' : 'open';
    if (ph === 'postponed' || ph === 'suspended') return 'postponed';
    if (ph === 'in') return 'in_progress';
    return 'locked';
  }

  function gameView(g) {
    return {
      key: g.key, league: g.league, id: g.id, sport: g.sport, season: g.season, start: g.start,
      phase: sports.phase(g), detail: g.detail, outcome: g.outcome ?? null, drawPick: sports.drawPick(g.league),
      home: g.home, away: g.away, provider: g.provider, updatedAt: g.fetchedAt,
    };
  }

  // Others' picks stay hidden until the game locks, unless the league says otherwise.
  const revealed = (l, g, t) => l.settings.picksVisible === 'always' || t >= g.start || !OPEN.has(sports.phase(g));

  function splitFor(l, g, t) {
    if (!revealed(l, g, t)) return null;
    const c = { home: 0, away: 0, draw: 0 };
    for (const m of activeMembers(l.id)) { const p = pickOf(l.id, m.uid, g.key); if (p) c[p.pick]++; }
    return c;
  }

  async function slate(uid, lid, week) {
    const { l, m } = asMember(lid, uid);
    const total = S.weekCount(l);
    let n = Math.min(Math.max(1, week || S.currentWeek(l, now())), total);
    let range = S.weekRange(l, n);
    let failed = await loadWindow(l, range.start, range.end);
    let games = gamesIn(l, range.start, range.end);
    // No week asked for and this one is played out: open on the next one.
    if (!week && n < total && !games.some((g) => isOpen(g, now()))) {
      const next = S.weekRange(l, n + 1);
      const f2 = await loadWindow(l, next.start, next.end);
      const g2 = gamesIn(l, next.start, next.end);
      if (g2.some((g) => isOpen(g, now()))) { n += 1; range = next; games = g2; failed = f2; }
    }
    await ensureProbs(games);
    const t = now();
    return {
      league: leagueView(l, m), week: range, weeks: total, failed,
      probabilitySource: source.probabilitySource,
      games: games.map((g) => {
        const p = pickOf(l.id, uid, g.key);
        const gr = gradeFor(l, g, m, p);
        return {
          ...gameView(g), prob: probView(g), split: splitFor(l, g, t),
          editable: isOpen(g, t) && (!p || l.settings.allowEdits),
          mine: p ? { pick: p.pick, submittedAt: p.submittedAt, updatedAt: p.updatedAt, auto: false } : (gr.auto ? { pick: 'home', auto: true } : null),
          status: pickStatus(l, g, m, p, t), points: gr.points,
        };
      }),
    };
  }

  async function savePicks(uid, lid, items) {
    const { l, m } = asMember(lid, uid);
    if (l.archived) fail(409, 'This league is archived. No more picks.');
    if (!Array.isArray(items) || !items.length) fail(400, 'No picks to save.');
    if (items.length > LIMITS.picksPerRequest) fail(400, `Save at most ${LIMITS.picksPerRequest} picks at a time.`);
    const want = new Map();
    for (const it of items) {
      const key = String(it?.game || '');
      if (!GAME_KEY.test(key)) fail(400, 'Unknown game.');
      want.set(key, String(it.pick || ''));
    }
    // Re-check every game against the provider right now. The browser's idea of
    // "not started yet" is never trusted.
    const fresh = new Map();
    await Promise.all([...want.keys()].map(async (key) => {
      const [lg, id] = key.split(':');
      if (!l.sports.includes(lg)) return;
      try { const { event } = await source.game(lg, id); fresh.set(key, upsertEvent(event)); }
      catch { const g = db.games[key]; if (g && now() - g.fetchedAt < 2 * 60_000) fresh.set(key, g); }
    }));

    const t = now(); // after the awaits: no time-of-check gap
    const results = [];
    const savedWeeks = new Set();
    let saved = 0;
    for (const [key, pick] of want) {
      const res = (ok, msg) => { results.push({ game: key, ok, pick, error: ok ? undefined : msg }); };
      const [lg] = key.split(':');
      if (!l.sports.includes(lg)) { res(false, 'That game isn\'t part of this league.'); continue; }
      const g = fresh.get(key);
      if (!g) { res(false, 'Couldn\'t confirm the game\'s status with the data provider. Try again in a moment.'); continue; }
      if (!g.home?.id || !g.away?.id) { res(false, 'Teams for this game aren\'t set yet.'); continue; }
      if (g.start < l.seasonStart || g.start >= l.seasonEnd) { res(false, 'That game is outside this league\'s season.'); continue; }
      const choices = sports.drawPick(lg) ? ['home', 'away', 'draw'] : ['home', 'away'];
      if (!choices.includes(pick)) { res(false, 'Pick a team.'); continue; }
      const ph = sports.phase(g);
      if (ph === 'postponed' || ph === 'suspended') { res(false, 'This game is postponed. Picks reopen if it gets a new start time.'); continue; }
      if (!isOpen(g, t)) { res(false, 'Too late. This game is locked.'); continue; }
      const pk = `${l.id}:${uid}:${key}`;
      const existing = db.picks[pk];
      if (existing && existing.pick === pick) { res(true); continue; }
      if (existing && !l.settings.allowEdits) { res(false, 'Picks are final in this league. You already picked this game.'); continue; }
      const history = [...(existing?.history || []), { pick, at: t }].slice(-20);
      db.picks[pk] = {
        id: existing?.id || newId(), leagueId: l.id, uid, gameKey: key, pick, confidence: null,
        submittedAt: existing?.submittedAt || t, updatedAt: t, lockAt: g.start, history,
      };
      saved++;
      savedWeeks.add(S.weekOf(l, g.start));
      res(true);
    }
    if (saved) {
      m.loggedWeeks ||= [];
      for (const wk of [...savedWeeks].filter(Boolean).sort((a, b) => a - b)) {
        if (!m.loggedWeeks.includes(wk)) { m.loggedWeeks.push(wk); logActivity(l.id, 'picks', `${m.name} is locked in for week ${wk}`, m.mid); }
      }
      store.save();
    }
    return { saved, results };
  }

  // ---------------- standings ----------------
  function weekTallies(l, games) {
    const ms = activeMembers(l.id);
    const byWeek = new Map();
    for (const g of games) {
      const w = S.weekOf(l, g.start);
      if (!w) continue;
      if (!byWeek.has(w)) byWeek.set(w, new Map(ms.map((m) => [m.mid, S.emptyRow()])));
      const rows = byWeek.get(w);
      for (const m of ms) S.tally(rows.get(m.mid), gradeFor(l, g, m, pickOf(l.id, m.uid, g.key)));
    }
    return { ms, byWeek };
  }

  function rowsFrom(l, ms, sums, uid) {
    const rows = ms.map((m) => S.finish({ ...S.emptyRow(), ...(sums.get(m.mid) || {}), mid: m.mid, name: m.name, avatar: m.avatar, role: m.role, joinedAt: m.joinedAt, me: m.uid === uid }));
    return S.rank(rows, l.rules.ties);
  }
  const sumRows = (maps) => {
    const out = new Map();
    for (const rows of maps) for (const [mid, r] of rows) {
      const o = out.get(mid) || S.emptyRow();
      for (const k of Object.keys(o)) o[k] += r[k] || 0;
      out.set(mid, o);
    }
    return out;
  };

  function weekState(l, n, t) {
    const range = S.weekRange(l, n);
    const games = gamesIn(l, range.start, range.end);
    const unresolved = games.filter((g) => g.outcome == null);
    const final = t >= range.end && games.length > 0 && !unresolved.length;
    return {
      ...range, games: games.length, final: final, resolved: games.length - unresolved.length,
      started: t >= range.start, postponed: unresolved.filter((g) => ['postponed', 'suspended'].includes(sports.phase(g))).length,
      lastStart: games.length ? games[games.length - 1].start : null,
    };
  }

  async function weekBoard(uid, lid, week) {
    const { l, m } = asMember(lid, uid);
    const total = S.weekCount(l);
    const n = Math.min(Math.max(1, week || S.currentWeek(l, now())), total);
    const range = S.weekRange(l, n);
    if (range.end > now() - 3 * DAY && range.start < now() + DAY) await loadWindow(l, range.start, range.end);
    const t = now();
    const games = gamesIn(l, range.start, range.end);
    const { ms, byWeek } = weekTallies(l, games);
    const rows = rowsFrom(l, ms, byWeek.get(n) || new Map(), uid);
    const leader = rows[0];
    for (const r of rows) r.behind = leader ? leader.points - r.points : 0;
    return { league: leagueView(l, m), week: weekState(l, n, t), weeks: total, rows };
  }

  function seasonTable(l, uid, t = now()) {
    const games = gamesIn(l, l.seasonStart, Math.min(l.seasonEnd, t + 400 * DAY));
    const { ms, byWeek } = weekTallies(l, games);
    const cw = S.currentWeek(l, t);
    const weeks = [...byWeek.keys()].sort((a, b) => a - b);
    const rows = rowsFrom(l, ms, sumRows(byWeek.values()), uid);
    // Movement: where you stood before the current week's results vs now.
    const before = rowsFrom(l, ms, sumRows(weeks.filter((w) => w < cw).map((w) => byWeek.get(w))), uid);
    const prevRank = new Map(before.map((r) => [r.mid, r.rank]));
    const hasHistory = weeks.some((w) => w < cw) && weeks.includes(cw);
    for (const r of rows) {
      r.weekly = weeks.filter((w) => w <= cw).map((w) => ({ week: w, points: byWeek.get(w).get(r.mid)?.points || 0 }));
      r.move = hasHistory ? prevRank.get(r.mid) - r.rank : null;
    }
    return { rows, weeks: weeks.filter((w) => w <= cw) };
  }

  async function seasonBoard(uid, lid) {
    const { l, m } = asMember(lid, uid);
    const t = now();
    return { league: leagueView(l, m), ...seasonTable(l, uid, t), currentWeek: S.currentWeek(l, t), totalWeeks: S.weekCount(l) };
  }

  // A member's picks as another member is allowed to see them.
  function picksFor(l, target, viewerUid, t) {
    const self = target.uid === viewerUid;
    return gamesIn(l).filter((g) => g.start <= t + 400 * DAY)
      .map((g) => ({ g, p: pickOf(l.id, target.uid, g.key) }))
      .filter(({ g, p }) => (p || g.outcome != null) && (self || revealed(l, g, t)))
      .map(({ g, p }) => {
        const gr = gradeFor(l, g, target, p);
        if (!p && gr.result === 'none') return null;
        return { game: gameView(g), week: S.weekOf(l, g.start), pick: p?.pick || (gr.auto ? 'home' : null), auto: !!gr.auto, status: pickStatus(l, g, target, p, t), points: gr.points };
      })
      .filter(Boolean)
      .sort((a, b) => b.game.start - a.game.start)
      .slice(0, 300);
  }

  function memberProfile(uid, lid, mid) {
    const { l, m } = asMember(lid, uid);
    const target = activeMembers(lid).find((x) => x.mid === mid);
    if (!target) fail(404, 'That member isn\'t in this league.');
    const t = now();
    const season = seasonTable(l, uid, t);
    const row = season.rows.find((r) => r.mid === mid);
    return {
      league: leagueView(l, m),
      member: { mid: target.mid, name: target.name, avatar: target.avatar, role: target.role, joinedAt: target.joinedAt, me: target.uid === uid },
      row, picks: picksFor(l, target, uid, t),
      hiddenNote: target.uid !== uid && l.settings.picksVisible !== 'always' ? 'Picks for games that haven\'t started stay hidden until they lock.' : null,
    };
  }

  // ---------------- views ----------------
  const compMeta = (k) => { const c = sports.competitions().find((x) => x.key === k); return c ? { key: c.key, label: c.label, emoji: c.emoji, sport: c.sport } : { key: k, label: k, emoji: '🏟️' }; };
  function ownerOf(l) { return Object.values(db.members).find((m) => m.leagueId === l.id && m.role === 'owner') || null; }

  function leagueView(l, m) {
    const t = now();
    const owner = ownerOf(l);
    return {
      id: l.id, name: l.name, description: l.description, avatar: l.avatar, visibility: l.visibility,
      status: status(l, t), sports: l.sports.map(compMeta), seasonStart: l.seasonStart, seasonEnd: l.seasonEnd,
      weeks: S.weekCount(l), currentWeek: S.currentWeek(l, t), format: l.format, formatLabel: FORMATS[l.format],
      rules: l.rules, scoring: S.FORMATS[l.rules.format], settings: l.settings, createdAt: l.createdAt, updatedAt: l.updatedAt,
      ownerName: owner ? owner.name : null, members: activeMembers(l.id).length,
      perms: perms(l, m), me: m ? { mid: m.mid, role: m.role, joinedAt: m.joinedAt } : null,
      started: t >= l.seasonStart,
    };
  }

  function joinProblem(l, uid, t = now()) {
    const existing = membership(l.id, uid);
    if (existing?.status === 'active') return 'You\'re already in this league.';
    if (existing?.status === 'removed') return 'The league owner removed you from this league.';
    if (l.archived) return 'This league is archived.';
    if (status(l, t) === 'completed') return 'This league\'s season is over.';
    if (t >= l.seasonStart && !l.settings.lateJoin) return 'This league doesn\'t take new members after the season starts.';
    if (activeMembers(l.id).length >= l.settings.maxMembers) return 'This league is full.';
    return null;
  }

  // ---------------- league lifecycle ----------------
  function validateCore(input, base, t) {
    const out = {};
    const sportsIn = Array.isArray(input.sports) ? [...new Set(input.sports.map(String))] : base.sports;
    if (!sportsIn?.length) fail(400, 'Pick at least one sport.');
    if (sportsIn.length > 10 || !sportsIn.every(sports.isCompetition)) fail(400, 'Unknown sport.');
    out.sports = sportsIn;
    const start = input.seasonStart !== undefined ? Number(input.seasonStart) : base.seasonStart;
    const end = input.seasonEnd !== undefined ? Number(input.seasonEnd) : base.seasonEnd;
    if (!Number.isFinite(start) || !Number.isFinite(end)) fail(400, 'Pick a season start and end date.');
    if (end <= start) fail(400, 'The season has to end after it starts.');
    if (end - start > LIMITS.seasonDays * DAY) fail(400, 'Seasons can be at most a year long.');
    if (end <= t) fail(400, 'That season is already over. Pick an end date in the future.');
    if (start < t - 14 * DAY) fail(400, 'The season can start at most two weeks in the past.');
    out.seasonStart = start; out.seasonEnd = end;
    const format = input.format ?? base.format;
    if (!FORMATS[format]) fail(400, 'Unknown competition format.');
    out.format = format;
    const r = { ...S.DEFAULT_RULES, ...(base.rules || {}), ...(input.rules || {}) };
    if (!S.FORMATS[r.format]) fail(400, 'Unknown scoring format.');
    if (!S.FORMATS[r.format].available) fail(400, `${S.FORMATS[r.format].label} isn't available yet. Use Classic pick'em.`);
    if (!['all', 'select'].includes(r.picks)) fail(400, 'Bad pick mode.');
    if (!['zero', 'home'].includes(r.missed)) fail(400, 'Bad missed-pick rule.');
    if (!['shared', 'break'].includes(r.ties)) fail(400, 'Bad tie rule.');
    out.rules = { format: r.format, correct: 1, picks: r.picks, missed: r.missed, ties: r.ties };
    return out;
  }

  function validateSettings(input, base, memberCount = 0) {
    const s = { ...DEFAULT_SETTINGS, ...(base || {}) };
    const src = input.settings || {};
    if (src.maxMembers !== undefined) {
      const n = Number(src.maxMembers);
      if (!Number.isInteger(n) || n < 2 || n > LIMITS.maxMembers) fail(400, `Max members must be between 2 and ${LIMITS.maxMembers}.`);
      if (n < memberCount) fail(400, `The league already has ${memberCount} members.`);
      s.maxMembers = n;
    }
    for (const k of ['allowEdits', 'lateJoin', 'membersCanInvite']) if (src[k] !== undefined) s[k] = !!src[k];
    if (src.picksVisible !== undefined) {
      if (!['after_lock', 'always'].includes(src.picksVisible)) fail(400, 'Bad pick visibility.');
      s.picksVisible = src.picksVisible;
    }
    return s;
  }

  function basics(input, base = {}) {
    const name = input.name !== undefined ? String(input.name).trim() : base.name;
    if (!name || name.length < 3 || name.length > 40) fail(400, 'League name needs 3 to 40 characters.');
    const description = input.description !== undefined ? String(input.description).trim().slice(0, 200) : (base.description || '');
    const avatar = input.avatar !== undefined ? String(input.avatar).slice(0, 8) || '🎯' : (base.avatar || '🎯');
    const visibility = input.visibility ?? base.visibility ?? 'private';
    if (!['public', 'private'].includes(visibility)) fail(400, 'Visibility must be public or private.');
    return { name, description, avatar, visibility };
  }

  function makeInvite(l, uid, { expiresInDays = null, maxUses = null } = {}) {
    let code; do { code = newCode(); } while (db.invites[code]);
    const days = expiresInDays === null || expiresInDays === undefined || expiresInDays === '' ? null : Number(expiresInDays);
    if (days !== null && (!Number.isInteger(days) || days < 1 || days > 90)) fail(400, 'Invite expiry must be 1 to 90 days, or never.');
    const uses = maxUses === null || maxUses === undefined || maxUses === '' ? null : Number(maxUses);
    if (uses !== null && (!Number.isInteger(uses) || uses < 1 || uses > 500)) fail(400, 'Invite max uses must be 1 to 500, or unlimited.');
    const t = now();
    db.invites[code] = { code, leagueId: l.id, createdBy: uid, createdAt: t, expiresAt: days ? t + days * DAY : null, maxUses: uses, uses: 0, status: 'active' };
    return db.invites[code];
  }

  function createLeague(uid, input, profile) {
    if (!uid) fail(400, 'Missing fan id. Refresh the page.');
    if (!profile?.name || profile.name.length < 2) fail(400, 'Pick a display name first (2+ characters).');
    const t = now();
    const owned = Object.values(db.members).filter((m) => m.uid === uid && m.role === 'owner' && !db.leagues[m.leagueId]?.archived).length;
    if (owned >= LIMITS.leaguesOwned) fail(429, `You already run ${owned} leagues. Archive one first.`);
    const b = basics(input);
    const core = validateCore(input, { format: 'weekly_season' }, t);
    const settings = validateSettings(input, DEFAULT_SETTINGS);
    let id; do { id = newId(); } while (db.leagues[id]);
    const l = { id, ...b, ...core, settings, ownerUid: uid, archived: false, createdAt: t, updatedAt: t };
    db.leagues[id] = l;
    db.members[`${id}:${uid}`] = { leagueId: id, uid, mid: newId(), role: 'owner', status: 'active', joinedAt: t, via: 'create', name: profile.name, avatar: profile.avatar || '🙂' };
    makeInvite(l, uid);
    logActivity(id, 'created', `${profile.name} created the league`);
    store.save();
    return leagueView(l, db.members[`${id}:${uid}`]);
  }

  function updateLeague(uid, lid, input) {
    const { l, m } = asOwner(lid, uid);
    if (l.archived) fail(409, 'This league is archived.');
    const t = now();
    const coreKeys = ['sports', 'seasonStart', 'seasonEnd', 'format', 'rules'];
    const touchesCore = coreKeys.some((k) => input[k] !== undefined && JSON.stringify(input[k]) !== JSON.stringify(l[k]));
    if (touchesCore && t >= l.seasonStart) fail(409, 'Sports, season dates, format and scoring rules lock once the season starts.');
    const b = basics(input, l);
    const core = touchesCore ? validateCore(input, l, t) : {};
    const settings = validateSettings(input, l.settings, activeMembers(lid).length);
    Object.assign(l, b, core, { settings, updatedAt: t });
    logActivity(lid, 'settings', `${m.name} updated the league settings`, m.mid);
    store.save();
    return leagueView(l, m);
  }

  function archiveLeague(uid, lid) {
    const { l, m } = asOwner(lid, uid);
    if (l.archived) return leagueView(l, m);
    l.archived = true; l.updatedAt = now();
    for (const inv of Object.values(db.invites)) if (inv.leagueId === lid && inv.status === 'active') inv.status = 'revoked';
    logActivity(lid, 'archived', `${m.name} archived the league. Standings are final.`, m.mid);
    store.save();
    return leagueView(l, m);
  }

  function invitationFor(l) {
    const t = now();
    return Object.values(db.invites).filter((i) => i.leagueId === l.id && i.status === 'active' && (!i.expiresAt || i.expiresAt > t) && (i.maxUses === null || i.uses < i.maxUses))
      .sort((a, b) => b.createdAt - a.createdAt)[0] || null;
  }

  function getInvite(uid, lid) {
    const { l, m } = asMember(lid, uid);
    if (!perms(l, m).invite) fail(403, 'Only the league owner can share invites for this league.');
    const inv = invitationFor(l);
    return { invite: inv && { code: inv.code, expiresAt: inv.expiresAt, maxUses: inv.maxUses, uses: inv.uses, createdAt: inv.createdAt }, canManage: m.role === 'owner' };
  }

  function manageInvite(uid, lid, { action, expiresInDays, maxUses } = {}) {
    const { l, m } = asOwner(lid, uid);
    if (l.archived) fail(409, 'This league is archived.');
    if (!['regenerate', 'revoke'].includes(action)) fail(400, 'Unknown invite action.');
    for (const inv of Object.values(db.invites)) if (inv.leagueId === lid && inv.status === 'active') inv.status = 'revoked';
    if (action === 'regenerate') makeInvite(l, uid, { expiresInDays, maxUses });
    logActivity(lid, 'invite', action === 'revoke' ? `${m.name} turned off the invite link` : `${m.name} made a new invite link`, m.mid);
    store.save();
    return getInvite(uid, lid);
  }

  function checkInvite(code) {
    const c = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const inv = c.length === 8 ? db.invites[c] : null;
    if (!inv) fail(404, 'That invite code doesn\'t exist. Check it for typos.');
    const l = league(inv.leagueId);
    if (!l) fail(404, 'That invite code doesn\'t exist.');
    if (inv.status !== 'active') fail(410, 'This invite was turned off by the league owner. Ask them for a new one.');
    if (inv.expiresAt && inv.expiresAt <= now()) fail(410, 'This invite has expired. Ask the league owner for a new one.');
    if (inv.maxUses !== null && inv.uses >= inv.maxUses) fail(410, 'This invite has been used up. Ask the league owner for a new one.');
    return { inv, l };
  }

  function invitePreview(uid, code) {
    const { inv, l } = checkInvite(code);
    const v = leagueView(l, activeMember(l.id, uid));
    return { code: inv.code, league: publicCard(l, v), problem: joinProblem(l, uid), alreadyMember: !!activeMember(l.id, uid) };
  }

  function publicCard(l, v = leagueView(l, null)) {
    return {
      id: v.id, name: v.name, description: v.description, avatar: v.avatar, visibility: v.visibility, status: v.status,
      sports: v.sports, ownerName: v.ownerName, members: v.members, maxMembers: l.settings.maxMembers,
      format: v.format, formatLabel: v.formatLabel, scoring: v.scoring.label, picks: l.rules.picks,
      seasonStart: v.seasonStart, seasonEnd: v.seasonEnd, weeks: v.weeks,
    };
  }

  function join(uid, lid, { code, profile } = {}) {
    if (!uid) fail(400, 'Missing fan id. Refresh the page.');
    if (!profile?.name || profile.name.length < 2) fail(400, 'Pick a display name first (2+ characters).');
    let l, inv = null;
    if (code) {
      ({ inv, l } = checkInvite(code));
      if (lid && l.id !== lid) fail(400, 'That invite is for a different league.');
    } else {
      l = league(lid);
      if (!l || l.visibility !== 'public') fail(404, 'League not found.');
    }
    const problem = joinProblem(l, uid);
    if (problem) fail(409, problem);
    const t = now();
    const key = `${l.id}:${uid}`;
    const prev = db.members[key];
    db.members[key] = { ...(prev || {}), leagueId: l.id, uid, mid: prev?.mid || newId(), role: 'member', status: 'active', joinedAt: t, via: inv ? 'invite' : 'public', name: profile.name, avatar: profile.avatar || '🙂' };
    if (inv) inv.uses++;
    logActivity(l.id, 'joined', `${profile.name} joined the league`, db.members[key].mid);
    store.save();
    return leagueView(l, db.members[key]);
  }

  function leave(uid, lid) {
    const { l, m } = asMember(lid, uid);
    if (m.role === 'owner') fail(409, 'Owners can\'t leave their own league. Archive it instead.');
    m.status = 'left'; m.leftAt = now();
    logActivity(l.id, 'left', `${m.name} left the league`, m.mid);
    store.save();
    return { ok: true };
  }

  function removeMember(uid, lid, mid) {
    const { l, m } = asOwner(lid, uid);
    const target = activeMembers(lid).find((x) => x.mid === mid);
    if (!target) fail(404, 'That member isn\'t in this league.');
    if (target.role === 'owner') fail(409, 'You can\'t remove the owner.');
    target.status = 'removed'; target.removedAt = now();
    logActivity(l.id, 'removed', `${m.name} removed ${target.name} from the league`, m.mid);
    store.save();
    return { ok: true };
  }

  function members(uid, lid) {
    const { l, m } = asMember(lid, uid);
    const season = seasonTable(l, uid);
    const rankOf = new Map(season.rows.map((r) => [r.mid, r]));
    return {
      league: leagueView(l, m),
      members: activeMembers(lid).sort((a, b) => (a.role === 'owner' ? -1 : 0) - (b.role === 'owner' ? -1 : 0) || a.joinedAt - b.joinedAt)
        .map((x) => ({ mid: x.mid, name: x.name, avatar: x.avatar, role: x.role, joinedAt: x.joinedAt, me: x.uid === uid, rank: rankOf.get(x.mid)?.rank ?? null, points: rankOf.get(x.mid)?.points ?? 0 })),
    };
  }

  // ---------------- dashboards ----------------
  function myWeekSummary(l, m, games, t) {
    let needed = 0, submitted = 0, open = 0, nextDeadline = null;
    for (const g of games) {
      if (!isOpen(g, t)) continue;
      open++;
      if (pickOf(l.id, m.uid, g.key)) { submitted++; continue; }
      if (l.rules.picks === 'all') needed++;
      if (!nextDeadline || g.start < nextDeadline) nextDeadline = g.start; // games arrive sorted, but be safe
    }
    return { needed, submitted, open, nextDeadline };
  }

  function recentResults(l, m, limit = 6) {
    return picksFor(l, m, m.uid, now()).filter((x) => ['correct', 'incorrect', 'missed', 'push', 'void'].includes(x.status)).slice(0, limit);
  }

  // What's due soon is a rolling 7 days, not the league week: on a Monday night
  // the current week is done but next week's games are already open.
  const SOON = 7 * DAY;
  async function loadAround(l, t) {
    const range = S.weekRange(l, S.currentWeek(l, t));
    const st = status(l, t);
    if (st !== 'active' && st !== 'upcoming') return { range, failed: [] };
    return { range, failed: await loadWindow(l, Math.min(range.start, t), Math.max(range.end, t + SOON)) };
  }

  async function leagueOverview(uid, lid) {
    const { l, m } = viewable(lid, uid);
    const v = leagueView(l, m);
    if (!m) return { league: v, preview: publicCard(l, v), joinProblem: joinProblem(l, uid) };
    const n = S.currentWeek(l, now());
    const { range, failed } = await loadAround(l, now());
    const t = now();
    const games = gamesIn(l, range.start, range.end);
    const soon = gamesIn(l, t, t + SOON);
    const season = seasonTable(l, uid, t);
    const { ms, byWeek } = weekTallies(l, games);
    const weekRows = rowsFrom(l, ms, byWeek.get(n) || new Map(), uid);
    const upcoming = soon.filter((g) => isOpen(g, t)).slice(0, 6).map((g) => ({ ...gameView(g), week: S.weekOf(l, g.start), mine: pickOf(l.id, uid, g.key)?.pick || null }));
    return {
      league: v, failed,
      week: weekState(l, n, t),
      soon: myWeekSummary(l, m, soon, t),
      season: season.rows.slice(0, 10), me: season.rows.find((r) => r.me) || null,
      weekTop: weekRows.slice(0, 5), upcoming,
      recent: recentResults(l, m),
      activity: (db.activity[lid] || []).slice(-15).reverse(),
    };
  }

  async function home(uid) {
    const t = now();
    const mine = Object.values(db.members).filter((m) => m.uid === uid && m.status === 'active' && league(m.leagueId));
    const cards = await Promise.all(mine.map(async (m) => {
      const l = league(m.leagueId);
      await loadAround(l, t).catch(() => {});
      const t2 = now();
      const soon = l.archived ? [] : gamesIn(l, t2, t2 + SOON);
      const season = seasonTable(l, uid, t2);
      const me = season.rows.find((r) => r.me);
      return {
        ...leagueView(l, m), rank: me?.rank ?? null, points: me?.points ?? 0, tied: !!me?.tied,
        week: myWeekSummary(l, m, soon, t2),
        recent: recentResults(l, m, 4).map((x) => ({ ...x, leagueId: l.id, leagueName: l.name })),
        upcoming: soon.filter((g) => isOpen(g, t2) && !pickOf(l.id, uid, g.key)).slice(0, 4).map((g) => ({ ...gameView(g), leagueId: l.id, leagueName: l.name })),
        activity: (db.activity[l.id] || []).slice(-5).map((a) => ({ ...a, leagueId: l.id, leagueName: l.name })),
      };
    }));
    const order = { active: 0, upcoming: 1, completed: 2, archived: 3 };
    cards.sort((a, b) => order[a.status] - order[b.status] || (a.week.nextDeadline || Infinity) - (b.week.nextDeadline || Infinity));
    const deadlines = cards.filter((c) => c.week.nextDeadline && (c.week.needed || c.rules.picks === 'select'))
      .map((c) => ({ leagueId: c.id, leagueName: c.name, avatar: c.avatar, at: c.week.nextDeadline, needed: c.week.needed, open: c.week.open, picks: c.rules.picks }))
      .sort((a, b) => a.at - b.at);
    return {
      leagues: cards.map(({ recent, upcoming, activity, ...c }) => c),
      deadlines,
      needed: cards.reduce((a, c) => a + c.week.needed, 0),
      recent: cards.flatMap((c) => c.recent).sort((a, b) => b.game.start - a.game.start).slice(0, 8),
      upcoming: cards.flatMap((c) => c.upcoming).sort((a, b) => a.start - b.start).slice(0, 8),
      activity: cards.flatMap((c) => c.activity).sort((a, b) => b.at - a.at).slice(0, 10),
    };
  }

  function discover(uid) {
    const t = now();
    return Object.values(db.leagues)
      .filter((l) => l.visibility === 'public' && !l.archived && !activeMember(l.id, uid) && !joinProblem(l, uid, t))
      .map((l) => publicCard(l))
      .sort((a, b) => b.members - a.members || b.seasonStart - a.seasonStart)
      .slice(0, 60);
  }

  function myStats(uid) {
    const t = now();
    const ms = Object.values(db.members).filter((m) => m.uid === uid && m.status !== 'removed' && league(m.leagueId));
    const overall = { picks: 0, correct: 0, incorrect: 0, push: 0, void: 0, pending: 0 };
    const bySport = {}; const byWeek = {}; const decided = [];
    const leagues = [];
    for (const m of ms) {
      const l = league(m.leagueId);
      const season = seasonTable(l, uid, t);
      const row = season.rows.find((r) => r.me);
      leagues.push({ id: l.id, name: l.name, avatar: l.avatar, status: status(l, t), active: m.status === 'active', rank: row?.rank ?? null, of: season.rows.length, points: row?.points ?? 0, correct: row?.correct ?? 0, incorrect: row?.incorrect ?? 0, missed: row?.missed ?? 0, accuracy: row?.accuracy ?? null });
      for (const g of gamesIn(l)) {
        const p = pickOf(l.id, uid, g.key);
        if (!p) continue; // overall record = predictions actually made
        const r = gradeFor(l, g, m, p).result;
        overall.picks++;
        if (overall[r] !== undefined) overall[r]++;
        const sp = (bySport[g.league] ||= { ...compMeta(g.league), picks: 0, correct: 0, incorrect: 0 });
        sp.picks++; if (r === 'correct') sp.correct++; if (r === 'incorrect') sp.incorrect++;
        if (r === 'correct' || r === 'incorrect') {
          decided.push({ at: g.start, ok: r === 'correct' });
          const d = new Date(g.start); const dow = (d.getUTCDay() + 6) % 7;
          const wk = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dow);
          const w = (byWeek[wk] ||= { start: wk, correct: 0, incorrect: 0 });
          w[r]++;
        }
      }
    }
    decided.sort((a, b) => a.at - b.at);
    let best = 0, run = 0;
    for (const d of decided) { run = d.ok ? run + 1 : 0; best = Math.max(best, run); }
    let current = null;
    if (decided.length) {
      const last = decided[decided.length - 1].ok; let n = 0;
      for (let i = decided.length - 1; i >= 0 && decided[i].ok === last; i--) n++;
      current = { kind: last ? 'correct' : 'incorrect', length: n };
    }
    const acc = (c, i) => (c + i ? Math.round((c / (c + i)) * 1000) / 10 : null);
    return {
      overall: { ...overall, accuracy: acc(overall.correct, overall.incorrect) },
      leagues,
      bySport: Object.values(bySport).map((s) => ({ ...s, accuracy: acc(s.correct, s.incorrect) })).sort((a, b) => b.picks - a.picks),
      byWeek: Object.values(byWeek).sort((a, b) => a.start - b.start).map((w) => ({ ...w, accuracy: acc(w.correct, w.incorrect) })),
      streak: { current, best },
    };
  }

  function touch(uid, name, avatar) {
    if (!uid || !name || name.length < 2) return;
    let dirty = false;
    for (const m of Object.values(db.members)) {
      if (m.uid === uid && (m.name !== name || m.avatar !== avatar)) { m.name = name; m.avatar = avatar || m.avatar; dirty = true; }
    }
    if (dirty) store.save();
  }

  // ---------------- results sync ----------------
  // Keeps game records (and so every table) current for leagues in play,
  // including the previous week so late finishes and stat corrections land.
  async function sync() {
    const t = now();
    const seen = new Set();
    for (const l of Object.values(db.leagues)) {
      const st = status(l, t);
      if (l.archived || !activeMembers(l.id).length) continue;
      if (st === 'completed' && t - l.seasonEnd > 7 * DAY) continue;
      if (st === 'upcoming' && l.seasonStart - t > 7 * DAY) continue;
      const cw = S.currentWeek(l, t);
      for (const w of [cw - 1, cw, cw + 1]) {
        if (w < 1 || w > S.weekCount(l)) continue;
        const r = S.weekRange(l, w);
        const key = `${l.sports.join(',')}:${r.start}:${r.end}`;
        if (seen.has(key)) continue;
        seen.add(key);
        try { await loadWindow(l, r.start, r.end); } catch (e) { log.error?.(`[predict] sync ${l.id}: ${e.message}`); }
      }
    }
  }

  function config() {
    return {
      competitions: sports.competitions(),
      formats: FORMATS,
      scoring: S.FORMATS,
      defaults: { rules: S.DEFAULT_RULES, settings: DEFAULT_SETTINGS },
      limits: LIMITS,
      probabilitySource: source.probabilitySource,
      dataSource: source.name,
    };
  }

  return {
    config, createLeague, updateLeague, archiveLeague, join, leave, removeMember, members,
    getInvite, manageInvite, invitePreview, slate, savePicks, weekBoard, seasonBoard, memberProfile,
    leagueOverview, home, discover, myStats, touch, sync,
    // exposed for tests / admin scripts
    _upsertEvent: upsertEvent, _db: db,
  };
}

module.exports = { createService, PlError, DEFAULT_SETTINGS, FORMATS };

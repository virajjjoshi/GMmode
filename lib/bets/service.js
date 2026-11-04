// Bets: linked sportsbook accounts, live tracking, and the social bits
// (Tail or Fade, Bad Beat Hall of Fame, receipts on takes).
//
// Bets are private by default. Nothing about a fan's bets is shown to anyone
// else unless they share that specific slip.

const espn = require('../espn');
const track = require('./track');
const demo = require('./demo');
const sharp = require('./sharpsports');
const roast = require('./roast');

class BetError extends Error { constructor(code, msg) { super(msg); this.code = code; } }

const etFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
const etYmd = (t) => etFmt.format(new Date(t)).replaceAll('-', '');
const daysAgo = (n) => etYmd(Date.now() - n * 86400_000);

const BOOKS = ['DraftKings', 'FanDuel', 'BetMGM', 'Caesars', 'Fanatics', 'bet365', 'BetRivers', 'and 30+ more'];

// Simulated fans so Tail or Fade and the Hall of Fame aren't empty in a demo.
// Always tagged SIM in the UI, like the live-room demo crowd.
const SIMS = [
  { uid: 'sim-parlay-pete', name: 'ParlayPete', avatar: '🦈' },
  { uid: 'sim-hook-hannah', name: 'HookHannah', avatar: '🪝' },
  { uid: 'sim-chalk-charlie', name: 'ChalkCharlie', avatar: '🧢' },
  { uid: 'sim-dog-dana', name: 'UnderdogDana', avatar: '🐶' },
  { uid: 'sim-unit-ulysses', name: 'MaxUnitUlysses', avatar: '🚀' },
];

function createService({ store, users }) {
  const { db, save } = store;
  const name = (uid) => SIMS.find((s) => s.uid === uid) || users(uid) || { name: 'A fan', avatar: '🎟️' };

  // ---------- games ----------
  async function board(league, ymd) {
    try {
      const games = await espn.scoreboard(league, ymd, ymd === etYmd(Date.now()) ? 20_000 : 10 * 60_000);
      noteLines(games);
      return games.map((g) => ({ ...g, ymd }));
    } catch { return []; }
  }
  // ESPN drops lines once a game ends, so keep the last pregame line we saw.
  function noteLines(games) {
    let changed = false;
    for (const g of games) {
      const k = `${g.league}:${g.id}`;
      if (g.lines && g.status.state === 'pre' && JSON.stringify(db.lines[k]?.l) !== JSON.stringify(g.lines)) { db.lines[k] = { l: g.lines, at: Date.now() }; changed = true; }
    }
    if (changed) save();
  }
  const withLines = (g) => (g.lines ? g : db.lines[`${g.league}:${g.id}`] ? { ...g, lines: db.lines[`${g.league}:${g.id}`].l } : g);

  // A day's games with lines. Live games lose lines on the scoreboard, so
  // those come from the game summary (which keeps the pregame line).
  async function day(ymd) {
    const all = (await Promise.all(Object.keys(espn.LEAGUES).map((l) => board(l, ymd)))).flat().map(withLines);
    await Promise.all(all.filter((g) => !g.lines && g.status.state === 'in').map(async (g) => {
      try {
        const s = await espn.summary(g.league, g.id, 10 * 60_000);
        if (s.lines) { g.lines = s.lines; db.lines[`${g.league}:${g.id}`] = { l: s.lines, at: Date.now() }; }
      } catch { /* no line, no bet */ }
    }));
    save();
    return all;
  }

  // Every game a list of slips touches, keyed "league:id".
  async function gamesFor(slips) {
    const need = new Map();
    for (const s of slips) for (const l of s.legs) if (l.league && l.gameId && l.date) need.set(`${l.league}|${l.date}`, [l.league, l.date]);
    const boards = await Promise.all([...need.values()].map(([lg, d]) => board(lg, d)));
    const out = {};
    for (const g of boards.flat()) out[`${g.league}:${g.id}`] = g;
    return out;
  }

  // ---------- accounts ----------
  const account = (uid) => db.accounts[uid] || null;
  function ensure(uid) {
    db.accounts[uid] ||= { links: [], age21At: null, demoDays: [], syncedAt: 0 };
    db.slips[uid] ||= {};
    return db.accounts[uid];
  }
  function confirmAge(uid) { const a = ensure(uid); a.age21At ||= Date.now(); save(); return { ok: true }; }
  function needAge(uid) { if (!account(uid)?.age21At) throw new BetError(403, 'Confirm you\'re 21+ first.'); }

  async function linkDemo(uid) {
    needAge(uid);
    const a = ensure(uid);
    if (!a.links.some((l) => l.provider === 'demo')) a.links.push({ provider: 'demo', book: demo.BOOK.name, linkedAt: Date.now() });
    const past = [...await day(daysAgo(1)), ...await day(daysAgo(2))];
    for (const s of demo.historySlips(uid, past)) db.slips[uid][s.id] ||= s;
    save();
    await sync(uid, true);
    await seedSims();
    return view(uid);
  }

  async function linkSharp(uid, redirectUrl) {
    needAge(uid);
    if (!sharp.configured()) throw new BetError(501, 'Real sportsbook linking switches on once SharpSports keys are added. Try the Demo Book for now.');
    const a = ensure(uid);
    if (!a.links.some((l) => l.provider === 'sharpsports')) a.links.push({ provider: 'sharpsports', book: 'Sportsbook (via SharpSports)', linkedAt: Date.now() });
    save();
    return { url: await sharp.linkUrl(uid, redirectUrl) };
  }

  function unlink(uid, provider) {
    const a = account(uid); if (!a) return { ok: true };
    a.links = a.links.filter((l) => l.provider !== provider);
    const prefix = provider === 'demo' ? 'DEMO_' : 'SS_';
    for (const id of Object.keys(db.slips[uid] || {})) if (id.startsWith(prefix)) { delete db.slips[uid][id]; delete db.shared[id]; }
    if (provider === 'demo') a.demoDays = [];
    save(); rebuildReceipts();
    return { ok: true };
  }

  async function sync(uid, force = false) {
    const a = account(uid);
    if (!a?.links.length) return;
    if (!force && Date.now() - a.syncedAt < 60_000) return;
    a.syncedAt = Date.now();
    const today = etYmd(Date.now());
    if (a.links.some((l) => l.provider === 'demo') && !a.demoDays.includes(today)) {
      for (const s of demo.todaysSlips(uid, await day(today), today)) db.slips[uid][s.id] ||= s;
      a.demoDays = [...a.demoDays.slice(-6), today];
    }
    if (a.links.some((l) => l.provider === 'sharpsports') && sharp.configured()) {
      try {
        for (const raw of await sharp.betSlips(uid)) {
          const s = sharp.normalize(raw);
          await matchLegs(s);
          db.slips[uid][s.id] = s;
        }
      } catch (e) { console.error(`[bets] SharpSports sync failed: ${e.message}`); }
    }
    save();
  }

  // Attach ESPN game ids to SharpSports legs by date + team names.
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const sameTeam = (t, n) => !!t && !!n && [t.full, t.name, t.location && `${t.location}${t.name}`, t.abbr].some((x) => x && (norm(x) === norm(n) || norm(n).endsWith(norm(t.name || '~'))));
  async function matchLegs(s) {
    for (const l of s.legs) {
      if (!l.league || !l.start || l.gameId) continue;
      const ymd = etYmd(l.start);
      const g = (await board(l.league, ymd)).find((x) => sameTeam(x.home, l.home) && sameTeam(x.away, l.away));
      if (!g) continue; // stays untracked; the book's own grade still shows
      Object.assign(l, { gameId: g.id, date: ymd, homeAbbr: g.home.abbr, awayAbbr: g.away.abbr, event: `${g.away.abbr} @ ${g.home.abbr}` });
      if (l.market === 'ml' || l.market === 'spread') l.pick = sameTeam(g.home, l.pick) ? 'home' : sameTeam(g.away, l.pick) ? 'away' : l.pick;
      if (!['home', 'away', 'over', 'under'].includes(l.pick)) l.market = 'other';
    }
  }

  // ---------- views ----------
  function decorate(s, games, uid) {
    const st = track.slipState(s, games);
    const net = s.netProfit ?? (st.outcome === 'win' ? s.toWin : st.outcome === 'loss' ? -s.atRisk : st.outcome ? 0 : null);
    const sh = db.shared[s.id];
    return {
      id: s.id, book: s.book, type: s.type, odds: s.odds, oddsText: track.fmtOdds(s.odds), atRisk: s.atRisk, toWin: s.toWin, placedAt: s.placedAt, demo: !!s.demo,
      ...st, net,
      legs: st.legs.map((l, i) => ({ ...l, event: s.legs[i].event, odds: s.legs[i].odds, league: s.legs[i].league, gameId: s.legs[i].gameId })),
      badBeatLine: st.badBeat ? roast.badBeatLine(s.id, st.badBeat) : null,
      shared: sh && sh.uid === uid ? { tailfade: !!sh.tailfade, hall: !!sh.hall } : null,
    };
  }

  function stats(slips) {
    const settled = slips.filter((s) => s.outcome);
    const w = settled.filter((s) => s.outcome === 'win').length, l = settled.filter((s) => s.outcome === 'loss').length;
    const net = settled.reduce((a, s) => a + (s.net || 0), 0);
    const staked = settled.reduce((a, s) => a + (s.atRisk || 0), 0);
    const open = slips.filter((s) => !s.outcome);
    const teams = {};
    for (const s of slips) for (const lg of s.legs) {
      const t = lg.label.split(' ')[0];
      if (!['Over', 'Under', 'Bet', 'Home', 'Away'].includes(t)) teams[t] = (teams[t] || 0) + 1;
    }
    const [favTeam, favCount] = Object.entries(teams).sort((x, y) => y[1] - x[1])[0] || [null, 0];
    return {
      slips: slips.length, w, l, p: settled.length - w - l, net, staked, roi: staked ? net / staked : 0,
      open: open.length, openRisk: open.reduce((a, s) => a + (s.atRisk || 0), 0), openToWin: open.reduce((a, s) => a + (s.toWin || 0), 0),
      parlays: slips.filter((s) => s.type === 'parlay').length, longest: Math.max(0, ...slips.map((s) => s.odds || 0)), favTeam, favCount,
    };
  }

  async function view(uid) {
    const a = account(uid);
    if (!a) return { account: null, slips: [] };
    await sync(uid);
    const raw = Object.values(db.slips[uid] || {});
    const games = await gamesFor(raw);
    const slips = raw.map((s) => decorate(s, games, uid))
      .sort((x, y) => (x.outcome ? 1 : 0) - (y.outcome ? 1 : 0) || (y.live ? 1 : 0) - (x.live ? 1 : 0) || (y.placedAt || 0) - (x.placedAt || 0));
    const st = stats(slips);
    return {
      account: { links: a.links, age21: !!a.age21At, syncedAt: a.syncedAt },
      slips, stats: st, therapist: roast.therapist(uid, st),
    };
  }

  // Which games you have action on, for game cards and live rooms. Only you see this.
  async function action(uid) {
    const raw = Object.values(db.slips[uid] || {});
    const live = raw.filter((s) => !s.outcome);
    if (!live.length) return { games: {} };
    const games = await gamesFor(live);
    const out = {};
    for (const s of live) {
      const d = decorate(s, games, uid);
      if (d.outcome) continue;
      d.legs.forEach((l) => {
        if (!l.gameId) return;
        const key = `${l.league}:${l.gameId}`;
        (out[key] ||= []).push({ slipId: s.id, type: s.type, label: l.label, text: l.text, status: l.status, legP: l.p, slipP: d.p, legs: d.legs.length, oneLegAway: d.oneLegAway && !l.result, toWin: s.toWin, atRisk: s.atRisk, book: s.book.name });
      });
    }
    return { games: out };
  }

  // ---------- sharing ----------
  function share(uid, slipId, where, on, profile) {
    const s = db.slips[uid]?.[slipId];
    if (!s) throw new BetError(404, 'That bet isn\'t yours to share.');
    if (!['tailfade', 'hall'].includes(where)) throw new BetError(400, 'Share where?');
    const sh = db.shared[slipId] ||= { slipId, uid, at: Date.now(), votes: {}, tailfade: false, hall: false };
    sh[where] = !!on;
    if (profile?.name) Object.assign(sh, { name: profile.name, avatar: profile.avatar || sh.avatar });
    if (!sh.tailfade && !sh.hall) delete db.shared[slipId];
    save(); rebuildReceipts();
    return { ok: true };
  }

  async function sharedView(filter, uid) {
    const entries = Object.values(db.shared).filter(filter);
    const raw = entries.map((e) => db.slips[e.uid]?.[e.slipId]).filter(Boolean);
    const games = await gamesFor(raw);
    return entries.map((e) => {
      const s = db.slips[e.uid]?.[e.slipId]; if (!s) return null;
      const who = e.name ? { name: e.name, avatar: e.avatar || '🎟️' } : name(e.uid);
      const d = decorate(s, games, null);
      const tails = Object.values(e.votes).filter((v) => v === 'tail').length;
      const fades = Object.values(e.votes).length - tails;
      return {
        ...d, shared: undefined, fan: { name: who.name, avatar: who.avatar, sim: e.uid.startsWith('sim-'), mine: e.uid === uid },
        sharedAt: e.at, tails, fades, myVote: uid ? e.votes[uid] || null : null, crowd: roast.tailFadeLine(e.slipId, tails, fades),
      };
    }).filter(Boolean);
  }

  async function feed(uid) {
    const items = await sharedView((e) => e.tailfade, uid);
    items.sort((x, y) => (x.outcome ? 1 : 0) - (y.outcome ? 1 : 0) || (y.live ? 1 : 0) - (x.live ? 1 : 0) || y.sharedAt - x.sharedAt);
    // Fade scores: how betting against each sharer would have gone.
    const by = {};
    for (const it of items.filter((i) => i.outcome === 'win' || i.outcome === 'loss')) {
      const k = `${it.fan.name}`;
      const r = by[k] ||= { fan: it.fan, w: 0, l: 0 };
      if (it.outcome === 'win') r.w++; else r.l++;
    }
    const fadeBoard = Object.values(by).map((r) => ({ ...r, fadeRecord: `${r.l}-${r.w}`, fadeEdge: r.l - r.w })).sort((a, b) => b.fadeEdge - a.fadeEdge);
    // Crowd callers: who's been right with their tail/fade votes.
    const calls = {};
    for (const e of Object.values(db.shared).filter((x) => x.tailfade)) {
      const it = items.find((i) => i.id === e.slipId);
      if (!it || !['win', 'loss'].includes(it.outcome)) continue;
      for (const [voter, side] of Object.entries(e.votes)) {
        const c = calls[voter] ||= { right: 0, wrong: 0 };
        if ((side === 'tail') === (it.outcome === 'win')) c.right++; else c.wrong++;
      }
    }
    const callers = Object.entries(calls).map(([v, c]) => ({ fan: { ...name(v), sim: v.startsWith('sim-'), mine: v === uid }, ...c }))
      .sort((a, b) => b.right - a.right || a.wrong - b.wrong).slice(0, 8);
    return { items: items.slice(0, 40), fadeBoard: fadeBoard.slice(0, 8), callers };
  }

  function vote(uid, slipId, side) {
    const e = db.shared[slipId];
    if (!e?.tailfade) throw new BetError(404, 'That bet isn\'t up for a vote.');
    if (e.uid === uid) throw new BetError(400, 'You can\'t tail or fade your own bet. Nice try.');
    if (!['tail', 'fade'].includes(side)) throw new BetError(400, 'Tail or fade. Pick one.');
    const s = db.slips[e.uid]?.[slipId];
    if (s?.outcome) throw new BetError(400, 'That bet is already settled. No hindsight heroes.');
    e.votes[uid] = side;
    save();
    return { ok: true };
  }

  async function hall(uid) {
    const items = (await sharedView((e) => e.hall, uid)).filter((i) => i.badBeat);
    items.sort((x, y) => y.badBeat.score - x.badBeat.score);
    return { items: items.slice(0, 30) };
  }

  // A take gets a 💸 receipt when its author shared a bet on that game.
  const receipts = new Map();
  function rebuildReceipts() {
    receipts.clear();
    for (const e of Object.values(db.shared)) {
      const s = db.slips[e.uid]?.[e.slipId];
      for (const l of s?.legs || []) if (l.gameId) receipts.set(`${e.uid}|${l.league}:${l.gameId}`, true);
    }
  }
  const hasReceipt = (uid, gameKey) => receipts.has(`${uid}|${gameKey}`);

  // ---------- simulated crowd ----------
  async function seedSims() {
    const today = etYmd(Date.now());
    if (db.simDay === today) return;
    const games = await day(today);
    const past = [...await day(daysAgo(1)), ...await day(daysAgo(2))];
    for (const sim of SIMS) {
      db.slips[sim.uid] = {};
      const open = demo.todaysSlips(sim.uid, games, today);
      const hist = demo.historySlips(sim.uid, past);
      for (const s of [...open, ...hist]) db.slips[sim.uid][s.id] = s;
      for (const id of Object.keys(db.shared)) if (db.shared[id].uid === sim.uid) delete db.shared[id];
      const r = demo.seeded(`${sim.uid}:${today}`);
      for (const s of [...open].sort(() => r() - 0.5).slice(0, 2)) db.shared[s.id] = { slipId: s.id, uid: sim.uid, at: Date.now() - Math.floor(r() * 3 * 3600_000), votes: {}, tailfade: true, hall: false };
      for (const s of hist.filter((x) => /_(hook|par)$/.test(x.id))) db.shared[s.id] = { slipId: s.id, uid: sim.uid, at: Date.now() - 86400_000, votes: {}, tailfade: false, hall: true };
      // A couple of settled shared bets so fade scores have history.
      for (const s of hist.slice(0, 2)) db.shared[s.id] = { slipId: s.id, uid: sim.uid, at: Date.now() - 86400_000, votes: {}, tailfade: true, hall: false };
    }
    for (const e of Object.values(db.shared)) if (e.uid.startsWith('sim-')) {
      const r = demo.seeded(`${e.slipId}:votes`);
      for (const sim of SIMS) if (sim.uid !== e.uid && r() < 0.8) e.votes[sim.uid] = r() < 0.5 ? 'tail' : 'fade';
    }
    db.simDay = today;
    save(); rebuildReceipts();
  }

  const config = () => ({ sharpsports: sharp.configured(), books: BOOKS });

  return {
    config, confirmAge, linkDemo, linkSharp, unlink, sync, view, action, share, feed, vote, hall,
    hasReceipt, rebuildReceipts, account, BetError,
  };
}

module.exports = { createService, BetError, SIMS };

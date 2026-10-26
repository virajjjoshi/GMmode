// Live Rooms: a Twitch-style second screen for each game.
// Server-Sent Events push chat, reaction bursts, game updates and "calls"
// (who scores next) to everyone in the room. State lives in memory.

const crypto = require('node:crypto');
const espn = require('./espn');
const store = require('./store');

const rooms = new Map();
const MAX_MESSAGES = 150;
const MAX_CLIENTS = 3000;
const POLL_MS = 10000;
const SNIPE_MS = 45000; // a call must be in this long before the score to count
const COLORS = ['#ff6b6b', '#ffd23f', '#3ddbd9', '#a78bfa', '#4ade80', '#ff9f1c', '#f472b6', '#60a5fa'];

const colorFor = (uid) => COLORS[crypto.createHash('md5').update(uid).digest()[0] % COLORS.length];
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function room(league, id) {
  const key = `${league}:${id}`;
  let r = rooms.get(key);
  if (!r) {
    r = {
      key, league, id, clients: new Set(), messages: [], game: null, lastPlay: null,
      call: null, points: new Map(), reactQueue: {}, reactLog: [], lastLeadBot: 0, poller: null, lastSeen: Date.now(),
    };
    rooms.set(key, r);
  }
  return r;
}

function broadcast(r, ev) {
  const line = `data: ${JSON.stringify(ev)}\n\n`;
  for (const c of r.clients) c.res.write(line);
}

function pushMessage(r, msg) {
  r.messages.push(msg);
  if (r.messages.length > MAX_MESSAGES) r.messages.shift();
  broadcast(r, { type: 'chat', msg });
}

function bot(r, text, tone = 'bot') {
  pushMessage(r, { id: crypto.randomUUID(), kind: tone, name: 'The Intern', avatar: '🤖', color: '#ffd23f', text, t: Date.now() });
}

// ---------- game state ----------
function compact(g, sum) {
  const side = (t) => t && { abbr: t.abbr, name: t.name, full: t.full, score: t.score, logo: t.logo, color: t.color, alt: t.alt, record: t.record };
  return {
    sport: g.sport, league: g.league, leagueLabel: g.leagueLabel, emoji: g.emoji,
    date: g.date,
    status: g.status, home: side(g.home), away: side(g.away),
    situation: g.situation, broadcast: g.broadcast, venue: g.venue,
    lastPlay: sum?.plays?.[0]?.text || g.situation || null,
    winProb: sum?.winProb?.slice(-40) || [],
  };
}

async function fetchGame(r) {
  const sum = await espn.summary(r.league, r.id, 8000);
  let g = sum.game;
  // The scoreboard feed carries down-and-distance / last play; the summary header often doesn't.
  try {
    const list = await espn.scoreboard(r.league, null, 8000);
    const hit = list.find((x) => x.id === r.id);
    if (hit) g = { ...g, situation: hit.situation || g.situation, broadcast: hit.broadcast || g.broadcast };
  } catch { /* summary alone is fine */ }
  return compact(g, sum);
}

const SCORE_LINES = {
  football: {
    6: ['TOUCHDOWN {team}! 🏈 Extra point pending, emotions not.', 'SIX for {team}! Somebody spike something.'],
    7: ['TOUCHDOWN {team}! 🏈 That was disrespectful (complimentary).', 'Six (plus) for {team}. Defense, please see the principal.'],
    8: ['TD + two-point conversion for {team}. Greedy. We love it.'],
    3: ['Field goal {team}. 🦵 Kickers are people too.', 'Three for {team}. Settling is a lifestyle.'],
    2: ['SAFETY (or a 2-pointer)! {team} gets 2. Chaos accepted.'],
    1: ['Extra point is good for {team}. Riveting.'],
  },
  basketball: {},
  baseball: { default: ['{n} on the board for {team}! ⚾ The dugout is jumping.', '{n} run{s} for {team}. Pitcher is staring at the sky.'] },
  hockey: { default: ['GOAL {team}! 🚨 Somebody blow the horn!', 'Lamp LIT for {team}! 🏒 The goalie would like a word with the defense.'] },
  soccer: { default: ['GOOOOOAL {team}! ⚽ Shirt removal imminent.', 'Goal, {team}! The commentators are screaming in three languages.'] },
};

function scoreLine(sport, team, n) {
  const book = SCORE_LINES[sport] || {};
  const lines = book[n] || book.default;
  if (!lines) return null;
  return pick(lines).replace('{team}', team).replace('{n}', n).replace('{s}', n === 1 ? '' : 's');
}

function newCall(r) {
  const g = r.game;
  if (!g || g.status.state !== 'in') { r.call = null; return; }
  const periodQ = g.sport === 'basketball';
  r.call = {
    id: crypto.randomUUID(),
    type: periodQ ? 'period' : 'next',
    period: g.status.period,
    question: periodQ ? `Who's ahead at the end of this ${g.status.period > 4 ? 'OT' : 'quarter'}?` : 'Who scores next?',
    opened: Date.now(),
    picks: new Map(), // uid -> { side, t }
  };
}

function callView(r, uid) {
  const c = r.call;
  if (!c) return null;
  let home = 0, away = 0;
  for (const p of c.picks.values()) p.side === 'home' ? home++ : away++;
  return { id: c.id, question: c.question, home, away, mine: uid ? c.picks.get(uid)?.side || null : null };
}

function leaderboard(r) {
  return [...r.points.values()].sort((a, b) => b.pts - a.pts).slice(0, 10)
    .map(({ name, avatar, color, pts, streak }) => ({ name, avatar, color, pts, streak }));
}

function resolveCall(r, winnerSide) {
  const c = r.call;
  if (!c) return;
  const now = Date.now();
  const valid = [...c.picks.entries()].filter(([, p]) => now - p.t >= SNIPE_MS);
  const right = valid.filter(([, p]) => p.side === winnerSide);
  const bonus = valid.length ? Math.round(10 * (1 - right.length / valid.length)) : 0;
  for (const [uid, p] of valid) {
    const e = r.points.get(uid);
    if (!e) continue;
    if (p.side === winnerSide) { e.pts += 10 + bonus; e.streak += 1; } else e.streak = 0;
  }
  const team = r.game[winnerSide]?.name || winnerSide;
  if (valid.length) {
    bot(r, right.length
      ? `🔮 Call resolved: ${team}. ${right.length}/${valid.length} called it (+${10 + bonus} pts each). Everyone else: thoughts and prayers.`
      : `🔮 Call resolved: ${team}. Nobody called it. Not one of you. Incredible.`, 'call');
  }
  newCall(r);
  broadcast(r, { type: 'leaders', leaders: leaderboard(r) });
  broadcastCall(r);
}

function broadcastCall(r) {
  // Totals are shared; each client tracks its own pick locally.
  broadcast(r, { type: 'call', call: callView(r) });
}

function onUpdate(r, next) {
  const prev = r.game;
  r.game = next;
  if (!prev) { if (next.status.state === 'in' && !r.call) newCall(r); return; }
  const g = next;
  const dh = (g.home?.score ?? 0) - (prev.home?.score ?? 0);
  const da = (g.away?.score ?? 0) - (prev.away?.score ?? 0);

  if (prev.status.state === 'pre' && g.status.state === 'in') {
    bot(r, `🎬 WE ARE LIVE. ${g.away.name} vs ${g.home.name}. Hydrate. Stretch. Talk trash responsibly.`, 'system');
    newCall(r); broadcastCall(r);
  }

  if (g.sport !== 'basketball' && (dh > 0 || da > 0)) {
    for (const [d, side] of [[dh, 'home'], [da, 'away']]) {
      if (d <= 0) continue;
      const line = scoreLine(g.sport, g[side].name, d);
      if (line) bot(r, line, 'score');
    }
    if (r.call?.type === 'next') resolveCall(r, dh >= da ? 'home' : 'away');
    broadcast(r, { type: 'score', home: dh, away: da });
  } else if (g.sport === 'basketball' && (dh > 0 || da > 0)) {
    broadcast(r, { type: 'score', home: dh, away: da });
  }

  // Lead changes (rate-limited so basketball doesn't spam).
  const lead = (x) => Math.sign((x.home?.score ?? 0) - (x.away?.score ?? 0));
  if (lead(prev) !== lead(g) && lead(g) !== 0 && (g.sport !== 'basketball' || Date.now() - r.lastLeadBot > 30000)) {
    r.lastLeadBot = Date.now();
    const who = lead(g) > 0 ? g.home.name : g.away.name;
    const first = (prev.home?.score ?? 0) + (prev.away?.score ?? 0) === 0;
    bot(r, first ? `🩸 First blood: ${who}.`
      : lead(prev) === 0 ? `⬆️ ${who} back in front.`
      : pick([`🔁 LEAD CHANGE! ${who} in front.`, `🔁 LEAD CHANGE! The other bench just aged 3 years. ${who} up.`]), 'score');
  }

  if (g.status.state === 'in' && g.status.period !== prev.status.period && prev.status.state === 'in') {
    if (r.call?.type === 'period') {
      const s = (prev.home?.score ?? 0) - (prev.away?.score ?? 0);
      if (s !== 0) resolveCall(r, s > 0 ? 'home' : 'away'); else newCall(r);
      broadcastCall(r);
    }
    bot(r, pick(['⏸️ End of the period. Bathroom break: GO NOW.', '⏸️ Break in the action. Refill the snacks, we\'ll wait.']), 'system');
  }

  if (prev.status.state !== 'post' && g.status.state === 'post') {
    const hs = g.home.score ?? 0, as = g.away.score ?? 0;
    const w = hs === as ? null : hs > as ? g.home.name : g.away.name;
    bot(r, w ? `🏁 FINAL: ${g.away.name} ${as}, ${g.home.name} ${hs}. W for ${w}. GGs in the chat (or don't).` : `🏁 FINAL: it's a draw. Everybody go home.`, 'system');
    const top = leaderboard(r)[0];
    if (top) bot(r, `👑 Top caller tonight: ${top.avatar} ${top.name} with ${top.pts} pts.`, 'call');
    r.call = null; broadcastCall(r);
  }

  if (g.lastPlay && g.lastPlay !== r.lastPlay) r.lastPlay = g.lastPlay;
  broadcast(r, { type: 'game', game: g });
}

async function poll(r) {
  try { onUpdate(r, await fetchGame(r)); }
  catch (e) { console.error('live poll', r.key, e.message); }
}

function startPolling(r) {
  if (r.poller) return;
  r.poller = setInterval(() => {
    if (!r.clients.size) {
      // Nobody's watching: stop polling, and forget the room after 30 minutes.
      clearInterval(r.poller); r.poller = null;
      setTimeout(() => { if (!rooms.get(r.key)?.clients.size) rooms.delete(r.key); }, 30 * 60_000).unref();
      return;
    }
    if (r.game?.status.state === 'post' && Date.now() - r.lastSeen > 60_000) return;
    poll(r);
  }, POLL_MS);
}

// Reactions are batched once a second into a "burst" so 500 people can spam 🔥.
setInterval(() => {
  const now = Date.now();
  for (const r of rooms.values()) {
    const q = r.reactQueue;
    const n = Object.values(q).reduce((a, b) => a + b, 0);
    r.reactLog = r.reactLog.filter((x) => now - x.t < 15000);
    if (n) { r.reactLog.push({ t: now, n }); r.reactQueue = {}; }
    const recent = r.reactLog.reduce((a, x) => a + x.n, 0);
    const hype = Math.min(100, Math.round((recent / Math.max(3, r.clients.size)) * 12));
    if (n || r.lastHype !== hype) broadcast(r, { type: 'burst', counts: n ? q : {}, hype });
    r.lastHype = hype;
  }
}, 1000).unref();

// Keep proxies from closing idle streams.
setInterval(() => { for (const r of rooms.values()) for (const c of r.clients) c.res.write(': ping\n\n'); }, 20000).unref();

// ---------- public API ----------
async function join(league, id, uid, req, res) {
  const r = room(league, id);
  if (r.clients.size >= MAX_CLIENTS) throw Object.assign(new Error('Room is full. Too much hype.'), { code: 503 });
  if (!r.game) await poll(r);
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' });
  res.write('retry: 3000\n\n');
  const client = { res, uid };
  r.clients.add(client);
  r.lastSeen = Date.now();
  res.write(`data: ${JSON.stringify({
    type: 'hello', game: r.game, messages: r.messages, call: callView(r, uid), leaders: leaderboard(r),
    viewers: r.clients.size, me: uid ? { color: colorFor(uid), pts: r.points.get(uid)?.pts || 0 } : null,
  })}\n\n`);
  broadcast(r, { type: 'viewers', viewers: r.clients.size });
  startPolling(r);
  req.on('close', () => {
    r.clients.delete(client);
    r.lastSeen = Date.now();
    broadcast(r, { type: 'viewers', viewers: r.clients.size });
  });
}

const lastChat = new Map();
function chat(league, id, { uid, name, avatar, text }) {
  const r = rooms.get(`${league}:${id}`);
  if (!r) throw Object.assign(new Error('Join the room first.'), { code: 400 });
  const prev = lastChat.get(uid);
  if (prev && Date.now() - prev.t < 1500) throw Object.assign(new Error('Slow mode: 1 message every 1.5s. Breathe.'), { code: 429 });
  if (prev && prev.text === text && Date.now() - prev.t < 15000) throw Object.assign(new Error('You just said that. We heard you.'), { code: 429 });
  lastChat.set(uid, { t: Date.now(), text });
  if (lastChat.size > 20000) lastChat.delete(lastChat.keys().next().value);
  const msg = { id: crypto.randomUUID(), kind: 'user', name, avatar, color: colorFor(uid), text: store.soften(text), t: Date.now() };
  pushMessage(r, msg);
  return msg;
}

const REACTS = ['🔥', '😂', '😭', '🤡', '🐐', '🧂', '💀', '🚀', '😱', '🙌'];
function react(league, id, emoji, n) {
  const r = rooms.get(`${league}:${id}`);
  if (!r) throw Object.assign(new Error('Join the room first.'), { code: 400 });
  if (!REACTS.includes(emoji)) throw Object.assign(new Error('bad emoji'), { code: 400 });
  r.reactQueue[emoji] = (r.reactQueue[emoji] || 0) + Math.max(1, Math.min(10, n | 0));
}

function makeCall(league, id, { uid, name, avatar, side, callId }) {
  const r = rooms.get(`${league}:${id}`);
  if (!r?.call) throw Object.assign(new Error('No open call right now.'), { code: 400 });
  if (r.call.id !== callId) throw Object.assign(new Error('That call already resolved. New one is up!'), { code: 409 });
  const existing = r.call.picks.get(uid);
  // Switching sides resets your clock: no waiting until the drive is in the red zone.
  if (!existing || existing.side !== side) r.call.picks.set(uid, { side, t: Date.now() });
  const e = r.points.get(uid) || { name, avatar, color: colorFor(uid), pts: 0, streak: 0 };
  e.name = name; e.avatar = avatar;
  r.points.set(uid, e);
  broadcastCall(r);
  broadcast(r, { type: 'leaders', leaders: leaderboard(r) });
  return { ...callView(r, uid), lockMs: SNIPE_MS };
}

function viewers(key) { return rooms.get(key)?.clients.size || 0; }

module.exports = { join, chat, react, makeCall, viewers, REACTS };

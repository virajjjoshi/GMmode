// Live Rooms: a Twitch-style second screen for each game.
// Server-Sent Events push chat, reaction bursts, game updates and "calls"
// (who scores next) to everyone in the room. State lives in memory.

const crypto = require('node:crypto');
const espn = require('./espn');
const store = require('./store');
const field = require('./field');

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
      tug: { home: 0, away: 0, q: { home: 0, away: 0 }, sent: '' }, mpoll: null, lastMoment: 0,
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
function compact(g, sum, detail) {
  const side = (t) => t && { abbr: t.abbr, name: t.name, full: t.full, score: t.score, logo: t.logo, color: t.color, alt: t.alt, record: t.record };
  return {
    sport: g.sport, league: g.league, leagueLabel: g.leagueLabel, emoji: g.emoji,
    date: g.date,
    status: g.status, home: side(g.home), away: side(g.away),
    situation: g.situation, broadcast: g.broadcast, venue: g.venue,
    lastPlay: sum?.plays?.[0]?.text || g.situation || null,
    winProb: sum?.winProb?.slice(-40) || [],
    detail: detail || null,
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
  let detail = null;
  try { detail = field.build(await espn.raw(r.league, r.id, 8000)); } catch { /* the stage falls back to the scoreboard */ }
  return compact(g, sum, detail);
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
    .map(({ name, avatar, color, pts, streak, sim }) => ({ name, avatar, color, pts, streak, sim: !!sim }));
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
  if (!prev) { if (next.status.state === 'in' && !r.call) newCall(r); ensurePolls(r, next); return; }
  const g = next;
  const dh = (g.home?.score ?? 0) - (prev.home?.score ?? 0);
  const da = (g.away?.score ?? 0) - (prev.away?.score ?? 0);

  if (prev.status.state === 'pre' && g.status.state === 'in') {
    const start = START[g.sport] || START.football;
    moment(r, 'start', start.title, g.sport === 'basketball' && g.detail?.jumpBall ? g.detail.jumpBall : `${g.away.name} vs ${g.home.name}`, null, true);
    bot(r, `${start.emoji} ${start.title}! ${g.away.name} vs ${g.home.name}. Hydrate. Stretch. Talk trash responsibly.`, 'system');
    newCall(r); broadcastCall(r);
  }
  detectMoments(r, prev, g);
  ensurePolls(r, g);

  if (g.sport !== 'basketball' && (dh > 0 || da > 0)) {
    for (const [d, side] of [[dh, 'home'], [da, 'away']]) {
      if (d <= 0) continue;
      const line = scoreLine(g.sport, g[side].name, d);
      if (line) bot(r, line, 'score');
    }
    if (r.call?.type === 'next') resolveCall(r, dh >= da ? 'home' : 'away');
    broadcast(r, { type: 'score', home: dh, away: da });
    if (r.demo) simCelebrate(r, dh >= da ? 'home' : 'away');
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



// ---------- sport-specific moments ----------
const START = {
  football: { title: 'KICKOFF', emoji: '🏈' }, basketball: { title: 'TIP-OFF', emoji: '🏀' },
  baseball: { title: 'FIRST PITCH', emoji: '⚾' }, hockey: { title: 'PUCK DROP', emoji: '🏒' }, soccer: { title: 'KICKOFF', emoji: '⚽' },
};
const clockSecs = (c) => { const m = String(c || '').match(/(\d+):(\d+)/); return m ? +m[1] * 60 + +m[2] : null; };

function moment(r, kind, title, sub, side, force = false) {
  // Don't stack overlays: at most one every 6s unless it's a big one.
  if (!force && Date.now() - r.lastMoment < 6000) return;
  r.lastMoment = Date.now();
  broadcast(r, { type: 'moment', kind, title, sub: sub || '', side: side || null });
}

function detectMoments(r, prev, g) {
  const a = prev.detail, b = g.detail;
  if (!b || g.status.state !== 'in') { if (r.mpoll && g.status.state === 'post') closePoll(r); return; }
  const team = (side) => g[side]?.name || '';
  const other = (side) => (side === 'home' ? 'away' : 'home');
  const newTop = b.plays?.[0] && b.plays[0].id !== a?.plays?.[0]?.id ? b.plays[0] : null;

  if (b.kind === 'football') {
    if (b.redZone && !a?.redZone && b.possession) {
      moment(r, 'redzone', 'RED ZONE', `${team(b.possession)} at the ${b.spotText}`, b.possession);
      bot(r, `🚨 RED ZONE: ${team(b.possession)} inside the 20. Defense, this is your moment (it isn't).`, 'score');
    }
    if (newTop?.kind === 'turnover') {
      moment(r, 'turnover', 'TURNOVER!', newTop.text.slice(0, 90), newTop.side ? other(newTop.side) : null, true);
      bot(r, `🔄 TURNOVER! ${newTop.text.slice(0, 120)}`, 'score');
    }
    const pc = clockSecs(prev.status.clock), nc = clockSecs(g.status.clock);
    if ([2, 4].includes(g.status.period) && pc > 120 && nc != null && nc <= 120) {
      moment(r, 'twomin', 'TWO-MINUTE WARNING', 'Everyone sit down. Nobody leave.', null);
    }
  } else if (b.kind === 'basketball') {
    if (b.lastThree && b.lastThree !== a?.lastThree) {
      const shot = b.shots.find((x) => x.id === b.lastThree);
      moment(r, 'three', 'FROM DOWNTOWN!', shot?.text?.split(' makes')[0] || '', shot?.side);
    }
    if (/halftime/i.test(g.status.detail) && !/halftime/i.test(prev.status.detail)) moment(r, 'half', 'HALFTIME', 'Go get snacks. You have 15 minutes.', null, true);
    const diff = Math.abs((g.home.score ?? 0) - (g.away.score ?? 0)), nc = clockSecs(g.status.clock);
    if (g.status.period >= 4 && nc != null && nc <= 120 && diff <= 5 && !r.clutch) {
      r.clutch = true;
      moment(r, 'clutch', 'CLUTCH TIME', `${diff}-point game, under 2 minutes`, null, true);
    }
  } else if (b.kind === 'baseball') {
    if (newTop?.kind === 'homer') { moment(r, 'homer', 'GONE!', newTop.text.slice(0, 90), newTop.side, true); bot(r, `💣 HOME RUN! ${newTop.text.slice(0, 120)}`, 'score'); }
    else if (newTop?.kind === 'k') moment(r, 'k', 'K', newTop.text.slice(0, 90), newTop.side ? other(newTop.side) : null);
    if (b.balls === 3 && b.strikes === 2 && !(a?.balls === 3 && a?.strikes === 2)) moment(r, 'full', 'FULL COUNT', `${b.batter?.short || 'Batter'} vs ${b.pitcher?.short || 'pitcher'}`, null);
    if (b.bases.every(Boolean) && !a?.bases?.every(Boolean)) {
      moment(r, 'loaded', 'BASES LOADED', `${b.outs ?? 0} out${b.outs === 1 ? '' : 's'}. ${b.batter?.short || ''} up`, null, true);
    }
  } else if (b.kind === 'hockey') {
    if (b.lastPenalty && b.lastPenalty.id !== a?.lastPenalty?.id && b.lastPenalty.side) {
      moment(r, 'pp', 'POWER PLAY', `${team(other(b.lastPenalty.side))} on the man advantage`, other(b.lastPenalty.side));
      bot(r, `⚠️ Penalty: ${b.lastPenalty.text.slice(0, 110)}. Power play ${team(other(b.lastPenalty.side))}.`, 'score');
    }
  } else if (b.kind === 'soccer') {
    const seen = new Set((a?.events || []).map((e) => e.id));
    for (const e of b.events.filter((x) => !seen.has(x.id))) {
      if (e.k === 'yellow') moment(r, 'yellow', 'YELLOW CARD', e.text.slice(0, 90), e.side);
      if (e.k === 'red') { moment(r, 'red', 'RED CARD', e.text.slice(0, 90), e.side, true); bot(r, `🟥 RED CARD! ${e.text.slice(0, 120)}`, 'score'); }
      if (e.k === 'penalty') moment(r, 'pen', 'PENALTY!', e.text.slice(0, 90), e.side, true);
    }
  }
}

// Polls depend on the *current* situation, so they're checked on every update
// (including the first one, for fans who join mid-4th-down).
function ensurePolls(r, g) {
  const b = g.detail;
  if (!b || g.status.state !== 'in') { if (r.mpoll) closePoll(r); return; }
  const team = (side) => g[side]?.name || '';
  let want = null;
  if (b.kind === 'football' && b.down === 4 && b.possession && b.ballX != null) {
    want = { key: `fb|${b.down}|${b.ballX}|${b.possession}`, q: `${b.downText || '4th down'}: what should ${team(b.possession)} do?`,
      options: [{ key: 'go', label: '🔥 Go for it' }, { key: 'punt', label: '🦵 Punt' }, { key: 'fg', label: '🎯 Kick it' }] };
  } else if (b.kind === 'baseball' && b.bases.every(Boolean)) {
    want = { key: `bb|${b.outs}|${b.batter?.name}`, q: `Bases loaded, ${b.outs ?? 0} out. What happens?`,
      options: [{ key: 'k', label: '🔥 Strikeout' }, { key: 'hit', label: '💥 Base hit' }, { key: 'slam', label: '💣 GRAND SLAM' }, { key: 'walk', label: '🚶 Walk' }] };
  } else if (b.kind === 'basketball') {
    const diff = Math.abs((g.home.score ?? 0) - (g.away.score ?? 0)), nc = clockSecs(g.status.clock);
    if (g.status.period >= 4 && nc != null && nc <= 120 && diff <= 5) {
      want = { key: 'nba|clutch', q: `${diff === 0 ? 'Tied' : `${diff}-point game`} with under 2:00 left. Who closes it out?`,
        options: [{ key: 'away', label: g.away.name }, { key: 'home', label: g.home.name }, { key: 'ot', label: '🕐 Overtime' }] };
    }
  }
  if (r.mpoll && r.mpoll.key !== want?.key) closePoll(r);
  if (want && !r.mpoll) openPoll(r, want.key, want.q, want.options);
}

// ---------- moment polls: quick crowd sentiment, no points ----------
function pollView(r, uid) {
  const p = r.mpoll; if (!p) return null;
  const counts = Object.fromEntries(p.options.map((o) => [o.key, 0]));
  for (const k of p.votes.values()) counts[k] = (counts[k] || 0) + 1;
  return { id: p.id, q: p.q, options: p.options, counts, mine: uid ? p.votes.get(uid) || null : null };
}
function openPoll(r, key, q, options, kind = 'moment') {
  r.mpoll = { id: crypto.randomUUID(), key, kind, q, options, votes: new Map() };
  if (r.demo) for (const f of r.demo.fans.slice(0, 12)) r.mpoll.votes.set(f.uid, pick(options).key);
  broadcast(r, { type: 'mpoll', poll: pollView(r) });
}
function closePoll(r) {
  const p = pollView(r); r.mpoll = null;
  if (!p) return;
  const total = Object.values(p.counts).reduce((x, y) => x + y, 0);
  if (total) {
    const [k, n] = Object.entries(p.counts).sort((x, y) => y[1] - x[1])[0];
    const label = p.options.find((o) => o.key === k)?.label || k;
    bot(r, `📊 The crowd has spoken: ${Math.round((n / total) * 100)}% said ${label}.`, 'call');
  }
  broadcast(r, { type: 'mpoll', poll: null });
}
function votePoll(league, id, { uid, pollId, option }) {
  const r = rooms.get(`${league}:${id}`);
  if (!r?.mpoll || r.mpoll.id !== pollId) throw Object.assign(new Error('That moment passed. Stay ready for the next one.'), { code: 409 });
  if (!r.mpoll.options.some((o) => o.key === option)) throw Object.assign(new Error('Not an option.'), { code: 400 });
  r.mpoll.votes.set(uid, option);
  broadcast(r, { type: 'mpoll', poll: pollView(r) });
  return pollView(r, uid);
}

// ---------- hype tug-of-war ----------
function hype(league, id, side, n) {
  const r = rooms.get(`${league}:${id}`);
  if (!r) throw Object.assign(new Error('Join the room first.'), { code: 400 });
  if (!['home', 'away'].includes(side)) throw Object.assign(new Error('Pick a side.'), { code: 400 });
  r.tug.q[side] += Math.max(1, Math.min(15, n | 0));
}
// Hype decays ~7%/s, so the meter drifts back unless fans keep pushing.
setInterval(() => {
  for (const r of rooms.values()) {
    const t = r.tug;
    for (const s of ['home', 'away']) { t[s] = t[s] * 0.93 + t.q[s]; t.q[s] = 0; if (t[s] < 0.05) t[s] = 0; }
    const sig = `${t.home.toFixed(1)}|${t.away.toFixed(1)}`;
    if (sig !== t.sent) { t.sent = sig; broadcast(r, { type: 'tug', home: Math.round(t.home * 10) / 10, away: Math.round(t.away * 10) / 10 }); }
  }
}, 1000).unref();

// ---------- demo crowd ----------
// A clearly-labelled simulated crowd, so a room can be shown off before it has
// real traffic. Every simulated message and caller carries `sim: true`, and
// the UI tags them. Never counted as real viewers.
const SIM_NAMES = ['CouchCoach27', 'NachoProphet', 'BlitzBarbie', 'SaltyStatGuy', 'RefTruther99', 'HotDogHannah', 'FourthAndLong', 'PuntGod',
  'DraftDayDave', 'BenchWarmer', 'ClutchUncle', 'GoblinMode', 'WingSauceWill', 'ParlayPete', 'TouchdownTina', 'MiddleSeatMike', 'OvertimeOli',
  'SpicyTakeSam', 'ChipsAndDipp', 'LowkeyGOAT', 'Sundays4Ever', 'TailgateTess', 'BleacherBro', 'FlexSpotFran', 'NoPuntIntended', 'ZebraWatcher'];
const SIM_AVATARS = ['🐐', '🤡', '🦅', '🐻', '🦁', '🐯', '🦈', '🌭', '🍕', '🍿', '👽', '🤖', '🧙', '👑', '🔥', '🦆', '🧢', '💀'];
const SIM_CHAT = [
  '{home} in 5 🖐️', '{away} fans real quiet rn', 'refs are cooked tonight', 'who else watching from the bathroom', 'this is cinema 🎬',
  'my fantasy team is crying', 'LETS GOOOO', 'W', 'L', 'defense is optional tonight huh', 'somebody check on {trailer} fans', '{leader} is HIM',
  "I'm not stressed you're stressed", 'commercial break #47', 'my dog is more locked in than this secondary', "{home} fans where y'all at",
  'that was holding and everyone saw it', 'unreal', 'chat is this real', 'the intern bot is cooking tonight 😂', '@ the refs: get glasses',
  'first time? 🧂', 'vibes are immaculate', 'I called this in the group chat btw', '{trailer} needs a miracle and a new coordinator',
  'imagine being a {trailer} fan rn', 'the hype meter is broken lmao', 'this game is giving playoff energy', 'bro the clock management 💀',
  'not the {away} slander in chat 😭', 'stay locked in chat', "one more score and I'm running laps around my living room",
];
const SIM_HYPE = ['WHAT A PLAY', '{team} DIFFERENT 😤', 'NO WAY', 'I KNEW IT', 'called it 🔮', 'unreal 🔥🔥', '{other} defense where were you',
  'SCREAMINGGG', 'ok that was nasty', 'CHAT DID YOU SEE THAT', '{team} FANS WE EATING TONIGHT'];
const SIM_REACTS = ['🔥', '😂', '😱', '🙌', '💀', '🤡', '🐐', '🧂'];

function simLine(r, pool, extra = {}) {
  const g = r.game || {};
  const hs = g.home?.score ?? 0, as = g.away?.score ?? 0;
  const v = { home: g.home?.name || 'home', away: g.away?.name || 'away',
    leader: (hs >= as ? g.home : g.away)?.name || 'them', trailer: (hs >= as ? g.away : g.home)?.name || 'them', ...extra };
  return pick(pool).replace(/\{(\w+)\}/g, (_, k) => v[k] ?? k);
}
function simSay(r, text) {
  const f = pick(r.demo.fans);
  pushMessage(r, { id: crypto.randomUUID(), kind: 'user', sim: true, name: f.name, avatar: f.avatar, color: f.color, text, t: Date.now() });
}
function simCelebrate(r, side) {
  const team = r.game?.[side]?.name || 'them', other = r.game?.[side === 'home' ? 'away' : 'home']?.name || 'them';
  for (let i = 0; i < 6; i++) setTimeout(() => { if (r.demo) simSay(r, simLine(r, SIM_HYPE, { team, other })); }, 400 + i * 700);
  for (const e of ['🔥', '😱', '🙌']) r.reactQueue[e] = (r.reactQueue[e] || 0) + 15 + Math.floor(Math.random() * 20);
  r.tug.q[side] += 40;
}
function simPick(r, f) {
  if (!r.call || r.call.picks.has(f.uid)) return;
  r.call.picks.set(f.uid, { side: Math.random() < 0.5 ? 'home' : 'away', t: Date.now() - SNIPE_MS });
  if (!r.points.has(f.uid)) r.points.set(f.uid, { name: f.name, avatar: f.avatar, color: f.color, pts: 0, streak: 0, sim: true });
  broadcastCall(r);
}
function simTick(r) {
  if (!r.demo) return;
  if (Math.random() < 0.7) simSay(r, simLine(r, SIM_CHAT));
  const n = Math.floor(Math.random() * 6);
  for (let i = 0; i < n; i++) { const e = pick(SIM_REACTS); r.reactQueue[e] = (r.reactQueue[e] || 0) + 1; }
  // Simulated callers pick early enough to count, so calls resolve with a real-looking crowd.
  if (r.call && Math.random() < 0.6) simPick(r, pick(r.demo.fans));
  // Simulated fans lean toward whoever's winning, but both sides show up.
  const g = r.game, lead = g ? Math.sign((g.home?.score ?? 0) - (g.away?.score ?? 0)) : 0;
  r.tug.q[Math.random() < 0.5 + lead * 0.15 ? 'home' : 'away'] += 1 + Math.floor(Math.random() * 4);
  if (r.mpoll && Math.random() < 0.3) { r.mpoll.votes.set(pick(r.demo.fans).uid, pick(r.mpoll.options).key); broadcast(r, { type: 'mpoll', poll: pollView(r) }); }
  r.demo.timer = setTimeout(() => simTick(r), 600 + Math.random() * 1200);
}
function startDemo(r) {
  if (r.demo) return;
  const fans = SIM_NAMES.map((name, i) => ({ uid: `sim-${i}`, name, avatar: SIM_AVATARS[i % SIM_AVATARS.length], color: COLORS[i % COLORS.length] }));
  r.demo = { fans, timer: null };
  bot(r, '🧪 Demo crowd ON. Simulated fans have entered the building. Their messages are tagged SIM.', 'system');
  broadcast(r, { type: 'viewers', viewers: r.clients.size, demo: fans.length });
  // Opening wave: a third of the crowd has already made the current call.
  for (const f of fans.slice(0, 9)) simPick(r, f);
  broadcast(r, { type: 'leaders', leaders: leaderboard(r) });
  simTick(r);
}
function stopDemo(r) {
  if (!r.demo) return;
  clearTimeout(r.demo.timer);
  for (const k of [...r.points.keys()]) if (k.startsWith('sim-')) r.points.delete(k);
  if (r.call) for (const k of [...r.call.picks.keys()]) if (k.startsWith('sim-')) r.call.picks.delete(k);
  if (r.mpoll) { for (const k of [...r.mpoll.votes.keys()]) if (k.startsWith('sim-')) r.mpoll.votes.delete(k); broadcast(r, { type: 'mpoll', poll: pollView(r) }); }
  r.demo = null;
  if (r.clients.size) {
    bot(r, "🧪 Demo crowd OFF. It's just us real ones now.", 'system');
    broadcast(r, { type: 'viewers', viewers: r.clients.size, demo: 0 });
    broadcastCall(r);
    broadcast(r, { type: 'leaders', leaders: leaderboard(r) });
  }
}
function setDemo(league, id, on) {
  const r = rooms.get(`${league}:${id}`);
  if (!r) throw Object.assign(new Error('Join the room first.'), { code: 400 });
  on ? startDemo(r) : stopDemo(r);
  return { demo: r.demo ? r.demo.fans.length : 0 };
}

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
    viewers: r.clients.size, demo: r.demo ? r.demo.fans.length : 0, tug: { home: r.tug.home, away: r.tug.away }, mpoll: pollView(r, uid), me: uid ? { color: colorFor(uid), pts: r.points.get(uid)?.pts || 0 } : null,
  })}\n\n`);
  broadcast(r, { type: 'viewers', viewers: r.clients.size, demo: r.demo ? r.demo.fans.length : 0 });
  startPolling(r);
  req.on('close', () => {
    r.clients.delete(client);
    r.lastSeen = Date.now();
    broadcast(r, { type: 'viewers', viewers: r.clients.size, demo: r.demo ? r.demo.fans.length : 0 });
    if (!r.clients.size) stopDemo(r);
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

module.exports = { join, chat, react, makeCall, setDemo, hype, votePoll, viewers, REACTS };

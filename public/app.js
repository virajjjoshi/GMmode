/* Trash Talk Live: the whole frontend. Vanilla JS, no build step. */
'use strict';

// ---------- tiny utils ----------
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};
const ymd = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
const fromYmd = (s) => new Date(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8));
const isoDate = (s) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
function ago(t) {
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
const fmtTime = (iso) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

// ---------- identity ----------
const ADJ = ['Spicy', 'Salty', 'Couch', 'Nacho', 'Clutch', 'Unhinged', 'Turbo', 'Sleepy', 'Washed', 'Caffeinated', 'Bench', 'Blitzing', 'Petty', 'Delulu', 'Sweaty', 'Loud', 'Cozy', 'Feral'];
const NOUN = ['Coach', 'Prophet', 'Goblin', 'GOAT', 'Ref', 'Commish', 'Mascot', 'Hater', 'Truther', 'Wizard', 'Gremlin', 'Legend', 'Analyst', 'Uncle', 'Gambler', 'Waterboy'];
const AVATARS = ['🐐', '🤡', '🦅', '🐻', '🦁', '🐯', '🦈', '🐊', '🦬', '🧢', '🌭', '🍕', '🍿', '👽', '🤖', '🧙', '👑', '💀', '🔥', '🦆'];
const randomName = () => `${rand(ADJ)}${rand(NOUN)}${Math.floor(Math.random() * 90 + 10)}`;
const me = store.get('ttl:me', null) || {
  uid: (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}-fan`),
  name: randomName(),
  avatar: rand(AVATARS),
};
store.set('ttl:me', me);

function paintMe() { $('#meAvatar').textContent = me.avatar; $('#meName').textContent = me.name; }
function openMeDialog() {
  const dlg = $('#meDialog');
  let picked = me.avatar;
  const pick = $('#avatarPick');
  pick.innerHTML = AVATARS.map((a) => `<button type="button" aria-pressed="${a === picked}" aria-label="Avatar ${a}">${a}</button>`).join('');
  pick.onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    picked = b.textContent; $$('button', pick).forEach((x) => x.setAttribute('aria-pressed', x === b));
  };
  $('#meInput').value = me.name;
  $('#reroll').onclick = () => { $('#meInput').value = randomName(); };
  dlg.onclose = () => {
    if (dlg.returnValue !== 'ok') return;
    const n = $('#meInput').value.trim().slice(0, 24);
    if (n.length >= 2) me.name = n;
    me.avatar = picked;
    store.set('ttl:me', me); paintMe();
    toast(`New phone, who dis? You're now ${me.avatar} ${me.name}`);
  };
  dlg.showModal();
}

// ---------- api ----------
async function api(path, opts = {}) {
  const res = await fetch(`/api${path}`, {
    ...opts,
    headers: { 'content-type': 'application/json', 'x-fan-id': me.uid, ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify({ name: me.name, avatar: me.avatar, ...opts.body }) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// ---------- toasts, confetti, floaters ----------
function toast(msg, err = false) {
  const el = document.createElement('div');
  el.className = `toast${err ? ' err' : ''}`; el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), 3200);
}
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
function confetti(amount = 140, colors) {
  if (reduceMotion) return;
  const cv = $('#confetti'), ctx = cv.getContext('2d');
  cv.width = innerWidth * devicePixelRatio; cv.height = innerHeight * devicePixelRatio;
  ctx.scale(devicePixelRatio, devicePixelRatio);
  const pal = colors || ['#ffd23f', '#ff4d6d', '#3ddbd9', '#a78bfa', '#4ade80', '#ff9f1c'];
  const ps = Array.from({ length: amount }, () => ({
    x: innerWidth / 2 + (Math.random() - 0.5) * 200, y: innerHeight * 0.35,
    vx: (Math.random() - 0.5) * 14, vy: -Math.random() * 14 - 4, r: Math.random() * 6 + 4,
    c: rand(pal), rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4,
  }));
  let frames = 0;
  (function tick() {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    for (const p of ps) {
      p.vy += 0.35; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.rot += p.vr;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.c;
      ctx.fillRect(-p.r / 2, -p.r / 4, p.r, p.r / 2); ctx.restore();
    }
    if (++frames < 160) requestAnimationFrame(tick); else ctx.clearRect(0, 0, innerWidth, innerHeight);
  })();
}
function floatEmoji(emoji, x, y) {
  if (reduceMotion) return;
  const el = document.createElement('div');
  el.className = 'floater'; el.textContent = emoji;
  el.style.left = `${x - 14}px`; el.style.top = `${y - 14}px`;
  el.style.setProperty('--dx', `${(Math.random() - 0.5) * 80}px`);
  el.style.setProperty('--rot', `${(Math.random() - 0.5) * 60}deg`);
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1200);
}

// ---------- colors ----------
function hexLum(hex) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * ch((n >> 16) & 255) + 0.7152 * ch((n >> 8) & 255) + 0.0722 * ch(n & 255);
}
function hexDist(a, b) {
  const p = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const [x, y] = [p(a), p(b)];
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}
const okHex = (h) => typeof h === 'string' && /^#[0-9a-f]{6}$/i.test(h);
function usable(t) {
  for (const c of [t?.color, t?.alt]) if (okHex(c) && hexLum(c) > 0.035 && hexLum(c) < 0.8) return c;
  return null;
}
// Team colors that are visible on our cards and distinct from each other.
function sideColors(g) {
  let a = usable(g.away) || '#ff4d6d', h = usable(g.home) || '#3ddbd9';
  if (hexDist(a, h) < 90) {
    const alt = [g.home?.alt, g.home?.color].find((c) => okHex(c) && hexLum(c) > 0.035 && hexLum(c) < 0.8 && hexDist(c, a) >= 90);
    h = alt || (hexDist(a, '#3ddbd9') >= 90 ? '#3ddbd9' : '#ffd23f');
  }
  return { a, h };
}

// ---------- shared bits ----------
const logo = (t, cls = '') => t?.logo
  ? `<img class="${cls}" src="${esc(t.logo)}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'logo-fallback',textContent:'${esc(t.abbr || '?')}'}))">`
  : `<div class="logo-fallback ${cls}">${esc(t?.abbr || '?')}</div>`;

function statusLabel(g) {
  const s = g.status;
  if (s.state === 'in') return `<span class="status live"><span class="dot"></span>${esc(s.short || 'LIVE')}</span>`;
  if (s.state === 'pre') {
    const pp = /postpon|cancel|delay/i.test(s.detail);
    return `<span class="status">${pp ? esc(s.short) : esc(fmtTime(g.date))}</span>`;
  }
  return `<span class="status">${esc(s.short || 'Final')}</span>`;
}

let timers = [];
const every = (fn, ms) => timers.push(setInterval(() => { if (!document.hidden) fn(); }, ms));
function clearTimers() { timers.forEach(clearInterval); timers = []; }

// ---------- ticker ----------
async function loadTicker() {
  try {
    const { games } = await api(`/scoreboard?league=all&date=${ymd(new Date())}`);
    const order = { in: 0, post: 1, pre: 2 };
    const items = games.filter((g) => g.home && g.away)
      .sort((x, y) => order[x.status.state] - order[y.status.state] || y.vibe.chaos - x.vibe.chaos)
      .slice(0, 18)
      .map((g) => {
        const sc = g.status.state === 'pre' ? 'vs' : `${g.away.score ?? 0}-${g.home.score ?? 0}`;
        return `<span><b>${esc(g.leagueLabel)}</b>${esc(g.away.abbr)} ${esc(sc)} ${esc(g.home.abbr)}: ${esc(g.vibe.line)}</span>`;
      });
    const html = items.length ? items.join('') : '<span><b>BREAKING</b>No games today. Go outside. Touch grass. Report back.</span>';
    $('#ticker').innerHTML = html + html; // doubled for a seamless loop
  } catch { $('#ticker').innerHTML = '<span><b>TICKER</b>The ticker intern is on lunch break.</span>'.repeat(2); }
}

// ---------- router ----------
function route() {
  clearTimers();
  const h = location.hash.replace(/^#\/?/, '');
  const [view, a, b] = h.split('/');
  if (typeof leaveLive === 'function') leaveLive();
  const nav = ['hall', 'fantasy', 'live'].includes(view) ? view : 'scores';
  $$('.nav a').forEach((el) => el.classList.toggle('active', el.dataset.nav === nav));
  document.body.dataset.view = view || 'scores';
  window.scrollTo(0, 0);
  if (view === 'game' && a && b) return renderGame(a, b);
  if (view === 'live' && a && b) return renderLive(a, b);
  if (view === 'live') return renderLiveLobby();
  if (view === 'fantasy') return renderFantasy();
  if (view === 'hall') return renderHall();
  return renderScores();
}

// =================================================================
// SCORES
// =================================================================
const sb = {
  league: store.get('ttl:league', 'all'),
  date: ymd(new Date()),
  filter: store.get('ttl:filter', 'all'),
  sort: store.get('ttl:sort', 'league'),
  leagues: [],
  games: [],
  prev: new Map(),
};

const SUBTITLES = [
  'Every score. Every stat. Zero chill.',
  'Sports news, but your funniest friend is reading it.',
  'Where hot takes come to be judged.',
  'Like a sports app, but it roasts.',
];

async function renderScores() {
  const app = $('#app');
  if (!sb.leagues.length) sb.leagues = await api('/leagues').catch(() => []);
  const today = ymd(new Date());
  app.innerHTML = `
    <h1 class="hero-title">THE <span class="hl">SCOREBOARD</span> OF CHAOS</h1>
    <p class="hero-sub">${esc(rand(SUBTITLES))}</p>
    <div class="controls">
      <div class="datebar" role="group" aria-label="Date">
        <button type="button" data-shift="-1" aria-label="Previous day">◀</button>
        <button type="button" data-shift="0" class="${sb.date === today ? 'today' : ''}">Today</button>
        <input type="date" id="datePick" value="${isoDate(sb.date)}" aria-label="Pick a date">
        <button type="button" data-shift="1" aria-label="Next day">▶</button>
      </div>
      <div class="chips" id="filters" role="group" aria-label="Status filter">
        ${[['all', 'Everything'], ['in', '🔴 Live'], ['pre', '⏳ Upcoming'], ['post', '✅ Final']]
          .map(([k, l]) => `<button class="chip" data-filter="${k}" aria-pressed="${sb.filter === k}">${l}</button>`).join('')}
      </div>
      <span class="spacer"></span>
      <select class="select" id="sortSel" aria-label="Sort">
        <option value="league" ${sb.sort === 'league' ? 'selected' : ''}>Group by league</option>
        <option value="chaos" ${sb.sort === 'chaos' ? 'selected' : ''}>🌪️ Most chaotic first</option>
        <option value="takes" ${sb.sort === 'takes' ? 'selected' : ''}>💬 Most takes first</option>
      </select>
    </div>
    <div class="chips" id="leagueChips" role="group" aria-label="League"></div>
    <div id="games"><div class="grid">${'<div class="skeleton"></div>'.repeat(6)}</div></div>`;

  $('.datebar', app).onclick = (e) => {
    const b = e.target.closest('button[data-shift]'); if (!b) return;
    const s = +b.dataset.shift;
    const d = s === 0 ? new Date() : fromYmd(sb.date); if (s) d.setDate(d.getDate() + s);
    sb.date = ymd(d); renderScores();
  };
  $('#datePick').onchange = (e) => { if (e.target.value) { sb.date = e.target.value.replaceAll('-', ''); renderScores(); } };
  $('#filters').onclick = (e) => {
    const b = e.target.closest('[data-filter]'); if (!b) return;
    sb.filter = b.dataset.filter; store.set('ttl:filter', sb.filter);
    $$('[data-filter]').forEach((x) => x.setAttribute('aria-pressed', x === b)); paintGames();
  };
  $('#sortSel').onchange = (e) => { sb.sort = e.target.value; store.set('ttl:sort', sb.sort); paintGames(); };
  $('#leagueChips').onclick = (e) => {
    const b = e.target.closest('[data-league]'); if (!b) return;
    sb.league = b.dataset.league; store.set('ttl:league', sb.league); paintGames();
  };

  loadFantasyMap().then(() => sb.games.length && paintGames(true));
  await loadGames();
  every(async () => { if (sb.games.some((g) => g.status.state === 'in')) await loadGames(true); }, 30000);
}

async function loadGames(quiet = false) {
  try {
    const { games } = await api(`/scoreboard?league=all&date=${sb.date}`);
    sb.games = games;
    paintGames(quiet);
  } catch (e) {
    if (!quiet) $('#games').innerHTML = `<div class="empty-state"><div class="big">📡</div><p>${esc(e.message)}</p><button class="btn primary" onclick="route()">Try again</button></div>`;
  }
}

function paintGames(quiet = false) {
  const counts = {};
  for (const g of sb.games) counts[g.league] = (counts[g.league] || 0) + 1;
  const live = sb.games.filter((g) => g.status.state === 'in').length;
  $('#leagueChips').innerHTML = [
    `<button class="chip" data-league="all" aria-pressed="${sb.league === 'all'}">🌎 All sports <span class="count">${sb.games.length}${live ? ` · ${live} live` : ''}</span></button>`,
    ...sb.leagues.map((l) => `<button class="chip ${counts[l.key] ? '' : 'empty'}" data-league="${l.key}" aria-pressed="${sb.league === l.key}">${l.emoji} ${esc(l.label)} <span class="count">${counts[l.key] || 0}</span></button>`),
  ].join('');

  let list = sb.games.filter((g) => (sb.league === 'all' || g.league === sb.league) && (sb.filter === 'all' || g.status.state === sb.filter));
  const order = { in: 0, pre: 1, post: 2 };
  const byState = (x, y) => order[x.status.state] - order[y.status.state] || new Date(x.date) - new Date(y.date);

  const el = $('#games');
  if (!list.length) {
    const msgs = sb.filter === 'in'
      ? ['Nothing live right now. Perfect time to refill the snacks.', '🍿']
      : ['No games here. The athletes are presumably at brunch.', '🥞'];
    el.innerHTML = `<div class="empty-state"><div class="big">${msgs[1]}</div><p>${msgs[0]}</p></div>`;
    return;
  }
  if (sb.sort === 'chaos') {
    list.sort((x, y) => y.vibe.chaos - x.vibe.chaos || byState(x, y));
    el.innerHTML = `<div class="grid">${list.map(cardHTML).join('')}</div>`;
  } else if (sb.sort === 'takes') {
    list.sort((x, y) => y.takeCount - x.takeCount || byState(x, y));
    el.innerHTML = `<div class="grid">${list.map(cardHTML).join('')}</div>`;
  } else {
    const groups = [];
    for (const l of sb.leagues) {
      const gs = list.filter((g) => g.league === l.key).sort(byState);
      if (gs.length) groups.push(`<h2 class="league-head">${l.emoji} ${esc(l.label)} <small>${gs.length} game${gs.length > 1 ? 's' : ''}</small></h2><div class="grid">${gs.map(cardHTML).join('')}</div>`);
    }
    el.innerHTML = groups.join('');
  }
  // Bump scores that changed since the last refresh.
  for (const g of list) {
    const k = `${g.league}:${g.id}`, now = `${g.away?.score}-${g.home?.score}`;
    if (quiet && sb.prev.get(k) && sb.prev.get(k) !== now) {
      const card = $(`[data-key="${k}"]`); card && $$('.tscore', card).forEach((s) => s.classList.add('bump'));
    }
    sb.prev.set(k, now);
  }
}

function cardHTML(g) {
  const { a, h } = sideColors(g);
  const st = g.status.state;
  const hs = g.home?.score, as = g.away?.score;
  const row = (t, other) => {
    const cls = st === 'post' && t && other && t.score !== other.score ? (t.score > other.score ? 'winner' : 'loser') : '';
    return `<div class="teamrow ${cls}">
      ${logo(t)}
      <div class="tname">${t?.rank ? `<span class="rank">#${t.rank}</span>` : ''}${esc(t?.name || 'TBD')}${cls === 'winner' ? '<span class="crown" aria-label="winner">👑</span>' : ''}<small>${esc(t?.record || '')}</small></div>
      <div class="tscore">${st === 'pre' || t?.score == null ? '' : esc(t.score)}</div>
    </div>`;
  };
  const p = g.poll || { home: 0, away: 0 };
  const pt = p.home + p.away;
  const pollTxt = pt ? `🗳 ${Math.round((Math.max(p.home, p.away) / pt) * 100)}% ${esc((p.home >= p.away ? g.home : g.away)?.abbr)}` : '🗳 no picks yet';
  const liveNow = st === 'in';
  const href = liveNow ? `#/live/${esc(g.league)}/${esc(g.id)}` : `#/game/${esc(g.league)}/${esc(g.id)}`;
  return `<a class="card ${liveNow ? 'is-live' : ''}" href="${href}" data-key="${esc(g.league)}:${esc(g.id)}" style="--away-c:${a};--home-c:${h}">
    <div class="card-top"><span>${g.emoji} ${esc(g.leagueLabel)}${g.broadcast ? ` · ${esc(g.broadcast)}` : ''}</span>${statusLabel(g)}</div>
    ${row(g.away, g.home)}
    ${row(g.home, g.away)}
    <span class="badge ${esc(g.vibe.badgeClass)}">${esc(g.vibe.badge)}</span>
    <p class="vibe">${esc(g.vibe.line)}</p>
    ${st === 'pre' ? '' : `<div class="chaos" title="How unhinged this game is"><span>Chaos</span><div class="chaos-bar"><i style="width:${g.vibe.chaos}%"></i></div><span>${g.vibe.chaos}</span></div>`}
    ${fantasyChip(g)}
    <div class="card-foot"><span>💬 ${g.takeCount} take${g.takeCount === 1 ? '' : 's'} · ${pollTxt}</span>${liveNow
      ? `<span class="enter live-enter">🔴 ${g.viewers ? `${g.viewers} watching · ` : ''}Join live →</span>`
      : '<span class="enter">Enter the thread →</span>'}</div>
  </a>`;
}

// =================================================================
// GAME
// =================================================================
const gv = { key: null, data: null, social: null, sort: 'hot', heat: 'mild', replyTo: null, pendingReacts: {}, reactTimer: null };

const PROMPTS = [
  'Drop your hottest take. Wrong answers encouraged.',
  'Rate the refs from 1 to "legally blind."',
  "Who's the MVP? Who's the LVP? Be honest.",
  'Explain what just happened like I\'m 5.',
  'Write a breakup letter to your team\'s defense.',
  'Prediction time. We will remember this.',
];
const QUICK = ['The refs are blind 🙈', "WE'RE SO BACK 🚀", "It's so over 💀", 'Called it 🔮', 'Fire the coach 🔥', 'This is cinema 🎬'];

async function renderGame(league, id) {
  const app = $('#app');
  gv.key = `${league}:${id}`; gv.replyTo = null; gv.data = null;
  app.innerHTML = `<a class="back" href="#/">← Back to the chaos</a><div class="skeleton" style="height:240px"></div>`;
  try {
    gv.data = await api(`/game/${league}/${id}`);
  } catch (e) {
    app.innerHTML = `<a class="back" href="#/">← Back to the chaos</a><div class="empty-state"><div class="big">🕳️</div><p>${esc(e.message)}</p></div>`;
    return;
  }
  gv.social = gv.data.social;
  const d = gv.data, g = d.game;
  const { a, h } = sideColors(g);
  app.innerHTML = `
    <a class="back" href="#/">← Back to the chaos</a>
    <section class="scorehero" id="hero" style="--away-c:${a};--home-c:${h}"></section>
    <div class="layout">
      <div>
        <section class="panel"><h3>🎙️ The Intern's Commentary <small>unpaid, unfiltered</small></h3><ul class="intern" id="intern"></ul></section>
        <section class="panel" id="wpPanel" hidden><h3>📉 The Panic Graph <small>win probability</small></h3><div class="wp" id="wp"></div></section>
        <section class="panel" id="thread">
          <div class="thread-head">
            <h3>💬 The Thread</h3>
            <span class="muted" id="takeCount"></span>
            <span class="spacer"></span>
            <div class="chips" role="group" aria-label="Sort takes">
              <button class="chip" data-sort="hot" aria-pressed="true">🔥 Hot</button>
              <button class="chip" data-sort="new" aria-pressed="false">🆕 New</button>
            </div>
          </div>
          <div class="composer">
            <textarea id="takeText" maxlength="500" placeholder="${esc(rand(PROMPTS))}" aria-label="Your take"></textarea>
            <div class="chips" style="margin:6px 0 10px">${QUICK.map((q) => `<button type="button" class="chip" data-quick="${esc(q)}">${esc(q)}</button>`).join('')}</div>
            <div class="composer-foot">
              <div class="heat" role="group" aria-label="Take temperature">
                <button type="button" data-heat="mild" aria-pressed="true">🌶 Mild</button>
                <button type="button" data-heat="spicy" aria-pressed="false">🌶🌶 Spicy</button>
                <button type="button" data-heat="nuclear" aria-pressed="false">☢️ Nuclear</button>
              </div>
              <span class="counter" id="counter">0/500</span>
              <button class="btn primary" id="postBtn" type="button">Post take</button>
            </div>
            <div class="posting-as" style="margin-top:8px">Posting as ${esc(me.avatar)} <b>${esc(me.name)}</b> · <button type="button" id="changeMe">change</button></div>
          </div>
          <div class="takes" id="takes"></div>
        </section>
        <section class="panel" id="playsPanel" hidden><h3>📋 Key Plays</h3><ul class="plays" id="plays"></ul></section>
      </div>
      <aside class="side">
        <section class="panel"><h3>🗳️ Who Ya Got?</h3><div id="poll"></div></section>
        <section class="panel"><h3>📣 React</h3><div class="reacts" id="reacts"></div></section>
        <section class="panel" id="excusePanel"><h3>🙃 Excuse Generator</h3><div id="excuse"></div></section>
        <section class="panel" id="linesPanel" hidden><h3>🔢 By the Numbers</h3><div class="table-scroll" id="lines"></div></section>
        <section class="panel" id="tapePanel" hidden><h3>📊 Tale of the Tape</h3><div id="tape"></div></section>
        <section class="panel" id="leadersPanel" hidden><h3>⭐ Who Showed Up</h3><div class="leaders" id="leaders"></div></section>
      </aside>
    </div>`;

  paintGameStatic();
  paintPoll(); paintReacts(); paintExcuse(); paintTakes();
  wireComposer();
  celebrateIfCalledIt();

  every(refreshSocial, 8000);
  every(async () => {
    if (gv.data?.game.status.state !== 'in') return;
    try {
      const fresh = await api(`/game/${league}/${id}`);
      if (gv.key !== `${league}:${id}`) return;
      const prevState = gv.data.game.status.state;
      gv.data = fresh; gv.social = fresh.social;
      paintGameStatic(); paintPoll(); paintReacts();
      if (prevState !== 'post' && fresh.game.status.state === 'post') celebrateIfCalledIt();
    } catch { /* keep the old data */ }
  }, 20000);
}

function paintGameStatic() {
  const d = gv.data, g = d.game, st = g.status.state;
  const hs = g.home?.score ?? 0, as = g.away?.score ?? 0;
  const lose = (mine, other) => (st === 'post' && mine < other ? 'lose' : '');
  $('#hero').innerHTML = `
    <div class="sh-meta">${g.emoji} ${esc(g.leagueLabel)}${g.venue ? ` · ${esc(g.venue)}` : ''}${g.broadcast ? ` · 📺 ${esc(g.broadcast)}` : ''}</div>
    ${g.note ? `<div class="sh-meta" style="margin-top:2px">${esc(g.note)}</div>` : ''}
    <div class="sh-main">
      <div class="sh-team">${logo(g.away)}<div class="nm">${g.away?.rank ? `#${g.away.rank} ` : ''}${esc(g.away?.full || g.away?.name)}</div><div class="rec">${esc(g.away?.record || '')}</div></div>
      <div>
        <div class="sh-score">${st === 'pre' ? '<span class="dash">VS</span>' : `<span class="${lose(as, hs)}">${esc(as)}</span><span class="dash">–</span><span class="${lose(hs, as)}">${esc(hs)}</span>`}</div>
        <div class="sh-status ${st === 'in' ? 'live' : ''}">${st === 'in' ? '🔴 ' : ''}${esc(st === 'pre' ? `${new Date(g.date).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}` : g.status.detail)}</div>
        ${g.situation && st === 'in' ? `<div class="sh-situation">${esc(g.situation)}</div>` : ''}
        ${d.odds && st === 'pre' ? `<div class="sh-situation">Line: ${esc(d.odds)}</div>` : ''}
      </div>
      <div class="sh-team">${logo(g.home)}<div class="nm">${g.home?.rank ? `#${g.home.rank} ` : ''}${esc(g.home?.full || g.home?.name)}</div><div class="rec">${esc(g.home?.record || '')}</div></div>
    </div>
    <div class="sh-badge"><span class="badge ${esc(g.vibe.badgeClass)}">${esc(g.vibe.badge)}</span></div>
    ${st !== 'post' ? `<div class="sh-badge"><a class="btn primary live-cta" href="#/live/${esc(g.league)}/${esc(g.id)}">${st === 'in' ? '🔴 Join the Live Room' : '📺 Live Room opens at kickoff, get in early'}</a></div>` : ''}`;

  $('#intern').innerHTML = d.commentary.map((line, i) =>
    `<li><div class="mic">${['🎙️', '🤓', '📢', '🧃', '🫠'][i % 5]}</div><div class="bubble">${esc(line)}</div></li>`).join('');

  // Linescore
  const ls = [g.away?.linescores || [], g.home?.linescores || []];
  const n = Math.max(ls[0].length, ls[1].length);
  if (n && st !== 'pre') {
    const reg = { football: 4, basketball: 4, hockey: 3, baseball: 99, soccer: 99 }[g.sport] || 99;
    const head = Array.from({ length: n }, (_, i) => (i >= reg ? (n - reg > 1 ? `OT${i - reg + 1}` : 'OT') : i + 1));
    const tr = (t, arr) => `<tr><td>${esc(t?.abbr)}</td>${head.map((_, i) => `<td>${esc(arr[i] ?? '-')}</td>`).join('')}<td class="tot">${esc(t?.score ?? '')}</td></tr>`;
    $('#lines').innerHTML = `<table class="lines"><thead><tr><th></th>${head.map((x) => `<th>${x}</th>`).join('')}<th>T</th></tr></thead><tbody>${tr(g.away, ls[0])}${tr(g.home, ls[1])}</tbody></table>`;
    $('#linesPanel').hidden = false;
  }

  // Tale of the tape
  if (d.stats.length && st !== 'pre') {
    const { a, h } = sideColors(g);
    const val = (s) => { const m = String(s).match(/-?\d+(\.\d+)?/); return m ? Math.abs(parseFloat(m[0])) : 0; };
    $('#tape').innerHTML = `<div class="tape-head"><span>${esc(g.away?.abbr)}</span><span></span><span>${esc(g.home?.abbr)}</span></div><div class="tape">` +
      d.stats.map((s) => {
        const av = val(s.away), hv = val(s.home), tot = av + hv || 1;
        return `<div class="tape-row"><span class="v">${esc(s.away)}</span>
          <div class="tape-mid"><div class="lbl">${esc(s.label)}</div><div class="tape-bars"><i class="a" style="width:${(av / tot) * 100}%;background:${a}"></i><i class="h" style="width:${(hv / tot) * 100}%;background:${h}"></i></div></div>
          <span class="v r">${esc(s.home)}</span></div>`;
      }).join('') + '</div>';
    $('#tapePanel').hidden = false;
  }

  // Leaders
  if (d.leaders.length && st !== 'pre') {
    $('#leaders').innerHTML = d.leaders.map((t) => `<div class="leader-team"><h4>${t.logo ? `<img src="${esc(t.logo)}" alt="">` : ''}${esc(t.abbr)}</h4>
      ${t.cats.map((c) => `<div class="leader">${c.headshot ? `<img src="${esc(c.headshot)}" alt="" loading="lazy">` : '<div class="ph">👤</div>'}
        <div><div class="cat">${esc(c.cat)}</div><div class="pl">${esc(c.player)}</div><div class="ln">${esc(c.line)}</div></div></div>`).join('')}</div>`).join('');
    $('#leadersPanel').hidden = false;
  }

  // Plays
  if (d.plays.length) {
    $('#plays').innerHTML = d.plays.map((p) => `<li><span class="when">${p.period ? `${g.sport === 'baseball' ? 'Inn' : 'P'}${esc(p.period)}` : ''} ${esc(p.clock)}</span><span>${p.team ? `<b>${esc(p.team)}</b> ` : ''}${esc(p.text)}</span><span class="sc">${esc(p.score || '')}</span></li>`).join('');
    $('#playsPanel').hidden = false;
  }

  if (d.winProb.length > 3) { $('#wpPanel').hidden = false; paintPanicGraph(); }
}

// Win probability line: one series, home win % (top = home wins).
function paintPanicGraph() {
  const g = gv.data.game, pts = gv.data.winProb;
  const W = 600, H = 100;
  const x = (i) => (i / (pts.length - 1)) * W, y = (v) => H - v;
  const d = pts.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const last = pts[pts.length - 1];
  const wp = $('#wp');
  wp.innerHTML = `
    <div class="wp-plot">
    <div class="lbl-top">${g.home?.logo ? `<img src="${esc(g.home.logo)}" alt="">` : ''}${esc(g.home?.abbr)} wins</div>
    <div class="lbl-bot">${g.away?.logo ? `<img src="${esc(g.away.logo)}" alt="">` : ''}${esc(g.away?.abbr)} wins</div>
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Win probability over the game. ${esc(g.home?.abbr)} currently ${last}%.">
      <line x1="0" y1="50" x2="${W}" y2="50" stroke="var(--line)" stroke-width="1" stroke-dasharray="4 4" vector-effect="non-scaling-stroke"/>
      <path d="${d}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
      <line id="wpX" x1="0" x2="0" y1="0" y2="${H}" stroke="var(--ink-2)" stroke-width="1" vector-effect="non-scaling-stroke" opacity="0"/>
    </svg>
    <div class="wp-tip" id="wpTip"></div>
    </div>
    <p class="muted" style="margin:8px 0 0;font-size:13px">${esc(panicLine(g, pts))}</p>`;
  const svg = $('svg', wp), tip = $('#wpTip'), xl = $('#wpX');
  svg.onmousemove = (e) => {
    const r = svg.getBoundingClientRect();
    const i = Math.max(0, Math.min(pts.length - 1, Math.round(((e.clientX - r.left) / r.width) * (pts.length - 1))));
    const v = pts[i];
    xl.setAttribute('x1', x(i)); xl.setAttribute('x2', x(i)); xl.setAttribute('opacity', 1);
    tip.style.left = `${(x(i) / W) * 100}%`;
    tip.textContent = v >= 50 ? `${g.home?.abbr} ${v.toFixed(0)}%` : `${g.away?.abbr} ${(100 - v).toFixed(0)}%`;
  };
  svg.onmouseleave = () => xl.setAttribute('opacity', 0);
}
function panicLine(g, pts) {
  const lo = Math.min(...pts), hi = Math.max(...pts);
  const swing = hi - lo;
  if (swing > 80) return `A ${swing.toFixed(0)}-point swing. Fans of both teams aged roughly 6 years.`;
  if (swing > 50) return 'This line looks like my heart monitor during the 4th quarter.';
  if (swing < 20) return 'Flat as a pancake. One team decided early and the other agreed.';
  return 'Some ups, some downs, a few blood pressure spikes.';
}

// ---------- poll ----------
function paintPoll() {
  const g = gv.data.game, p = gv.social.poll, st = g.status.state;
  const tot = p.home + p.away;
  const pa = tot ? Math.round((p.away / tot) * 100) : 50, ph = 100 - pa;
  const { a, h } = sideColors(g);
  const closed = st === 'post';
  const btn = (side, t) => `<button class="poll-btn ${p.mine === side ? 'mine' : ''}" data-side="${side}" ${closed ? 'disabled' : ''} aria-pressed="${p.mine === side}">
      ${logo(t)}<span>${esc(t?.name)}</span>${p.mine === side ? '<small>✅ your pick</small>' : ''}</button>`;
  let note;
  if (closed) {
    const res = (g.home?.score ?? 0) === (g.away?.score ?? 0) ? 'tie' : (g.home.score > g.away.score ? 'home' : 'away');
    note = !p.mine ? 'Polls closed. You didn\'t pick. Coward. (Respectfully.)'
      : p.mine === res ? '🔮 You called it. Nostradamus who?'
      : '📉 Your pick has been forwarded to the Bad Takes Department.';
  } else {
    note = p.mine ? `You're riding with ${esc((p.mine === 'home' ? g.home : g.away)?.name)}. Switch if you dare.` : 'Pick a side. Fence-sitters get splinters.';
  }
  $('#poll').innerHTML = `<div class="poll-btns">${btn('away', g.away)}${btn('home', g.home)}</div>
    <div class="poll-bar" aria-label="${pa}% ${esc(g.away?.abbr)}, ${ph}% ${esc(g.home?.abbr)}">
      <div class="away" style="flex-grow:${tot ? pa : 1};background:${a}">${tot ? `${pa}%` : ''}</div>
      <div class="home" style="flex-grow:${tot ? ph : 1};background:${h}">${tot ? `${ph}%` : ''}</div>
    </div>
    <div class="poll-note">${note} <span class="muted">(${tot} vote${tot === 1 ? '' : 's'})</span></div>`;
  $('#poll').onclick = async (e) => {
    const b = e.target.closest('[data-side]'); if (!b || b.disabled) return;
    try {
      gv.social.poll = await api(`/game/${gv.data.game.league}/${gv.data.game.id}/poll`, { method: 'POST', body: { side: b.dataset.side } });
      paintPoll();
      const r = b.getBoundingClientRect(); floatEmoji('🗳️', r.left + r.width / 2, r.top);
      toast(rand(['Locked in. No take-backs. (There are take-backs.)', 'Bold. We respect it.', 'Bandwagon or believer? Time will tell.']));
    } catch (err) { toast(err.message, true); }
  };
}
function celebrateIfCalledIt() {
  const g = gv.data.game, p = gv.social.poll;
  if (g.status.state !== 'post' || !p.mine) return;
  const res = g.home.score > g.away.score ? 'home' : g.away.score > g.home.score ? 'away' : 'tie';
  const flag = `ttl:cele:${gv.key}`;
  if (store.get(flag, false)) return;
  store.set(flag, true);
  if (p.mine === res) { confetti(220); toast('🔮 YOU CALLED IT. Added to your prophet record.'); }
}

// ---------- reactions ----------
function paintReacts() {
  const r = { ...gv.social.reactions };
  for (const [e, n] of Object.entries(gv.pendingReacts)) r[e] = (r[e] || 0) + n;
  const names = { '🔥': 'Fire', '😂': 'LOL', '😭': 'Crying', '🤡': 'Clown', '🐐': 'GOAT', '🧂': 'Salty', '💀': 'Dead', '🚀': 'To the moon' };
  $('#reacts').innerHTML = Object.entries(r).map(([e, n]) => `<button class="react" data-e="${e}" aria-label="${names[e] || e} (${n})">${e}<span>${n}</span></button>`).join('');
  $('#reacts').onclick = (ev) => {
    const b = ev.target.closest('[data-e]'); if (!b) return;
    const e = b.dataset.e;
    gv.pendingReacts[e] = (gv.pendingReacts[e] || 0) + 1;
    $('span', b).textContent = Number($('span', b).textContent) + 1;
    floatEmoji(e, ev.clientX || b.getBoundingClientRect().left + 20, ev.clientY || b.getBoundingClientRect().top);
    clearTimeout(gv.reactTimer);
    gv.reactTimer = setTimeout(flushReacts, 700);
  };
}
async function flushReacts() {
  const pending = gv.pendingReacts; gv.pendingReacts = {};
  const { league, id } = gv.data.game;
  for (const [emoji, n] of Object.entries(pending)) {
    try { gv.social.reactions = await api(`/game/${league}/${id}/react`, { method: 'POST', body: { emoji, n } }); }
    catch (e) { toast(e.message, true); }
  }
}

// ---------- excuse generator ----------
function paintExcuse() {
  const g = gv.data.game, st = g.status.state;
  const hs = g.home?.score ?? 0, as = g.away?.score ?? 0;
  const loser = st === 'pre' ? null : hs < as ? g.home : as < hs ? g.away : null;
  const who = loser ? `${loser.name} fans, repeat after me:` : st === 'pre' ? 'Pre-loaded excuse, just in case:' : 'For whoever needs it:';
  let current = rand(gv.data.excuses);
  const draw = () => {
    $('#excuse').innerHTML = `<div class="excuse"><div class="excuse-who">${esc(who)}</div>"${esc(current)}"</div>
      <div class="row" style="margin-top:10px"><button class="btn" type="button" id="exNew">🎲 New excuse</button><button class="btn ghost" type="button" id="exPost">Post it →</button></div>`;
    $('#exNew').onclick = () => { let n; do { n = rand(gv.data.excuses); } while (n === current && gv.data.excuses.length > 1); current = n; draw(); };
    $('#exPost').onclick = () => { const t = $('#takeText'); t.value = `Official excuse: ${current}`; t.focus(); t.dispatchEvent(new Event('input')); t.scrollIntoView({ behavior: 'smooth', block: 'center' }); };
  };
  draw();
}

// ---------- thread ----------
function wireComposer() {
  const ta = $('#takeText');
  ta.oninput = () => { $('#counter').textContent = `${ta.value.length}/500`; };
  $('.composer .chips').onclick = (e) => {
    const b = e.target.closest('[data-quick]'); if (!b) return;
    ta.value = (ta.value ? `${ta.value} ` : '') + b.dataset.quick; ta.focus(); ta.oninput();
  };
  $('.heat').onclick = (e) => {
    const b = e.target.closest('[data-heat]'); if (!b) return;
    gv.heat = b.dataset.heat; $$('.heat button').forEach((x) => x.setAttribute('aria-pressed', x === b));
    if (gv.heat === 'nuclear') toast('☢️ Nuclear take armed. Proceed with caution.');
  };
  $('#postBtn').onclick = () => postTake(ta.value, null, ta, $('#postBtn'));
  ta.onkeydown = (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) $('#postBtn').click(); };
  $('#changeMe').onclick = openMeDialog;
  $('.thread-head .chips').onclick = (e) => {
    const b = e.target.closest('[data-sort]'); if (!b) return;
    gv.sort = b.dataset.sort; $$('[data-sort]').forEach((x) => x.setAttribute('aria-pressed', x === b)); paintTakes();
  };
  $('#takes').onclick = onTakeClick;
}

async function postTake(text, parentId, input, btn) {
  text = text.trim();
  if (text.length < 2) return toast('Say something! Even "booo" counts.', true);
  const { league, id } = gv.data.game;
  btn && (btn.disabled = true);
  try {
    const c = await api(`/game/${league}/${id}/comments`, { method: 'POST', body: { text, heat: parentId ? 'mild' : gv.heat, parentId } });
    gv.social.comments.push(c);
    input.value = ''; input.oninput && input.oninput();
    gv.replyTo = null;
    paintTakes();
    if (!parentId) {
      confetti(gv.heat === 'nuclear' ? 200 : 70, gv.heat === 'nuclear' ? ['#ff4d6d', '#ff9f1c', '#ffd23f'] : undefined);
      toast(rand(['Take posted. The people will judge.', 'Bold words. Bookmarked for later.', 'Hot take delivered. 🔥', 'Your take is live. No refunds.']));
    }
  } catch (e) { toast(e.message, true); }
  finally { btn && (btn.disabled = false); }
}

function takeHTML(c, replies = []) {
  const heat = { mild: '🌶 mild', spicy: '🌶🌶 spicy', nuclear: '☢️ NUCLEAR' }[c.heat] || '';
  const tag = c.fire >= 3 && c.fire >= c.cap * 3 ? '<span class="ratio">🔥 VERIFIED HOT</span>'
    : c.cap >= 3 && c.cap > c.fire * 2 ? '<span class="ratio clown">🤡 RATIO\'D</span>' : '';
  return `<article class="take ${esc(c.heat)}" data-id="${esc(c.id)}">
    <div class="av" aria-hidden="true">${esc(c.avatar || '🙂')}</div>
    <div class="take-body">
      <div class="take-meta"><b>${esc(c.name)}</b>${c.mine ? '<span class="muted">(you)</span>' : ''}${c.parentId ? '' : `<span class="heat-tag ${esc(c.heat)}">${heat}</span>`}${tag}<span class="t">${ago(c.createdAt)}</span></div>
      <p class="take-text">${esc(c.text)}</p>
      <div class="take-actions">
        <button class="tact fire" data-act="fire" aria-pressed="${c.myVote === 'fire'}" title="This take is fire">🔥 ${c.fire}</button>
        <button class="tact cap" data-act="cap" aria-pressed="${c.myVote === 'cap'}" title="This take is cap">🧢 ${c.cap}</button>
        ${c.parentId ? '' : '<button class="tact" data-act="reply">↩ Reply</button>'}
        ${c.mine ? '<button class="tact" data-act="del">🗑 Delete</button>' : ''}
      </div>
      ${gv.replyTo === c.id ? `<div class="reply-box"><input maxlength="500" placeholder="Clap back, respectfully…" aria-label="Reply" id="replyInput"><button class="btn primary" data-act="sendReply">Send</button></div>` : ''}
      ${replies.length ? `<div class="replies">${replies.map((r) => takeHTML(r)).join('')}</div>` : ''}
    </div>
  </article>`;
}

function paintTakes() {
  const all = gv.social.comments;
  const roots = all.filter((c) => !c.parentId);
  const kids = (id) => all.filter((c) => c.parentId === id).sort((x, y) => x.createdAt - y.createdAt);
  const hot = (c) => c.score + kids(c.id).length * 0.5 + 2 / (1 + (Date.now() - c.createdAt) / 3.6e6);
  roots.sort(gv.sort === 'new' ? (x, y) => y.createdAt - x.createdAt : (x, y) => hot(y) - hot(x));
  $('#takeCount').textContent = `${all.length} take${all.length === 1 ? '' : 's'}`;
  const draft = $('#replyInput')?.value || '';
  $('#takes').innerHTML = roots.length ? roots.map((c) => takeHTML(c, kids(c.id))).join('')
    : `<div class="empty-state" style="padding:24px 10px"><div class="big">🦗</div><p>Crickets. Be the first take, legends start somewhere.</p></div>`;
  const ri = $('#replyInput');
  if (ri) { ri.value = draft; ri.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); postTake(ri.value, gv.replyTo, ri); } }; }
}

async function onTakeClick(e) {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const art = b.closest('.take'); const id = art.dataset.id;
  const act = b.dataset.act;
  if (act === 'reply') { gv.replyTo = gv.replyTo === id ? null : id; paintTakes(); $('#replyInput')?.focus(); return; }
  if (act === 'sendReply') { const ri = $('#replyInput'); return postTake(ri.value, gv.replyTo, ri, b); }
  if (act === 'del') {
    if (!confirm('Delete this take? The internet will forget (it won\'t).')) return;
    try {
      await api(`/comments/${id}`, { method: 'DELETE' });
      gv.social.comments = gv.social.comments.filter((c) => c.id !== id && c.parentId !== id); paintTakes();
    } catch (err) { toast(err.message, true); }
    return;
  }
  if (act === 'fire' || act === 'cap') {
    try {
      const upd = await api(`/comments/${id}/vote`, { method: 'POST', body: { kind: act } });
      gv.social.comments = gv.social.comments.map((c) => (c.id === id ? upd : c));
      paintTakes();
      if (upd.myVote) { const r = b.getBoundingClientRect(); floatEmoji(act === 'fire' ? '🔥' : '🧢', r.left + r.width / 2, r.top); }
    } catch (err) { toast(err.message, true); }
  }
}

async function refreshSocial() {
  if (!gv.data) return;
  const { league, id } = gv.data.game;
  try {
    const s = await api(`/game/${league}/${id}/social`);
    if (gv.key !== `${league}:${id}`) return;
    const before = gv.social.comments.length;
    gv.social.poll = s.poll; gv.social.reactions = s.reactions;
    if (!Object.keys(gv.pendingReacts).length) paintReacts();
    paintPoll();
    // Don't yank the thread out from under someone typing a reply.
    const typing = document.activeElement?.id === 'replyInput';
    if (!typing) { gv.social.comments = s.comments; paintTakes(); }
    if (!typing && s.comments.length > before) toast(`💬 ${s.comments.length - before} new take${s.comments.length - before > 1 ? 's' : ''} just dropped`);
  } catch { /* offline blip */ }
}

// =================================================================
// HALL OF TAKES
// =================================================================
async function renderHall() {
  const app = $('#app');
  app.innerHTML = `<h1 class="hero-title">HALL OF <span class="hl">TAKES</span></h1>
    <p class="hero-sub">The hottest takes, the sharpest prophets, and the clowns who made it all worthwhile.</p>
    <div class="skeleton" style="height:300px"></div>`;
  let d;
  try { d = await api('/hall'); } catch (e) { app.innerHTML += `<p>${esc(e.message)}</p>`; return; }
  const userRow = (u, stat) => `<li><span class="av">${esc(u.avatar || '🙂')}</span><span class="who">${esc(u.name)}</span><span class="stat">${stat}</span></li>`;
  const takeRow = (c) => `<article class="take" style="padding:6px 0;border-bottom:1px solid var(--line)">
      <div class="av">${esc(c.avatar || '🙂')}</div>
      <div class="take-body"><div class="take-meta"><b>${esc(c.name)}</b><span class="heat-tag ${esc(c.heat)}">${esc(c.heat)}</span><span class="t">${ago(c.createdAt)}</span></div>
      <p class="take-text">${esc(c.text)}</p>
      <div class="take-meta"><span>🔥 ${c.fire} · 🧢 ${c.cap}</span><a class="take-link" href="${c.gameKey.startsWith('fl:') ? '#/fantasy' : `#/game/${esc(c.gameKey.replace(':', '/'))}`}">${esc(c.gameLabel)} →</a></div></div></article>`;
  const empty = (msg) => `<p class="muted">${msg}</p>`;
  app.innerHTML = `<h1 class="hero-title">HALL OF <span class="hl">TAKES</span></h1>
    <p class="hero-sub">${d.totals.takes} takes across ${d.totals.games} games. The hottest takes, the sharpest prophets, and the clowns who made it all worthwhile.</p>
    <div class="hall-grid">
      <section class="panel"><h3>🔥 Hottest Takes of All Time <small>by fire minus cap</small></h3>
        ${d.topTakes.length ? d.topTakes.map(takeRow).join('') : empty('No takes yet. Go start some drama in a game thread.')}</section>
      <div>
        <section class="panel"><h3>👑 Take Masters</h3>${d.takeMasters.length ? `<ol class="board">${d.takeMasters.map((u) => userRow(u, `🔥${u.fire} · 🧢${u.cap}`)).join('')}</ol>` : empty('Nobody yet. The throne is empty.')}</section>
        <section class="panel"><h3>🔮 Prophets <small>poll picks that hit</small></h3>${d.prophets.length ? `<ol class="board">${d.prophets.map((u) => userRow(u, `${u.right}-${u.wrong}`)).join('')}</ol>` : empty('Pick winners in game polls. Finished games get scored here.')}</section>
        <section class="panel"><h3>🤡 Clown Corner <small>most capped takes</small></h3>${d.clowns.length ? d.clowns.map(takeRow).join('') : empty('No clowns yet. Give it time.')}</section>
      </div>
    </div>`;
}

// ---------- boot ----------
paintMe();
$('#meChip').onclick = openMeDialog;
window.addEventListener('hashchange', route);
route();
loadTicker();
setInterval(() => { if (!document.hidden) loadTicker(); }, 60000);

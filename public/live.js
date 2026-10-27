/* Live Rooms: the Twitch-style second screen. Loaded before app.js and
   uses its helpers ($, esc, api, me, store, toast...) at call time. */
'use strict';

const lv = {
  es: null, league: null, id: null, game: null, call: null, myPick: null, myPickAt: 0,
  leaders: [], viewers: 0, hype: 0, pending: {}, ownSent: {}, reactTimer: null, tab: 'chat',
  stuckToBottom: true, unseen: 0, lockMs: 45000, lockTimer: null, demo: 0,
};
const LIVE_REACTS = ['🔥', '😂', '😱', '🙌', '💀', '🤡', '🐐', '🧂', '😭', '🚀'];
const EMOTES = ['LETS GOOO', 'W', 'L', 'REFS??', 'Called it', 'Unreal', 'Fraud watch 🚨', 'Ice cold 🧊'];

function leaveLive() {
  if (lv.es) { lv.es.close(); lv.es = null; }
  clearInterval(lv.lockTimer);
  lv.league = lv.id = null;
}

const mutedNames = () => new Set(store.get('ttl:muted', []));

// ---------- lobby ----------
async function renderLiveLobby() {
  const app = $('#app');
  app.innerHTML = `<h1 class="hero-title">🔴 LIVE <span class="hl">ROOMS</span></h1>
    <p class="hero-sub">Keep the game on your TV. This is the couch: live chat, reaction bursts, and calls with bragging rights.</p>
    <div id="lobby"><div class="grid">${'<div class="skeleton"></div>'.repeat(3)}</div></div>`;
  const paint = async () => {
    let games;
    try { ({ games } = await api(`/scoreboard?league=all&date=${ymd(new Date())}`)); }
    catch (e) { $('#lobby').innerHTML = `<div class="empty-state"><div class="big">📡</div><p>${esc(e.message)}</p></div>`; return; }
    const live = games.filter((g) => g.status.state === 'in').sort((x, y) => (y.viewers || 0) - (x.viewers || 0) || y.vibe.chaos - x.vibe.chaos);
    const soon = games.filter((g) => g.status.state === 'pre' && new Date(g.date) - Date.now() < 4 * 3600e3).sort((x, y) => new Date(x.date) - new Date(y.date));
    $('#lobby').innerHTML = (live.length
      ? `<h2 class="league-head">🔴 On now <small>${live.length} room${live.length > 1 ? 's' : ''}</small></h2><div class="grid">${live.map(cardHTML).join('')}</div>`
      : `<div class="empty-state"><div class="big">😴</div><p>Nothing live right now. The athletes are napping. So should you.</p></div>`)
      + (soon.length ? `<h2 class="league-head">⏳ Starting soon <small>rooms open at kickoff</small></h2><div class="grid">${soon.map(cardHTML).join('')}</div>` : '');
  };
  await paint();
  every(paint, 30000);
}

// ---------- room ----------
function renderLive(league, id) {
  leaveLive();
  Object.assign(lv, { league, id, game: null, call: null, myPick: null, leaders: [], pending: {}, ownSent: {}, tab: 'chat', stuckToBottom: true, unseen: 0 });
  const app = $('#app');
  app.innerHTML = `
    <div class="live-top"><a class="back" href="#/live">← All live rooms</a>
      <span class="live-top-r"><button type="button" class="btn ghost demo-btn" id="demoBtn" title="Fill the room with clearly-labelled simulated fans, for demos">🧪 Simulate a crowd</button>
      <a class="back" href="#/game/${esc(league)}/${esc(id)}">Game page &amp; thread →</a></span></div>
    <div class="live-wrap">
      <section class="stage-col">
        <div class="stage" id="stage"><div class="stage-loading">Finding our seats…</div></div>
        <div class="stage-bar">
          <div class="hype" title="Hype meter: how hard the room is reacting"><span>HYPE</span><div class="hype-bar"><i id="hypeFill"></i></div></div>
          <div class="live-reacts" id="liveReacts">${LIVE_REACTS.map((e) => `<button type="button" data-e="${e}" aria-label="React ${e}">${e}</button>`).join('')}</div>
        </div>
        <div class="stage-panels">
          <section class="panel" id="callPanel"><h3>🔮 The Call <small>bragging rights only</small></h3><div id="call"></div></section>
          <section class="panel" id="fzPanel" hidden><h3>🧑‍🌾 Your Fantasy Guys</h3><div id="fzLive"></div></section>
        </div>
      </section>
      <aside class="chat-col">
        <div class="chat-head">
          <div class="chips" role="tablist">
            <button class="chip" role="tab" data-tab="chat" aria-pressed="true">💬 Chat</button>
            <button class="chip" role="tab" data-tab="callers" aria-pressed="false">👑 Callers</button>
          </div>
          <span class="viewers" id="viewers">👀 –</span>
        </div>
        <div class="chat-log" id="chatLog" aria-live="polite"></div>
        <div class="callers" id="callers" hidden></div>
        <button type="button" class="new-msgs" id="newMsgs" hidden>New messages ↓</button>
        <div class="chat-emotes">${EMOTES.map((t) => `<button type="button" class="chip" data-emote="${esc(t)}">${esc(t)}</button>`).join('')}</div>
        <form class="chat-form" id="chatForm" autocomplete="off">
          <span class="chat-me" title="You">${esc(me.avatar)}</span>
          <input id="chatInput" maxlength="200" placeholder="Say something (be funny)…" aria-label="Chat message">
          <button class="btn primary" type="submit">Send</button>
        </form>
        <div class="chat-hint">Slow mode: 1.5s · Tap a name to mute them · No video here: TV rights. Keep the game on your TV.</div>
      </aside>
    </div>`;
  wireLive();
  connectLive();
  paintFantasyLive();
}

function connectLive() {
  const { league, id } = lv;
  const es = new EventSource(`/api/live/${league}/${id}/stream?fan=${encodeURIComponent(me.uid)}`);
  lv.es = es;
  es.onmessage = (m) => {
    if (lv.es !== es) return;
    let ev; try { ev = JSON.parse(m.data); } catch { return; }
    onLiveEvent(ev);
  };
  es.onerror = () => { if (lv.es === es) $('#viewers') && ($('#viewers').textContent = '📡 reconnecting…'); };
}

function onLiveEvent(ev) {
  switch (ev.type) {
    case 'hello':
      lv.game = ev.game; lv.call = ev.call; lv.leaders = ev.leaders; lv.viewers = ev.viewers; lv.demo = ev.demo || 0;
      if (ev.call?.mine) lv.myPick = ev.call.mine;
      $('#chatLog').innerHTML = '';
      if (!ev.messages.length) systemNote('Welcome to the room. Be the first to say something unhinged.');
      ev.messages.forEach((msg) => appendMsg(msg, false));
      scrollChat(true);
      paintStage(); paintCall(); paintCallers(); paintViewers();
      break;
    case 'chat': appendMsg(ev.msg, true); break;
    case 'game': lv.game = ev.game; paintStage(); paintCall(); break;
    case 'viewers': lv.viewers = ev.viewers; lv.demo = ev.demo || 0; paintViewers(); paintStageDemo(); break;
    case 'burst': onBurst(ev); break;
    case 'call':
      if (!ev.call || ev.call.id !== lv.call?.id) { lv.myPick = null; lv.myPickAt = 0; }
      lv.call = ev.call; paintCall();
      break;
    case 'leaders': lv.leaders = ev.leaders; paintCallers(); break;
    case 'score': scoreFlash(ev); break;
  }
}

// ---------- stage ----------
function paintStage() {
  const g = lv.game, el = $('#stage');
  if (!el) return;
  if (!g) { el.innerHTML = '<div class="stage-loading">The scoreboard is buffering. Unlike your excuses.</div>'; return; }
  const { a, h } = sideColors(g);
  el.style.setProperty('--away-c', a); el.style.setProperty('--home-c', h);
  const st = g.status.state;
  const wp = g.winProb?.length ? g.winProb[g.winProb.length - 1] : null;
  const wpTxt = wp == null ? '' : wp >= 50 ? `${esc(g.home.abbr)} ${Math.round(wp)}% to win` : `${esc(g.away.abbr)} ${Math.round(100 - wp)}% to win`;
  const team = (t) => `<div class="st-team">${logo(t)}<div class="st-name nm-full">${esc(t?.name)}</div><div class="st-name nm-abbr">${esc(t?.abbr)}</div><div class="st-rec">${esc(t?.record || '')}</div></div>`;
  el.innerHTML = `
    <div class="stage-top">
      ${st === 'in' ? '<span class="live-pill"><span class="dot"></span>LIVE</span>' : st === 'post' ? '<span class="live-pill off">FINAL</span>' : '<span class="live-pill off">SOON</span>'}
      <span>${g.emoji} ${esc(g.leagueLabel)}</span>
      ${g.broadcast ? `<span class="tv">📺 Watch on ${esc(g.broadcast)}</span>` : ''}
    </div>
    <div class="stage-score">
      ${team(g.away)}
      <div class="st-mid">
        <div class="st-nums"><span data-side="away">${st === 'pre' ? '' : esc(g.away?.score ?? 0)}</span><i>${st === 'pre' ? 'VS' : '–'}</i><span data-side="home">${st === 'pre' ? '' : esc(g.home?.score ?? 0)}</span></div>
        <div class="st-clock">${esc(st === 'pre' ? new Date(lv.game.date || Date.now()).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : g.status.detail)}</div>
        ${g.situation && st === 'in' ? `<div class="st-sit">${esc(g.situation)}</div>` : ''}
        ${wpTxt ? `<div class="st-wp">${wpTxt}</div>` : ''}
      </div>
      ${team(g.home)}
    </div>
    ${g.lastPlay ? `<div class="lower-third"><b>LAST PLAY</b><span>${esc(g.lastPlay)}</span></div>` : ''}
    <div class="burst-layer" id="burst"></div>
    <div class="score-flash" id="flash"></div>`;
  paintStageDemo();
}

function scoreFlash(ev) {
  const g = lv.game; if (!g) return;
  for (const side of ['home', 'away']) {
    const d = ev[side]; if (!(d > 0)) continue;
    const num = $(`.st-nums [data-side="${side}"]`); num && (num.classList.remove('bump'), void num.offsetWidth, num.classList.add('bump'));
    if (g.sport === 'basketball') continue; // buckets are too frequent to celebrate each
    const word = g.sport === 'football' ? (d >= 6 ? 'TOUCHDOWN' : d === 3 ? 'FIELD GOAL' : d === 2 ? 'SAFETY!' : null)
      : g.sport === 'baseball' ? (d > 1 ? `${d} RUNS!` : 'RUN SCORES') : 'GOAL!';
    if (!word) continue;
    const f = $('#flash');
    if (f) { f.textContent = `${word} ${g[side].abbr}`; f.style.setProperty('--c', sideColors(g)[side === 'home' ? 'h' : 'a']); f.classList.remove('go'); void f.offsetWidth; f.classList.add('go'); }
    if (d >= 6 || g.sport !== 'football') confetti(160, [sideColors(g)[side === 'home' ? 'h' : 'a'], '#ffffff', '#ffd23f']);
  }
}

// ---------- reactions ----------
function stageFloat(emoji) {
  const layer = $('#burst'); if (!layer || reduceMotion) return;
  const el = document.createElement('span');
  el.className = 'bfloat'; el.textContent = emoji;
  el.style.left = `${8 + Math.random() * 84}%`;
  el.style.setProperty('--dx', `${(Math.random() - 0.5) * 120}px`);
  el.style.animationDuration = `${1.6 + Math.random() * 1.2}s`;
  layer.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}
function onBurst(ev) {
  for (const [e, n] of Object.entries(ev.counts || {})) {
    const others = Math.max(0, n - (lv.ownSent[e] || 0));
    for (let i = 0; i < Math.min(others, 25); i++) setTimeout(() => stageFloat(e), i * 60);
  }
  if (Object.keys(ev.counts || {}).length) lv.ownSent = {};
  lv.hype = ev.hype ?? lv.hype;
  const fill = $('#hypeFill');
  if (fill) { fill.style.width = `${lv.hype}%`; fill.parentElement.parentElement.classList.toggle('maxed', lv.hype >= 80); }
}
async function flushLiveReacts() {
  const pending = lv.pending; lv.pending = {};
  for (const [emoji, n] of Object.entries(pending)) {
    lv.ownSent[emoji] = (lv.ownSent[emoji] || 0) + n;
    api(`/live/${lv.league}/${lv.id}/react`, { method: 'POST', body: { emoji, n } }).catch((e) => toast(e.message, true));
  }
}

// ---------- calls ----------
function paintCall() {
  const el = $('#call'); if (!el) return;
  const g = lv.game, c = lv.call;
  if (!g || g.status.state !== 'in' || !c) {
    el.innerHTML = `<p class="muted">${g?.status.state === 'post' ? 'Game over. Calls are closed. Check the Callers tab for who was right.' : 'Calls open at kickoff. Who scores next, who leads after the quarter. Points for being right, extra for being right when nobody else was.'}</p>`;
    return;
  }
  const tot = c.home + c.away;
  const pct = (n) => (tot ? Math.round((n / tot) * 100) : 0);
  const btn = (side) => {
    const t = g[side];
    return `<button type="button" class="poll-btn ${lv.myPick === side ? 'mine' : ''}" data-call="${side}" aria-pressed="${lv.myPick === side}">
      ${logo(t)}<span>${esc(t.name)}</span><small>${pct(c[side])}% · ${c[side]} pick${c[side] === 1 ? '' : 's'}</small></button>`;
  };
  const left = lv.myPick ? Math.max(0, Math.ceil((lv.lockMs - (Date.now() - lv.myPickAt)) / 1000)) : 0;
  el.innerHTML = `<div class="call-q">${esc(c.question)}</div>
    <div class="poll-btns">${btn('away')}${btn('home')}</div>
    <div class="poll-note">${lv.myPick
      ? (left > 0 ? `⏳ Your call counts in <b id="lockLeft">${left}s</b>. No sniping, we see you.` : '✅ Your call is locked in. Now sweat.')
      : 'Pick before it happens. Calls need to be in 45s early to count.'}</div>`;
}

function paintCallers() {
  const el = $('#callers'); if (!el) return;
  el.innerHTML = lv.leaders.length
    ? `<ol class="board">${lv.leaders.map((u) => `<li><span class="av">${esc(u.avatar || '🙂')}</span><span class="who" style="color:${esc(u.color)}">${u.sim ? '<span class="sim-tag">SIM</span> ' : ''}${esc(u.name)}${!u.sim && u.name === me.name ? ' (you)' : ''}</span><span class="stat">${u.pts} pts${u.streak > 1 ? ` · 🔥${u.streak}` : ''}</span></li>`).join('')}</ol>`
    : '<p class="muted" style="padding:12px">No callers yet. Make a call on the left and get on the board.</p>';
}
function paintViewers() {
  const v = $('#viewers'); if (v) v.textContent = `👀 ${lv.viewers} watching${lv.demo ? ` · 🧪 ${lv.demo} sim` : ''}`;
  const b = $('#demoBtn');
  if (b) { b.textContent = lv.demo ? '🧪 Demo crowd on · turn off' : '🧪 Simulate a crowd'; b.classList.toggle('on', !!lv.demo); }
}
function paintStageDemo() {
  const top = $('.stage-top'); if (!top) return;
  let pill = $('.demo-pill', top);
  if (lv.demo && !pill) top.insertAdjacentHTML('beforeend', '<span class="demo-pill" title="Simulated fans are in this room">🧪 DEMO CROWD</span>');
  if (!lv.demo && pill) pill.remove();
}

// ---------- chat ----------
function systemNote(text) { appendMsg({ id: `sys-${Date.now()}`, kind: 'system', name: '', text, t: Date.now() }, false); }

function appendMsg(msg, live) {
  const log = $('#chatLog'); if (!log) return;
  if (msg.kind === 'user' && mutedNames().has(msg.name)) return;
  const el = document.createElement('div');
  el.className = `msg ${msg.kind}`;
  const mention = msg.kind === 'user' && me.name.length > 2 && msg.text.toLowerCase().includes(`@${me.name.toLowerCase()}`);
  if (mention) el.classList.add('mention');
  if (msg.kind === 'user') {
    el.innerHTML = `<span class="m-av">${esc(msg.avatar || '🙂')}</span>${msg.sim ? '<span class="sim-tag" title="Simulated fan (demo crowd)">SIM</span>' : ''}<button type="button" class="m-name" style="color:${esc(msg.color)}" data-name="${esc(msg.name)}">${esc(msg.name)}</button><span class="m-text">${esc(msg.text)}</span>`;
  } else if (msg.kind === 'system' && !msg.name) {
    el.innerHTML = `<span class="m-text">${esc(msg.text)}</span>`;
  } else {
    el.innerHTML = `<span class="m-av">${esc(msg.avatar)}</span><b class="m-name bot">${esc(msg.name)}</b><span class="m-text">${esc(msg.text)}</span>`;
  }
  log.appendChild(el);
  while (log.children.length > 200) log.firstChild.remove();
  if (!live) return;
  if (lv.stuckToBottom) scrollChat(); else { lv.unseen++; const n = $('#newMsgs'); n.hidden = false; n.textContent = `${lv.unseen} new message${lv.unseen > 1 ? 's' : ''} ↓`; }
}
function scrollChat(force) {
  const log = $('#chatLog'); if (!log) return;
  if (force || lv.stuckToBottom) log.scrollTop = log.scrollHeight;
  lv.unseen = 0; const n = $('#newMsgs'); if (n) n.hidden = true;
}

async function sendChat(text) {
  text = text.trim();
  if (!text) return;
  try {
    await api(`/live/${lv.league}/${lv.id}/chat`, { method: 'POST', body: { text } });
    lv.stuckToBottom = true;
    return true;
  } catch (e) { toast(e.message, true); return false; }
}

function wireLive() {
  $('#demoBtn').onclick = async () => {
    try {
      const r = await api(`/live/${lv.league}/${lv.id}/demo`, { method: 'POST', body: { on: !lv.demo } });
      lv.demo = r.demo; paintViewers(); paintStageDemo();
      if (lv.demo) toast('🧪 Demo crowd on. Every simulated fan is tagged SIM.');
    } catch (e) { toast(e.message, true); }
  };
  const log = $('#chatLog');
  log.onscroll = () => {
    lv.stuckToBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    if (lv.stuckToBottom) scrollChat();
  };
  $('#newMsgs').onclick = () => { lv.stuckToBottom = true; scrollChat(true); };
  $('#chatForm').onsubmit = async (e) => {
    e.preventDefault();
    const inp = $('#chatInput');
    if (await sendChat(inp.value)) inp.value = '';
  };
  $('.chat-emotes').onclick = (e) => { const b = e.target.closest('[data-emote]'); if (b) sendChat(b.dataset.emote); };
  log.onclick = (e) => {
    const b = e.target.closest('.m-name[data-name]'); if (!b) return;
    const name = b.dataset.name;
    if (name === me.name) return toast("You can't mute yourself. We tried.");
    if (!confirm(`Mute ${name}? You won't see their messages in any room.`)) return;
    const m = mutedNames(); m.add(name); store.set('ttl:muted', [...m]);
    $$('.msg .m-name[data-name]', log).forEach((x) => { if (x.dataset.name === name) x.closest('.msg').remove(); });
    toast(`Muted ${name}. Peace restored.`);
  };
  $('.chat-head .chips').onclick = (e) => {
    const b = e.target.closest('[data-tab]'); if (!b) return;
    lv.tab = b.dataset.tab;
    $$('[data-tab]').forEach((x) => x.setAttribute('aria-pressed', x === b));
    $('#chatLog').hidden = lv.tab !== 'chat'; $('#callers').hidden = lv.tab !== 'callers';
    $('.chat-emotes').hidden = $('#chatForm').hidden = lv.tab !== 'chat';
  };
  $('#liveReacts').onclick = (e) => {
    const b = e.target.closest('[data-e]'); if (!b) return;
    const emoji = b.dataset.e;
    lv.pending[emoji] = (lv.pending[emoji] || 0) + 1;
    stageFloat(emoji);
    b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop');
    clearTimeout(lv.reactTimer); lv.reactTimer = setTimeout(flushLiveReacts, 400);
  };
  $('#call').onclick = async (e) => {
    const b = e.target.closest('[data-call]'); if (!b || !lv.call) return;
    const side = b.dataset.call;
    if (side === lv.myPick) return;
    try {
      const r = await api(`/live/${lv.league}/${lv.id}/call`, { method: 'POST', body: { side, callId: lv.call.id } });
      lv.myPick = side; lv.myPickAt = Date.now(); lv.lockMs = r.lockMs || 45000;
      lv.call = { ...lv.call, home: r.home, away: r.away };
      paintCall();
      toast(rand(['Call locked. Bold.', 'Noted. We will be screenshotting this.', 'Prophet or clown? We find out soon.']));
    } catch (err) { toast(err.message, true); }
  };
  clearInterval(lv.lockTimer);
  lv.lockTimer = setInterval(() => { if (lv.myPick && Date.now() - lv.myPickAt < lv.lockMs + 1500) paintCall(); }, 1000);
}

// Your fantasy starters who are playing in this game.
function paintFantasyLive() {
  if (lv.league !== 'nfl') return;
  loadFantasyMap().then(() => {
    const g = lv.game;
    const fill = () => {
      const gg = lv.game; if (!gg || !fz.map) return false;
      const mine = [...(fz.map[gg.away?.abbr] || []).map((p) => ({ ...p, team: gg.away.abbr })), ...(fz.map[gg.home?.abbr] || []).map((p) => ({ ...p, team: gg.home.abbr }))];
      if (!mine.length) return true;
      $('#fzPanel').hidden = false;
      $('#fzLive').innerHTML = `<ul class="fz-list">${mine.map((p) => `<li><span class="pos pos-${esc(p.pos)}">${esc(p.pos)}</span><span>${esc(p.name)} <small class="muted">${esc(p.team)}</small></span><b>${Number(p.points || 0).toFixed(1)}</b></li>`).join('')}</ul>
        <p class="muted" style="margin:8px 0 0;font-size:13px">${esc(rand(['Root accordingly. Loyalty is dead in fantasy.', 'Cheering for a guy on the other team? We don\'t judge.', 'Every yard is a personal victory.']))}</p>`;
      return true;
    };
    if (!g && !fill()) { const t = setInterval(() => { if (fill() || !lv.league) clearInterval(t); }, 1000); }
    else fill();
  });
}

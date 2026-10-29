/* Live Rooms: the Twitch-style second screen. Loaded before app.js and
   uses its helpers ($, esc, api, me, store, toast...) at call time. */
'use strict';

const lv = {
  es: null, league: null, id: null, game: null, call: null, myPick: null, myPickAt: 0,
  leaders: [], viewers: 0, hype: 0, pending: {}, ownSent: {}, reactTimer: null, tab: 'chat',
  stuckToBottom: true, unseen: 0, lockMs: 45000, lockTimer: null, demo: 0,
  tug: { home: 0, away: 0 }, tugPending: { home: 0, away: 0 }, tugTimer: null, mpoll: null, myVote: null, follow: true, tick: null,
};
const START_LABEL = { football: 'KICKOFF', basketball: 'TIP-OFF', baseball: 'FIRST PITCH', hockey: 'PUCK DROP', soccer: 'KICKOFF' };
const KIND_BADGE = { score: 'SCORE', three: '3PT', turnover: 'TURNOVER', penalty: 'FLAG', k: 'K', homer: 'HR', goal: 'GOAL', sog: 'SHOT', miss: 'MISS', block: 'BLOCK', foul: 'FOUL', card: 'CARD', stop: 'TIMEOUT' };
const LIVE_REACTS = ['🔥', '😂', '😱', '🙌', '💀', '🤡', '🐐', '🧂', '😭', '🚀'];
const EMOTES = ['LETS GOOO', 'W', 'L', 'REFS??', 'Called it', 'Unreal', 'Fraud watch 🚨', 'Ice cold 🧊'];

function leaveLive() {
  if (lv.es) { lv.es.close(); lv.es = null; }
  clearInterval(lv.lockTimer); clearInterval(lv.tick);
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
  Object.assign(lv, { league, id, game: null, call: null, myPick: null, leaders: [], pending: {}, ownSent: {}, tab: 'chat', stuckToBottom: true, unseen: 0,
    tug: { home: 0, away: 0 }, tugPending: { home: 0, away: 0 }, mpoll: null, myVote: null, follow: true });
  FIELD.sel = null;
  const app = $('#app');
  app.innerHTML = `
    <div class="live-top"><a class="back" href="#/live">← All live rooms</a>
      <span class="live-top-r"><button type="button" class="btn ghost demo-btn" id="demoBtn" title="Fill the room with clearly-labelled simulated fans, for demos">🧪 Simulate a crowd</button>
      <a class="back" href="#/game/${esc(league)}/${esc(id)}">Game page &amp; thread →</a></span></div>
    <div class="live-wrap">
      <section class="stage-col">
        <div class="stage" id="stage"><div class="stage-loading">Finding our seats…</div></div>
        <section class="tug" id="tug" aria-label="Hype battle"></section>
        <div class="stage-bar">
          <div class="live-reacts" id="liveReacts">${LIVE_REACTS.map((e) => `<button type="button" data-e="${e}" aria-label="React ${e}">${e}</button>`).join('')}</div>
        </div>
        <section class="panel mpoll-panel" id="mpollPanel" hidden></section>
        <div class="stage-panels">
          <section class="panel pbp-panel" id="pbpPanel"><h3>📋 Play-by-Play <small><label class="follow"><input type="checkbox" id="followTog" checked> Follow live</label></small></h3><ol class="pbp" id="pbp"></ol></section>
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
      lv.tug = ev.tug || { home: 0, away: 0 }; lv.mpoll = ev.mpoll || null; lv.myVote = ev.mpoll?.mine || null;
      paintStage(); paintCall(); paintCallers(); paintViewers(); paintTug(); paintMpoll(); paintPlays();
      break;
    case 'chat': appendMsg(ev.msg, true); break;
    case 'game': lv.game = ev.game; paintStage(); paintCall(); paintPlays(); paintTug(); break;
    case 'tug': lv.tug = { home: ev.home + lv.tugPending.home, away: ev.away + lv.tugPending.away }; paintTug(); break;
    case 'mpoll': if (ev.poll?.id !== lv.mpoll?.id) lv.myVote = null; lv.mpoll = ev.poll; paintMpoll(); break;
    case 'moment': showMoment(ev); break;
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
// The shell is built once per room so the field SVG survives updates and can animate.
function paintStage() {
  const g = lv.game, el = $('#stage');
  if (!el) return;
  if (!g) { el.innerHTML = '<div class="stage-loading">The scoreboard is buffering. Unlike your excuses.</div>'; return; }
  if (!$('#stTop', el)) {
    el.innerHTML = `<div class="stage-top" id="stTop"></div><div class="st-row" id="stScore"></div>
      <div class="field-host" id="fieldHost"></div><div class="pre-over" id="preOver" hidden></div>
      <div class="lower-third" id="stLower" hidden></div>
      <div class="burst-layer" id="burst"></div><div class="score-flash" id="flash"></div><div class="moment-fx" id="momentFx"></div>`;
  }
  const { a, h } = sideColors(g);
  el.style.setProperty('--away-c', a); el.style.setProperty('--home-c', h);
  const st = g.status.state;
  el.dataset.sport = g.sport;
  $('#stTop', el).innerHTML = `
    ${st === 'in' ? '<span class="live-pill"><span class="dot"></span>LIVE</span>' : st === 'post' ? '<span class="live-pill off">FINAL</span>' : '<span class="live-pill off">SOON</span>'}
    <span>${g.emoji} ${esc(g.leagueLabel)}</span>
    ${g.broadcast ? `<span class="tv">📺 Watch on ${esc(g.broadcast)}</span>` : ''}`;
  paintStageDemo();
  const wp = g.winProb?.length ? g.winProb[g.winProb.length - 1] : null;
  const wpTxt = wp == null || st !== 'in' ? '' : wp >= 50 ? `${esc(g.home.abbr)} ${Math.round(wp)}% to win` : `${esc(g.away.abbr)} ${Math.round(100 - wp)}% to win`;
  const poss = g.detail?.kind === 'football' && st === 'in' ? g.detail.possession : null;
  const side = (t, s) => `<div class="st-t ${s}">${logo(t)}<div class="st-nm"><b class="nm-full">${esc(t?.name)}</b><b class="nm-abbr">${esc(t?.abbr)}</b><small>${esc(t?.record || '')}${poss === s ? ' <span class="poss" title="Has the ball">🏈</span>' : ''}</small></div>
    <span class="st-num" data-side="${s}">${st === 'pre' ? '' : esc(t?.score ?? 0)}</span></div>`;
  $('#stScore', el).innerHTML = `${side(g.away, 'away')}
    <div class="st-mid"><div class="st-clock">${esc(st === 'pre' ? new Date(g.date || Date.now()).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : g.status.detail)}</div>${wpTxt ? `<div class="st-wp">${wpTxt}</div>` : ''}</div>
    ${side(g.home, 'home')}`;
  paintField($('#fieldHost', el), g);
  const last = g.detail?.plays?.[0]?.text || g.lastPlay;
  const lower = $('#stLower', el);
  lower.hidden = !last;
  if (last) lower.innerHTML = `<b>${st === 'post' ? 'FINAL PLAY' : 'LAST PLAY'}</b><span>${esc(last)}</span>`;
  // Pre-game countdown over the field.
  const pre = $('#preOver', el);
  pre.hidden = st !== 'pre';
  if (st === 'pre') {
    const tickFn = () => {
      const ms = new Date(g.date) - Date.now();
      const t = ms <= 0 ? 'any second now' : `${Math.floor(ms / 3600e3)}:${String(Math.floor(ms / 60e3) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1e3) % 60).padStart(2, '0')}`;
      pre.innerHTML = `<div class="pre-k">${START_LABEL[g.sport] || 'START'} IN</div><div class="pre-t">${esc(t)}</div><div class="pre-s">The room fills up at ${START_LABEL[g.sport]?.toLowerCase() || 'start'}. Get your calls ready.</div>`;
    };
    tickFn(); clearInterval(lv.tick); lv.tick = setInterval(tickFn, 1000);
  } else clearInterval(lv.tick);
}

// ---------- moments: sport-specific big-screen overlays ----------
const MOMENT_ICON = { start: { football: '🏈', basketball: '🏀', baseball: '⚾', hockey: '🏒', soccer: '⚽' }, redzone: '🚨', turnover: '🔄', twomin: '⏱️',
  three: '🎯', half: '⏸️', clutch: '🧊', homer: '💣', k: 'K', full: '⚾', loaded: '🔥', pp: '⚠️', yellow: '🟨', red: '🟥', pen: '🎯' };
function showMoment(ev) {
  const g = lv.game, fx = $('#momentFx'); if (!fx || !g) return;
  const ic = ev.kind === 'start' ? MOMENT_ICON.start[g.sport] : MOMENT_ICON[ev.kind] || '✨';
  fx.style.setProperty('--c', ev.side ? sideColors(g)[ev.side === 'home' ? 'h' : 'a'] : '#ffd23f');
  fx.className = `moment-fx k-${ev.kind}`;
  fx.innerHTML = `<div class="mf-ic">${esc(ic)}</div><div class="mf-t">${esc(ev.title)}</div>${ev.sub ? `<div class="mf-s">${esc(ev.sub)}</div>` : ''}`;
  void fx.offsetWidth; fx.classList.add('go');
  if (['homer', 'turnover', 'start', 'loaded', 'red'].includes(ev.kind)) confetti(120, [fx.style.getPropertyValue('--c') || '#ffd23f', '#ffffff', '#ffd23f']);
}

// ---------- hype tug-of-war ----------
function paintTug() {
  const el = $('#tug'), g = lv.game; if (!el || !g) return;
  const { home, away } = lv.tug;
  const homeShare = (home + 1.5) / (home + away + 3);
  const knob = Math.round(homeShare * 1000) / 10;
  const lead = knob > 56 ? 'home' : knob < 44 ? 'away' : null;
  const { a, h } = sideColors(g);
  if (!$('.tug-track', el)) {
    el.innerHTML = `<div class="tug-head"><b>📣 HYPE BATTLE</b><span>Who's got the juice? Tap your team. The meter goes to the loudest fans.</span></div>
      <div class="tug-row">
        <button type="button" class="tug-btn" data-hype="away" style="--c:${a}">${logo(g.away)}<span>HYPE<b>${esc(g.away?.abbr)}</b></span></button>
        <div class="tug-track"><i class="tug-fill"></i><span class="tug-mid"></span><span class="tug-knob">🔥</span></div>
        <button type="button" class="tug-btn" data-hype="home" style="--c:${h}"><span>HYPE<b>${esc(g.home?.abbr)}</b></span>${logo(g.home)}</button>
      </div><div class="tug-label" id="tugLabel"></div>`;
    el.onclick = (e) => {
      const b = e.target.closest('[data-hype]'); if (!b) return;
      const sd = b.dataset.hype;
      lv.tug[sd] += 1; lv.tugPending[sd] += 1; paintTug();
      b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop');
      stageFloat(sd === 'home' ? '📣' : '📣');
      clearTimeout(lv.tugTimer);
      lv.tugTimer = setTimeout(() => {
        for (const s2 of ['home', 'away']) {
          const n = lv.tugPending[s2]; if (!n) continue;
          lv.tugPending[s2] = 0;
          api(`/live/${lv.league}/${lv.id}/hype`, { method: 'POST', body: { side: s2, n } }).catch((err) => toast(err.message, true));
        }
      }, 350);
    };
  }
  const fill = $('.tug-fill', el), kn = $('.tug-knob', el);
  kn.style.left = `${knob}%`;
  if (knob >= 50) { fill.style.left = '50%'; fill.style.width = `${knob - 50}%`; fill.style.background = h; }
  else { fill.style.left = `${knob}%`; fill.style.width = `${50 - knob}%`; fill.style.background = a; }
  const loud = home + away;
  kn.textContent = loud > 60 ? '🔥' : loud > 15 ? '📣' : '🎙️';
  el.classList.toggle('hot', loud > 60);
  $('#tugLabel').innerHTML = lead
    ? `<i class="tdot" style="background:${lead === 'home' ? h : a}"></i><b>${esc(g[lead]?.name)}</b> fans are LOUDER · ${Math.round(lead === 'home' ? knob : 100 - knob)}% of the noise`
    : loud > 3 ? 'Dead even. Somebody make some noise.' : 'Quiet in here. Be the first to hype your team.';
}

// ---------- moment polls ----------
function paintMpoll() {
  const el = $('#mpollPanel'); if (!el) return;
  const p = lv.mpoll;
  el.hidden = !p;
  if (!p) return;
  const tot = Object.values(p.counts).reduce((x, y) => x + y, 0);
  el.innerHTML = `<div class="mp-head"><span class="mp-live"><span class="dot"></span>RIGHT NOW</span><b>${esc(p.q)}</b></div>
    <div class="mp-opts">${p.options.map((o) => {
      const pc = tot ? Math.round(((p.counts[o.key] || 0) / tot) * 100) : 0;
      return `<button type="button" class="mp-opt ${lv.myVote === o.key ? 'mine' : ''}" data-opt="${esc(o.key)}"><i style="width:${lv.myVote ? pc : 0}%"></i><span>${esc(o.label)}</span>${lv.myVote ? `<b>${pc}%</b>` : ''}</button>`;
    }).join('')}</div>
    <div class="mp-note">${lv.myVote ? `${tot} vote${tot === 1 ? '' : 's'} · results update live` : 'Quick! Vote before the play happens.'}</div>`;
  el.onclick = async (e) => {
    const b = e.target.closest('[data-opt]'); if (!b || !lv.mpoll) return;
    try {
      const r = await api(`/live/${lv.league}/${lv.id}/mpoll`, { method: 'POST', body: { pollId: lv.mpoll.id, option: b.dataset.opt } });
      lv.myVote = r.mine; lv.mpoll = { ...lv.mpoll, counts: r.counts }; paintMpoll();
    } catch (err) { toast(err.message, true); }
  };
}

// ---------- play-by-play ----------
function paintPlays() {
  const el = $('#pbp'), g = lv.game; if (!el || !g) return;
  const plays = g.detail?.plays || [];
  if (lv.follow && plays[0] && g.status.state === 'in' && FIELD.sel !== plays[0].id) highlightPlay($('#fieldHost'), g, plays[0]);
  if (!plays.length) { el.innerHTML = `<li class="muted pbp-empty">${g.status.state === 'pre' ? `Plays show up here from ${START_LABEL[g.sport]?.toLowerCase() || 'the start'}.` : 'Waiting on the play feed…'}</li>`; return; }
  const per = (p) => (!p.period || g.sport === 'baseball' || g.sport === 'soccer' ? '' : `${g.sport === 'hockey' ? 'P' : 'Q'}${p.period}`);
  el.innerHTML = plays.map((p) => {
    const c = p.side ? sideColors(g)[p.side === 'home' ? 'h' : 'a'] : 'var(--line)';
    const badge = KIND_BADGE[p.kind];
    const canShow = (p.fromX != null) || p.shot;
    return `<li class="pbp-i k-${esc(p.kind)} ${FIELD.sel === p.id ? 'sel' : ''} ${canShow ? 'can' : ''}" data-id="${esc(p.id)}" style="--c:${c}">
      <span class="pbp-when">${esc(per(p))} ${esc(p.clock)}</span>
      <span class="pbp-txt">${p.side ? `<b>${esc(g[p.side]?.abbr)}</b> ` : ''}${esc(p.text)}${p.down ? ` <small class="muted">(${esc(p.down)})</small>` : ''}</span>
      ${badge ? `<span class="pbp-b">${badge}</span>` : canShow ? '<span class="pbp-see">👁</span>' : ''}</li>`;
  }).join('');
}

function wirePlays() {
  $('#followTog').onchange = (e) => { lv.follow = e.target.checked; if (lv.follow) { FIELD.sel = null; paintPlays(); } };
  $('#pbp').onclick = (e) => {
    const li = e.target.closest('.pbp-i'); if (!li || !lv.game) return;
    const play = lv.game.detail?.plays?.find((p) => p.id === li.dataset.id); if (!play) return;
    lv.follow = false; $('#followTog').checked = false;
    highlightPlay($('#fieldHost'), lv.game, play);
    paintPlays();
    $('#stage').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };
}

function scoreFlash(ev) {
  const g = lv.game; if (!g) return;
  for (const side of ['home', 'away']) {
    const d = ev[side]; if (!(d > 0)) continue;
    const num = $(`.st-num[data-side="${side}"]`); num && (num.classList.remove('bump'), void num.offsetWidth, num.classList.add('bump'));
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
  wirePlays();
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

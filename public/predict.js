/* Prediction Leagues: create or join leagues, pick game winners, climb the standings.
   Loaded before app.js; uses its helpers (api, esc, toast, logo, every, store) at call time.
   The server enforces every rule (deadlines, permissions, hidden picks); this file only shows them. */
'use strict';

const pl = { cfg: null, slate: null, filter: 'all', sport: 'all', lid: null, probRetry: 0 };

// ---------- formatting ----------
const plTz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return 'your time zone'; } })();
const plDay = (t) => new Date(t).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
const plWhen = (t) => new Date(t).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
function plUntil(t) {
  const s = Math.round((t - Date.now()) / 1000);
  if (s <= 0) return null;
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${Math.max(1, m)}m`;
}
const plRange = (w) => `${plDay(w.start)} – ${plDay(w.end - 1)}`;
const plRank = (r, tied) => (r == null ? '–' : `${tied ? 'T-' : '#'}${r}`);
const plAcc = (a) => (a == null ? '–' : `${a}%`);
const plSports = (l) => l.sports.map((s) => `${s.emoji} ${esc(s.label)}`).join(' · ');
const pluralize = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

const PL_STATUS = { active: ['Active', 'live'], upcoming: ['Upcoming', 'pre'], completed: ['Completed', ''], archived: ['Archived', ''] };
const plStatusPill = (s) => `<span class="pl-pill ${PL_STATUS[s]?.[1] || ''}">${PL_STATUS[s]?.[0] || esc(s)}</span>`;

// Every pick state the server can report, plus the local-only "draft".
const PICK_STATUS = {
  needed: ['Pick needed', 'need'], open: ['Open', 'open'], draft: ['✏️ Not submitted', 'draft'], submitted: ['✓ Submitted', 'ok'],
  locked: ['🔒 Locked', 'lock'], in_progress: ['🔴 In progress', 'live'], postponed: ['⏸ Postponed', 'lock'],
  correct: ['✅ Correct', 'win'], incorrect: ['❌ Wrong', 'loss'], missed: ['⌛ Missed', 'loss'], push: ['➖ Push (tie)', 'lock'],
  void: ['🚫 Void', 'lock'], closed: ['Final', 'lock'],
};
const plBadge = (s, extra = '') => { const [label, cls] = PICK_STATUS[s] || [s, '']; return `<span class="pl-status ${cls}">${label}${extra}</span>`; };
const sideName = (g, side) => (side === 'draw' ? 'Draw' : g[side]?.name || g[side]?.abbr || side);

async function plConfig() {
  if (!pl.cfg) pl.cfg = await api('/pl/config');
  return pl.cfg;
}

function plDialog({ title, html, ok = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    d.className = 'dialog pl-dialog';
    d.innerHTML = `<form method="dialog"><h2>${esc(title)}</h2><div class="pl-dialog-body">${html}</div>
      <div class="row end"><button value="cancel" class="btn ghost" formnovalidate>Cancel</button><button value="ok" class="btn ${danger ? 'danger' : 'primary'}">${esc(ok)}</button></div></form>`;
    document.body.appendChild(d);
    d.addEventListener('close', () => { resolve(d.returnValue === 'ok'); d.remove(); });
    d.showModal();
  });
}

const plError = (e, retry = true) => `<div class="empty-state"><div class="big">🧯</div><p>${esc(e.message)}</p>${retry ? '<button class="btn primary" type="button" onclick="route()">Try again</button>' : ''} <a class="btn ghost" href="#/predict">Back to Prediction Leagues</a></div>`;

// ---------- router ----------
function renderPredict(a, b, c, d) {
  if (a === 'new') return renderPlCreate();
  if (a === 'join') return renderPlJoin(b);
  if (a === 'me') return renderPlStats();
  if (a === 'l' && b && c === 'm' && d) return renderPlLeague(b, 'member', d);
  if (a === 'l' && b) return renderPlLeague(b, c || 'overview');
  return renderPlHome();
}

// =================================================================
// DASHBOARD
// =================================================================
const PL_TABS = [['overview', 'Overview'], ['mine', 'My leagues'], ['discover', 'Discover']];

async function renderPlHome() {
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  const tab = PL_TABS.some(([k]) => k === q.get('tab')) ? q.get('tab') : 'overview';
  const app = $('#app');
  app.innerHTML = `
    <h1 class="hero-title">PREDICTION <span class="hl">LEAGUES</span></h1>
    <p class="hero-sub">Pick the winners. Beat your friends. Weekly glory, season-long bragging rights.</p>
    <div class="pl-actions">
      <a class="btn primary" href="#/predict/new">＋ Create a league</a>
      <form class="pl-joinform" id="plJoin" autocomplete="off">
        <input id="plCode" placeholder="Invite code or link" aria-label="Invite code or link" maxlength="200">
        <button class="btn" type="submit">Join</button>
      </form>
      <span class="spacer"></span>
      <a class="btn ghost" href="#/predict/me">📈 My prediction stats</a>
    </div>
    <div id="plNext"></div>
    <div class="chips pl-tabs" role="tablist" aria-label="Prediction Leagues sections">${PL_TABS.map(([k, l]) => `<a class="chip" role="tab" href="#/predict?tab=${k}" aria-pressed="${k === tab}" aria-selected="${k === tab}" data-tab="${k}">${l}</a>`).join('')}</div>
    <div id="plBody"><div class="grid">${'<div class="skeleton" style="height:180px"></div>'.repeat(3)}</div></div>`;
  $('#plJoin').onsubmit = (e) => {
    e.preventDefault();
    const raw = $('#plCode').value.trim();
    const code = (raw.match(/join\/([A-Za-z0-9]{8})/)?.[1] || raw).replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    if (code.length !== 8) return toast('Invite codes are 8 characters, like K7PQ2MXD.', true);
    location.hash = `#/predict/join/${code}`;
  };

  if (tab === 'discover') return paintPlDiscover();
  let d;
  try { d = await api('/pl/home'); } catch (e) { $('#plBody').innerHTML = plError(e); return; }
  const mine = $('[data-tab="mine"]');
  if (mine) mine.innerHTML = `My leagues <span class="count">${d.leagues.length}</span>`;
  paintPlNext(d);
  if (tab === 'mine') return paintPlMine(d);
  paintPlOverview(d);
  every(async () => { try { const fresh = await api('/pl/home'); if (location.hash.startsWith('#/predict') && $('#plBody')) { paintPlNext(fresh); if (tab === 'overview') paintPlOverview(fresh); } } catch { /* keep */ } }, 60000);
}

// The single most important next step, front and center.
function paintPlNext(d) {
  const el = $('#plNext'); if (!el) return;
  const due = d.deadlines.find((x) => x.picks === 'all' && x.needed) || null;
  if (due) {
    el.innerHTML = `<a class="pl-next hot" href="#/predict/l/${esc(due.leagueId)}/picks">
      <span class="pl-next-ico">⏰</span>
      <span><b>${pluralize(due.needed, 'pick')} needed in ${esc(due.avatar)} ${esc(due.leagueName)}</b><small>First one locks ${plUntil(due.at) ? `in ${plUntil(due.at)}` : 'now'} · ${esc(plWhen(due.at))}</small></span>
      <span class="btn primary">Make picks →</span></a>`;
  } else if (d.leagues.some((l) => l.status === 'active')) {
    el.innerHTML = `<div class="pl-next"><span class="pl-next-ico">✅</span><span><b>You're all caught up.</b><small>No picks due right now. We'll show the next deadline here.</small></span></div>`;
  } else el.innerHTML = '';
}

function plCardHTML(c) {
  const wk = c.week;
  const due = wk.nextDeadline && plUntil(wk.nextDeadline);
  const todo = c.rules.picks === 'all'
    ? (wk.needed ? `<b class="hot-txt">${pluralize(wk.needed, 'pick')} to make</b>` : wk.open ? '<b class="good-txt">All picks in ✓</b>' : '<span class="muted">No open games in the next 7 days</span>')
    : (wk.open ? `<b>${wk.submitted}/${wk.open} open games picked</b>` : '<span class="muted">No open games in the next 7 days</span>');
  return `<a class="card pl-card" href="#/predict/l/${esc(c.id)}">
    <div class="card-top"><span>${plSports(c)}</span>${plStatusPill(c.status)}</div>
    <div class="pl-card-head"><span class="pl-av">${esc(c.avatar)}</span><div><h3>${esc(c.name)}</h3><small class="muted">${c.visibility === 'public' ? '🌎 Public' : '🔒 Private'} · ${pluralize(c.members, 'member')}${c.me?.role === 'owner' ? ' · 👑 You run it' : ''}</small></div></div>
    <div class="pl-card-stats">
      <div><b>${plRank(c.rank, c.tied)}</b><span>rank of ${c.members}</span></div>
      <div><b>${c.points}</b><span>points</span></div>
      <div><b>${c.currentWeek}</b><span>week of ${c.weeks}</span></div>
    </div>
    <div class="pl-card-todo">${todo}${due && c.status !== 'archived' ? `<small>Next lock in ${due}</small>` : ''}</div>
    <div class="card-foot"><span>${esc(c.formatLabel)}</span><span class="enter">Open league →</span></div>
  </a>`;
}

function plEmptyLeagues() {
  return `<div class="empty-state pl-empty"><div class="big">🎯</div>
    <h2>No leagues yet</h2>
    <p>Start one for your friends, family or office, join with an invite code, or find a public league to jump into.</p>
    <div class="row" style="justify-content:center;flex-wrap:wrap"><a class="btn primary" href="#/predict/new">＋ Create a league</a><a class="btn" href="#/predict?tab=discover">🌎 Discover public leagues</a></div></div>`;
}

function paintPlOverview(d) {
  const el = $('#plBody'); if (!el) return;
  if (!d.leagues.length) { el.innerHTML = plEmptyLeagues(); return; }
  const active = d.leagues.filter((l) => l.status === 'active' || l.status === 'upcoming');
  const pts = d.leagues.reduce((a, l) => a + l.points, 0);
  const next = d.deadlines[0];
  el.innerHTML = `
    <div class="stats pl-stats">
      <div class="stat"><b>${active.length}</b><span>active leagues</span></div>
      <div class="stat ${d.needed ? 'hot' : ''}"><b>${d.needed}</b><span>picks needed</span></div>
      <div class="stat"><b>${next ? esc(plUntil(next.at) || 'now') : '–'}</b><span>next deadline</span></div>
      <div class="stat"><b>${pts}</b><span>points, all leagues</span></div>
    </div>
    <h2 class="league-head">Your leagues</h2>
    ${active.length ? `<div class="grid">${active.map(plCardHTML).join('')}</div>` : '<p class="muted">None active right now. Finished leagues are under <a href="#/predict?tab=mine">My leagues</a>.</p>'}
    <div class="pl-cols">
      <section class="panel"><h3>⏰ Upcoming deadlines</h3>${d.deadlines.length ? `<ul class="pl-list">${d.deadlines.map((x) => `<li><a href="#/predict/l/${esc(x.leagueId)}/picks"><span>${esc(x.avatar)} <b>${esc(x.leagueName)}</b><small>${x.picks === 'all' ? `${pluralize(x.needed, 'pick')} needed` : `${pluralize(x.open, 'game')} open`}</small></span><span class="pl-when">${esc(plWhen(x.at))}<small>${plUntil(x.at) ? `in ${plUntil(x.at)}` : 'locking'}</small></span></a></li>`).join('')}</ul>` : '<p class="muted">Nothing due. Enjoy the calm.</p>'}</section>
      <section class="panel"><h3>🗓️ Games open for picks</h3>${d.upcoming.length ? `<ul class="pl-list">${d.upcoming.map((g) => `<li><a href="#/predict/l/${esc(g.leagueId)}/picks"><span><b>${esc(g.away?.abbr)} @ ${esc(g.home?.abbr)}</b><small>${esc(g.leagueName)}</small></span><span class="pl-when">${esc(plWhen(g.start))}</span></a></li>`).join('')}</ul>` : '<p class="muted">No open games you haven\'t picked yet.</p>'}</section>
      <section class="panel"><h3>📋 Recent results</h3>${d.recent.length ? `<ul class="pl-list">${d.recent.map((x) => `<li><a href="#/predict/l/${esc(x.leagueId)}/history"><span><b>${esc(x.game.away?.abbr)} @ ${esc(x.game.home?.abbr)}</b><small>${esc(x.leagueName)} · you: ${esc(x.pick ? sideName(x.game, x.pick) : 'no pick')}</small></span>${plBadge(x.status)}</a></li>`).join('')}</ul>` : '<p class="muted">Your graded picks show up here once games go final.</p>'}</section>
      <section class="panel"><h3>📣 League activity</h3>${d.activity.length ? `<ul class="pl-feed">${d.activity.map((a) => `<li><span>${esc(a.text)}</span><small>${esc(a.leagueName)} · ${ago(a.at)}</small></li>`).join('')}</ul>` : '<p class="muted">Quiet so far.</p>'}</section>
    </div>`;
}

const MINE_FILTERS = [['all', 'All'], ['active', 'Active'], ['upcoming', 'Upcoming'], ['completed', 'Completed'], ['archived', 'Archived']];
function paintPlMine(d) {
  const el = $('#plBody');
  if (!d.leagues.length) { el.innerHTML = plEmptyLeagues(); return; }
  let st = 'all', vis = 'all';
  const draw = () => {
    const list = d.leagues.filter((l) => (st === 'all' || l.status === st) && (vis === 'all' || l.visibility === vis));
    el.innerHTML = `<div class="controls pl-filters">
        <div class="chips" role="group" aria-label="League status">${MINE_FILTERS.map(([k, l]) => { const n = d.leagues.filter((x) => k === 'all' || x.status === k).length; return `<button class="chip ${n ? '' : 'empty'}" data-st="${k}" aria-pressed="${st === k}">${l} <span class="count">${n}</span></button>`; }).join('')}</div>
        <div class="chips" role="group" aria-label="Visibility">${[['all', 'Public + private'], ['public', '🌎 Public'], ['private', '🔒 Private']].map(([k, l]) => `<button class="chip" data-vis="${k}" aria-pressed="${vis === k}">${l}</button>`).join('')}</div>
      </div>
      ${list.length ? `<div class="grid">${list.map(plCardHTML).join('')}</div>` : '<div class="empty-state"><div class="big">🔍</div><p>No leagues match those filters.</p></div>'}`;
    el.querySelector('.pl-filters').onclick = (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.st) st = b.dataset.st; if (b.dataset.vis) vis = b.dataset.vis; draw();
    };
  };
  draw();
}

function plPublicCard(l, action) {
  return `<article class="card pl-card pl-disc">
    <div class="card-top"><span>${plSports(l)}</span>${plStatusPill(l.status)}</div>
    <div class="pl-card-head"><span class="pl-av">${esc(l.avatar)}</span><div><h3>${esc(l.name)}</h3><small class="muted">Run by ${esc(l.ownerName || 'someone')}</small></div></div>
    ${l.description ? `<p class="pl-desc">${esc(l.description)}</p>` : ''}
    <div class="pl-meta">
      <span>👥 ${l.members}/${l.maxMembers} members</span>
      <span>🏆 ${esc(l.formatLabel)}</span>
      <span>🎯 ${esc(l.scoring)} · ${l.picks === 'all' ? 'every game' : 'pick your games'}</span>
      <span>📅 ${esc(plDay(l.seasonStart))} – ${esc(plDay(l.seasonEnd - 1))} (${pluralize(l.weeks, 'week')})</span>
    </div>
    ${action}
  </article>`;
}

async function paintPlDiscover() {
  const el = $('#plBody');
  let d;
  try { d = await api('/pl/discover'); } catch (e) { el.innerHTML = plError(e); return; }
  if (!d.leagues.length) {
    el.innerHTML = '<div class="empty-state"><div class="big">🌎</div><h2>No public leagues to join right now</h2><p>Be the first: make a public league and anyone can find it here.</p><a class="btn primary" href="#/predict/new">＋ Create a public league</a></div>';
    return;
  }
  el.innerHTML = `<p class="muted">Public leagues anyone can join. Members and picks stay private until you're in.</p>
    <div class="grid">${d.leagues.map((l) => plPublicCard(l, `<div class="card-foot"><span></span><button class="btn primary" type="button" data-join="${esc(l.id)}">Join league</button></div>`)).join('')}</div>`;
  el.onclick = async (e) => {
    const b = e.target.closest('[data-join]'); if (!b) return;
    const l = d.leagues.find((x) => x.id === b.dataset.join);
    const ok = await plDialog({ title: `Join ${l.name}?`, html: `<p>You'll appear as <b>${esc(me.avatar)} ${esc(me.name)}</b> on this league's leaderboards.</p><p class="muted">${esc(l.formatLabel)} · ${esc(l.scoring)} · ${plSports(l)}</p>`, ok: 'Join' });
    if (!ok) return;
    b.disabled = true;
    try { await api(`/pl/leagues/${l.id}/join`, { method: 'POST', body: {} }); confetti(90); toast(`You're in ${l.name}. Go make some picks.`); location.hash = `#/predict/l/${l.id}`; }
    catch (err) { toast(err.message, true); b.disabled = false; }
  };
}

// =================================================================
// CREATE
// =================================================================
const PL_AVATARS = ['🎯', '🏆', '🔮', '🐐', '🔥', '👑', '🦅', '🍕', '🧠', '🎲', '🍺', '🦆'];
const ymdInput = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const fromInput = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };

async function renderPlCreate() {
  const app = $('#app');
  app.innerHTML = '<a class="back" href="#/predict">← Prediction Leagues</a><div class="skeleton" style="height:420px"></div>';
  let cfg;
  try { cfg = await plConfig(); } catch (e) { app.innerHTML = plError(e); return; }
  // Default: weeks start on the most recent Tuesday, so NFL Thu–Mon slates fit in one week.
  const start = new Date(); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - ((start.getDay() + 5) % 7));
  const end = new Date(start); end.setDate(end.getDate() + 18 * 7 - 1);
  const radio = (name, opts, val) => opts.map(([v, label, hint, disabled]) => `<label class="pl-opt ${disabled ? 'disabled' : ''}"><input type="radio" name="${name}" value="${v}" ${v === val ? 'checked' : ''} ${disabled ? 'disabled' : ''}><span><b>${label}</b>${hint ? `<small>${hint}</small>` : ''}</span></label>`).join('');
  app.innerHTML = `
    <a class="back" href="#/predict">← Prediction Leagues</a>
    <h1 class="hero-title">CREATE A <span class="hl">LEAGUE</span></h1>
    <p class="hero-sub">The defaults work for most groups. Name it, pick your sports, and invite people.</p>
    <form id="plCreate" class="pl-form" novalidate>
      <section class="panel"><h3>1 · The basics</h3>
        <label class="field"><span>League name</span><input name="leagueName" required minlength="3" maxlength="40" placeholder="The Office Pick'em" autocomplete="off"></label>
        <label class="field"><span>Description <small class="muted">optional</small></span><textarea name="description" maxlength="200" rows="2" placeholder="Loser buys wings."></textarea></label>
        <div class="field"><span>League badge</span><div class="avatar-pick" id="plAvatar">${PL_AVATARS.map((a, i) => `<button type="button" aria-pressed="${i === 0}" aria-label="Badge ${a}">${a}</button>`).join('')}</div></div>
        <div class="field"><span>Who can join?</span><div class="pl-opts">${radio('visibility', [['private', '🔒 Private', 'Invite code or link only'], ['public', '🌎 Public', 'Listed in Discover. Anyone can join']], 'private')}</div></div>
      </section>
      <section class="panel"><h3>2 · Sports and season</h3>
        <div class="field"><span>Sports <small class="muted">pick one or more</small></span><div class="chips" id="plSports">${cfg.competitions.map((c) => `<button type="button" class="chip" data-sport="${c.key}" aria-pressed="${c.key === 'nfl'}">${c.emoji} ${esc(c.label)}</button>`).join('')}</div></div>
        <div class="pl-row2">
          <label class="field"><span>Season starts</span><input type="date" name="start" value="${ymdInput(start)}" required></label>
          <label class="field"><span>Season ends</span><input type="date" name="end" value="${ymdInput(end)}" required></label>
        </div>
        <p class="muted pl-hint" id="plSeasonHint"></p>
        <label class="field pl-narrow"><span>Max members</span><input type="number" name="maxMembers" min="2" max="${cfg.limits.maxMembers}" value="${cfg.defaults.settings.maxMembers}"></label>
      </section>
      <section class="panel"><h3>3 · Format</h3>
        <div class="pl-opts">${radio('format', [['weekly_season', 'Weekly rounds + season standings', 'Recommended. Win the week, chase the season title.'], ['season', 'Season-long standings', 'One cumulative table. Weekly results are still kept.']], 'weekly_season')}</div>
        <details class="pl-adv"><summary>Advanced rules <small class="muted">(defaults are fine)</small></summary>
          <div class="field"><span>Which games count?</span><div class="pl-opts">${radio('picks', [['all', 'Every eligible game', 'Skipping a game counts as a miss'], ['select', 'Only games you choose', 'Pick as many or as few as you like']], 'all')}</div></div>
          <div class="field"><span>Scoring</span><div class="pl-opts">${radio('format_s', [['classic', "Classic pick'em", '1 point per correct winner'], ['confidence', 'Confidence points', 'Coming soon', true]], 'classic')}</div></div>
          <div class="field"><span>Missed picks</span><div class="pl-opts">${radio('missed', [['zero', 'Score 0', 'Standard'], ['home', 'Default to the home team', 'Forgetful friends still get a pick']], 'zero')}</div></div>
          <div class="field"><span>Ties in the standings</span><div class="pl-opts">${radio('ties', [['shared', 'Share the rank', 'Equal points, equal rank'], ['break', 'Break ties', 'More correct picks, then fewer misses, then accuracy']], 'shared')}</div></div>
          <div class="field"><span>Changing picks</span><div class="pl-opts">${radio('allowEdits', [['1', 'Allowed until the game locks'], ['0', 'First pick is final']], '1')}</div></div>
          <div class="field"><span>Others can see your picks</span><div class="pl-opts">${radio('picksVisible', [['after_lock', 'After each game locks', 'No copying'], ['always', 'Right away']], 'after_lock')}</div></div>
          <div class="field"><span>Joining after the season starts</span><div class="pl-opts">${radio('lateJoin', [['1', 'Allowed', "Late joiners aren't charged for games they missed"], ['0', 'Not allowed']], '1')}</div></div>
          <div class="field"><span>Invites</span><div class="pl-opts">${radio('membersCanInvite', [['1', 'Any member can share the invite'], ['0', 'Only you (the owner)']], '1')}</div></div>
        </details>
      </section>
      <div class="pl-form-foot"><span class="muted">You'll be the league owner as ${esc(me.avatar)} <b>${esc(me.name)}</b>.</span><button class="btn primary" type="submit" id="plCreateBtn">Create league</button></div>
    </form>`;

  const form = $('#plCreate');
  let avatar = PL_AVATARS[0];
  $('#plAvatar').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; avatar = b.textContent; $$('#plAvatar button').forEach((x) => x.setAttribute('aria-pressed', x === b)); };
  $('#plSports').onclick = (e) => { const b = e.target.closest('[data-sport]'); if (!b) return; b.setAttribute('aria-pressed', b.getAttribute('aria-pressed') !== 'true'); };
  const hint = () => {
    const s = fromInput(form.start.value), e = fromInput(form.end.value);
    const weeks = Math.ceil((Math.round((e - s) / 864e5) + 1) / 7); // round: DST days are 23h/25h
    $('#plSeasonHint').textContent = form.start.value && form.end.value && e >= s
      ? `${pluralize(weeks, 'week')}. Weeks run ${s.toLocaleDateString([], { weekday: 'long' })} to ${new Date(s.getTime() + 6 * 864e5).toLocaleDateString([], { weekday: 'long' })}, in your time zone (${plTz}). Tip: start on a Tuesday so each NFL week (Thursday to Monday) fits in one round.`
      : 'The season has to end on or after the day it starts.';
  };
  form.start.oninput = hint; form.end.oninput = hint; hint();

  form.onsubmit = async (e) => {
    e.preventDefault();
    const sportsSel = $$('#plSports [aria-pressed="true"]').map((b) => b.dataset.sport);
    const name = form.leagueName.value.trim();
    if (name.length < 3) { form.leagueName.focus(); return toast('Give your league a name (3+ characters).', true); }
    if (!sportsSel.length) return toast('Pick at least one sport.', true);
    if (!form.start.value || !form.end.value) return toast('Pick season start and end dates.', true);
    const s = fromInput(form.start.value), en = fromInput(form.end.value); en.setDate(en.getDate() + 1);
    if (en <= s) return toast('The season has to end after it starts.', true);
    const val = (n) => form.querySelector(`[name="${n}"]:checked`)?.value;
    const body = {
      leagueName: name, description: form.description.value.trim(), leagueAvatar: avatar, visibility: val('visibility'),
      sports: sportsSel, seasonStart: s.getTime(), seasonEnd: en.getTime(), format: val('format'),
      rules: { format: val('format_s'), picks: val('picks'), missed: val('missed'), ties: val('ties') },
      settings: { maxMembers: Number(form.maxMembers.value), allowEdits: val('allowEdits') === '1', picksVisible: val('picksVisible'), lateJoin: val('lateJoin') === '1', membersCanInvite: val('membersCanInvite') === '1' },
    };
    const btn = $('#plCreateBtn'); btn.disabled = true; btn.textContent = 'Creating…';
    try {
      const l = await api('/pl/leagues', { method: 'POST', body });
      confetti(160);
      toast(`${l.name} is live. Now invite your people.`);
      location.hash = `#/predict/l/${l.id}/members`;
    } catch (err) { toast(err.message, true); btn.disabled = false; btn.textContent = 'Create league'; }
  };
}

// =================================================================
// JOIN BY INVITE
// =================================================================
async function renderPlJoin(code) {
  const app = $('#app');
  app.innerHTML = '<a class="back" href="#/predict">← Prediction Leagues</a><div class="skeleton" style="height:300px;max-width:560px;margin:0 auto"></div>';
  let d;
  try { d = await api(`/pl/invites/${encodeURIComponent(code || '')}`); }
  catch (e) {
    app.innerHTML = `<a class="back" href="#/predict">← Prediction Leagues</a>
      <div class="empty-state pl-narrowbox"><div class="big">🎟️</div><h2>That invite doesn't work</h2><p>${esc(e.message)}</p>
      <form class="pl-joinform" id="plRetry" style="justify-content:center"><input id="plCode2" placeholder="Try another code" maxlength="20" aria-label="Invite code"><button class="btn primary">Check code</button></form></div>`;
    $('#plRetry').onsubmit = (ev) => { ev.preventDefault(); const c = $('#plCode2').value.replace(/[^A-Za-z0-9]/g, '').toUpperCase(); if (c) location.hash = `#/predict/join/${c}`; };
    return;
  }
  const l = d.league;
  const action = d.alreadyMember
    ? `<div class="card-foot"><span>You're already in this league.</span><a class="btn primary" href="#/predict/l/${esc(l.id)}">Open league →</a></div>`
    : d.problem ? `<div class="pl-problem">${esc(d.problem)}</div>`
    : `<div class="pl-confirm"><p>You'll join as <b>${esc(me.avatar)} ${esc(me.name)}</b> <button type="button" class="linkish" id="plChangeMe">change</button></p><button class="btn primary" id="plJoinBtn" type="button">Join ${esc(l.name)}</button></div>`;
  app.innerHTML = `<a class="back" href="#/predict">← Prediction Leagues</a>
    <h1 class="hero-title" style="text-align:center">YOU'RE <span class="hl">INVITED</span></h1>
    <div class="pl-narrowbox">${plPublicCard(l, action)}</div>`;
  $('#plChangeMe')?.addEventListener('click', openMeDialog);
  const btn = $('#plJoinBtn');
  if (btn) btn.onclick = async () => {
    btn.disabled = true; btn.textContent = 'Joining…';
    try { await api(`/pl/invites/${encodeURIComponent(d.code)}/join`, { method: 'POST', body: {} }); confetti(120); toast(`Welcome to ${l.name}!`); location.hash = `#/predict/l/${l.id}`; }
    catch (e) { toast(e.message, true); btn.disabled = false; btn.textContent = `Join ${l.name}`; }
  };
}

// =================================================================
// LEAGUE
// =================================================================
const LG_TABS = [['overview', 'Overview'], ['picks', 'Make picks'], ['week', 'Weekly'], ['season', 'Season'], ['members', 'Members'], ['history', 'History'], ['settings', 'Rules & settings']];

function plLeagueHead(l, tab, needed = 0) {
  return `<a class="back" href="#/predict">← Prediction Leagues</a>
    <section class="pl-head">
      <span class="pl-av big">${esc(l.avatar)}</span>
      <div class="pl-head-main">
        <h1>${esc(l.name)}</h1>
        <div class="pl-head-meta">${plStatusPill(l.status)}<span>${l.visibility === 'public' ? '🌎 Public' : '🔒 Private'}</span><span>${plSports(l)}</span><span>👥 ${l.members}</span><span>Week ${l.currentWeek} of ${l.weeks}</span></div>
        ${l.description ? `<p class="muted">${esc(l.description)}</p>` : ''}
      </div>
    </section>
    <nav class="pl-ltabs" aria-label="League sections">${LG_TABS.map(([k, label]) => `<a href="#/predict/l/${esc(l.id)}/${k}" ${k === tab ? 'aria-current="page" class="active"' : ''}>${label}${k === 'picks' && needed ? ` <span class="pl-dot">${needed}</span>` : ''}</a>`).join('')}</nav>
    <div id="plTab"></div>`;
}

async function renderPlLeague(id, tab, sub) {
  const app = $('#app');
  pl.lid = id;
  app.innerHTML = '<a class="back" href="#/predict">← Prediction Leagues</a><div class="skeleton" style="height:120px"></div><div class="skeleton" style="height:320px;margin-top:16px"></div>';
  let ov;
  try { ov = await api(`/pl/leagues/${encodeURIComponent(id)}`); }
  catch (e) { app.innerHTML = plError(e, !/not found/i.test(e.message)); return; }
  const l = ov.league;
  if (ov.preview) return paintPlPreview(ov);
  if (!LG_TABS.some(([k]) => k === tab) && tab !== 'member') tab = 'overview';
  app.innerHTML = plLeagueHead(l, tab === 'member' ? '' : tab, ov.soon?.needed || 0);
  const el = $('#plTab');
  const week = Number(new URLSearchParams(location.hash.split('?')[1] || '').get('week')) || null;
  if (tab === 'overview') return paintLgOverview(ov, el);
  if (tab === 'picks') return paintLgPicks(l, el, week);
  if (tab === 'week') return paintLgWeek(l, el, week);
  if (tab === 'season') return paintLgSeason(l, el);
  if (tab === 'members') return paintLgMembers(l, el);
  if (tab === 'history') return paintLgProfile(l, el, l.me.mid);
  if (tab === 'member') return paintLgProfile(l, el, sub);
  if (tab === 'settings') return paintLgSettings(l, el);
}

function paintPlPreview(ov) {
  const l = ov.preview;
  $('#app').innerHTML = `<a class="back" href="#/predict?tab=discover">← Discover</a>
    <div class="pl-narrowbox">${plPublicCard(l, ov.joinProblem ? `<div class="pl-problem">${esc(ov.joinProblem)}</div>` : '<div class="card-foot"><span class="muted">Standings and members are visible to members.</span><button class="btn primary" id="plJoinPub">Join league</button></div>')}</div>`;
  const b = $('#plJoinPub');
  if (b) b.onclick = async () => {
    const ok = await plDialog({ title: `Join ${l.name}?`, html: `<p>You'll appear as <b>${esc(me.avatar)} ${esc(me.name)}</b> on the leaderboards.</p>`, ok: 'Join' });
    if (!ok) return;
    try { await api(`/pl/leagues/${l.id}/join`, { method: 'POST', body: {} }); confetti(90); route(); } catch (e) { toast(e.message, true); }
  };
}

// ---------- overview ----------
function plMiniTable(rows, l, { week = false } = {}) {
  if (!rows.length) return '<p class="muted">No members yet.</p>';
  return `<table class="lines pl-table compact"><thead><tr><th>#</th><th class="pl-who">Player</th><th>Pts</th><th>${week ? 'W-L' : 'Acc'}</th></tr></thead><tbody>
    ${rows.map((r) => `<tr class="${r.me ? 'mine' : ''}"><td>${plRank(r.rank, r.tied)}</td><td><a href="#/predict/l/${esc(l.id)}/m/${esc(r.mid)}">${esc(r.avatar)} ${esc(r.name)}</a>${r.role === 'owner' ? ' <span title="League owner">👑</span>' : ''}</td><td class="tot">${r.points}</td><td>${week ? `${r.correct}-${r.incorrect}` : plAcc(r.accuracy)}</td></tr>`).join('')}</tbody></table>`;
}

// `soon` = open games in the next 7 days (can span into next week); `w` = the current league week.
function plWeekBanner(l, w, soon) {
  const picks = `#/predict/l/${esc(l.id)}/picks`;
  if (l.status === 'archived') return '<div class="pl-next"><span class="pl-next-ico">🗄️</span><span><b>This league is archived.</b><small>Standings are frozen. No more picks.</small></span></div>';
  if (l.rules.picks === 'all' && soon.needed) {
    return `<a class="pl-next hot" href="${picks}"><span class="pl-next-ico">⏰</span><span><b>${pluralize(soon.needed, 'pick')} needed in the next 7 days</b><small>First lock ${plUntil(soon.nextDeadline) ? `in ${plUntil(soon.nextDeadline)}` : 'now'} · ${esc(plWhen(soon.nextDeadline))}</small></span><span class="btn primary">Make picks →</span></a>`;
  }
  if (soon.open) return `<a class="pl-next" href="${picks}"><span class="pl-next-ico">✅</span><span><b>${l.rules.picks === 'all' ? `All ${soon.submitted} open games picked.` : `${soon.submitted} of ${soon.open} open games picked.`}</b><small>${l.settings.allowEdits ? 'You can still change picks until each game locks.' : 'You can still pick games you skipped.'}</small></span><span class="btn">Review picks</span></a>`;
  if (!w.games) return `<div class="pl-next"><span class="pl-next-ico">🗓️</span><span><b>No ${plSports(l)} games this week.</b><small>${esc(plRange(w))}. The schedule comes straight from the data feed.</small></span></div>`;
  return `<div class="pl-next"><span class="pl-next-ico">${w.final ? '🏁' : '⏳'}</span><span><b>Week ${w.week} ${w.final ? 'is final' : 'is locked'}.</b><small>${w.final ? 'Every result is in.' : `${w.resolved} of ${w.games} results in${w.postponed ? `, ${w.postponed} postponed` : ''}.`} No open games in the next 7 days.</small></span></div>`;
}

function paintLgOverview(ov, el) {
  const l = ov.league, w = ov.week, meRow = ov.me;
  el.innerHTML = `
    ${ov.failed?.length ? `<p class="pl-warn">⚠️ Couldn't refresh ${esc(ov.failed.join(', ').toUpperCase())} from the data feed. Showing the last known schedule.</p>` : ''}
    ${plWeekBanner(l, w, ov.soon)}
    <div class="stats pl-stats">
      <div class="stat"><b>${plRank(meRow?.rank, meRow?.tied)}</b><span>your season rank</span></div>
      <div class="stat"><b>${meRow?.points ?? 0}</b><span>season points</span></div>
      <div class="stat"><b>${plAcc(meRow?.accuracy)}</b><span>accuracy</span></div>
      <div class="stat"><b>${ov.weekTop.find((r) => r.me)?.points ?? 0}</b><span>week ${w.week} points</span></div>
    </div>
    <div class="layout">
      <div>
        <section class="panel"><h3>🗓️ Up next <small>open games, next 7 days</small></h3>
          ${ov.upcoming.length ? `<ul class="pl-list">${ov.upcoming.map((g) => `<li><a href="#/predict/l/${esc(l.id)}/picks${g.week ? `?week=${g.week}` : ''}"><span><b>${esc(g.away?.name)} @ ${esc(g.home?.name)}</b><small>${esc(g.league.toUpperCase())} · ${g.mine ? `your pick: ${esc(sideName(g, g.mine))}` : '<span class="hot-txt">no pick yet</span>'}</small></span><span class="pl-when">${esc(plWhen(g.start))}<small>locks in ${esc(plUntil(g.start) || 'now')}</small></span></a></li>`).join('')}</ul>` : '<p class="muted">No open games left this week.</p>'}
          <a class="btn primary" href="#/predict/l/${esc(l.id)}/picks" style="margin-top:12px;display:inline-block;text-decoration:none">Make picks</a></section>
        <section class="panel"><h3>📋 Your recent results</h3>
          ${ov.recent.length ? `<ul class="pl-list">${ov.recent.map((x) => `<li><span><b>${esc(x.game.away?.abbr)} ${x.game.away?.score ?? ''} @ ${esc(x.game.home?.abbr)} ${x.game.home?.score ?? ''}</b><small>you: ${esc(x.pick ? sideName(x.game, x.pick) : 'no pick')}${x.auto ? ' (auto)' : ''}</small></span>${plBadge(x.status, x.points ? ` +${x.points}` : '')}</li>`).join('')}</ul>` : '<p class="muted">Nothing graded yet. Results land here as soon as games go final.</p>'}</section>
        <section class="panel"><h3>📣 Activity</h3>${ov.activity.length ? `<ul class="pl-feed">${ov.activity.map((a) => `<li><span>${esc(a.text)}</span><small>${ago(a.at)}</small></li>`).join('')}</ul>` : '<p class="muted">Nothing yet.</p>'}</section>
      </div>
      <aside class="side">
        <section class="panel"><h3>🏆 Season standings <small><a href="#/predict/l/${esc(l.id)}/season">full table →</a></small></h3>${plMiniTable(ov.season, l)}</section>
        <section class="panel"><h3>📅 Week ${w.week} <small><a href="#/predict/l/${esc(l.id)}/week">details →</a></small></h3>${plMiniTable(ov.weekTop, l, { week: true })}</section>
        <section class="panel"><h3>📜 Rules</h3>${plRulesList(l, true)}</section>
      </aside>
    </div>`;
  every(async () => { try { const fresh = await api(`/pl/leagues/${l.id}`); if (pl.lid === l.id && $('#plTab')) paintLgOverview(fresh, $('#plTab')); } catch { /* keep */ } }, 60000);
}

// ---------- make picks ----------
const PICK_FILTERS = [['all', 'All games'], ['needed', 'Needs a pick'], ['submitted', 'Submitted'], ['upcoming', 'Upcoming'], ['live', 'In progress'], ['final', 'Completed']];
const draftKey = (lid) => `ttl:pl:draft:${lid}`;
const getDrafts = (lid) => store.get(draftKey(lid), {});
const setDrafts = (lid, d) => store.set(draftKey(lid), d);

function plWeekStepper(l, week, weeks, tab) {
  const go = (n) => `#/predict/l/${esc(l.id)}/${tab}?week=${n}`;
  return `<div class="pl-weekbar">
    <a class="btn ghost ${week.week <= 1 ? 'disabled' : ''}" ${week.week <= 1 ? 'aria-disabled="true"' : `href="${go(week.week - 1)}"`} aria-label="Previous week">◀</a>
    <div><b>Week ${week.week}</b><small>${esc(plRange(week))}</small></div>
    <a class="btn ghost ${week.week >= weeks ? 'disabled' : ''}" ${week.week >= weeks ? 'aria-disabled="true"' : `href="${go(week.week + 1)}"`} aria-label="Next week">▶</a>
    ${week.week !== l.currentWeek ? `<a class="btn ghost" href="#/predict/l/${esc(l.id)}/${tab}">This week</a>` : ''}
  </div>`;
}

async function paintLgPicks(l, el, week) {
  el.innerHTML = `<div class="grid">${'<div class="skeleton" style="height:200px"></div>'.repeat(4)}</div>`;
  let d;
  try { d = await api(`/pl/leagues/${l.id}/slate${week ? `?week=${week}` : ''}`); } catch (e) { el.innerHTML = plError(e); return; }
  pl.slate = d; pl.probRetry = 0;
  if (!d.league.sports.some((s) => s.key === pl.sport)) pl.sport = 'all';
  paintSlate();
  // Keep locks, live scores and ESPN numbers current.
  every(async () => {
    try {
      const fresh = await api(`/pl/leagues/${l.id}/slate?week=${pl.slate.week.week}`);
      if (pl.lid === l.id && $('#plGames')) { pl.slate = fresh; paintSlate(); }
    } catch { /* keep */ }
  }, 60000);
  every(() => { if ($('#plGames')) paintSlate(true); }, 30000); // countdowns + local lock display
}

function slateGames() {
  const d = pl.slate, drafts = getDrafts(d.league.id), now = Date.now();
  return d.games.map((g) => {
    // The server decides what's editable; locally we also stop at kickoff so nobody wastes a tap.
    const editable = g.editable && g.start > now;
    const draft = editable && drafts[g.key] && drafts[g.key] !== g.mine?.pick ? drafts[g.key] : null;
    let status = g.status;
    if (!editable && (status === 'needed' || status === 'submitted' || status === 'open')) status = 'locked';
    if (draft) status = 'draft';
    return { ...g, editable, draft, view: status };
  });
}

function matchCard(g, l) {
  const sel = g.draft || g.mine?.pick || null;
  const final = g.outcome != null;
  const showScore = g.phase === 'in' || final;
  const p = g.prob;
  const side = (s) => {
    const t = g[s];
    const won = final && g.outcome === s;
    const pct = p.status === 'ok' ? p[s] : null;
    return `<button type="button" class="pl-side ${sel === s ? 'sel' : ''} ${won ? 'won' : ''}" data-side="${s}" aria-pressed="${sel === s}" ${g.editable ? '' : 'disabled'} aria-label="Pick ${esc(t?.full || t?.name)}${pct !== null ? `, ESPN win probability ${pct}%` : ''}">
      ${logo(t)}
      <span class="pl-tn"><b class="nm-full">${esc(t?.name)}</b><b class="nm-abbr">${esc(t?.abbr)}</b><small>${s === 'home' ? 'Home' : 'Away'}${t?.record ? ` · ${esc(t.record)}` : ''}</small></span>
      ${showScore ? `<span class="pl-score">${esc(t?.score ?? '')}</span>` : ''}
      ${pct !== null ? `<span class="pl-pct" title="${esc(p.label || 'ESPN Matchup Predictor')}">ESPN ${pct}%</span>` : ''}
      ${sel === s ? `<span class="pl-check" aria-hidden="true">${g.draft ? '✏️' : '✓'}</span>` : ''}
    </button>`;
  };
  let prob;
  if (p.status === 'ok') {
    prob = `<div class="pl-prob" title="ESPN's own pregame model, read from ESPN's public (unofficial) site feed. Context only. It doesn't affect scoring.">
      <div class="pl-prob-bar" aria-hidden="true"><i class="a" style="width:${p.away}%"></i><i class="h" style="width:${p.home}%"></i></div>
      <small>${p.pregame ? 'Pregame ' : ''}ESPN ${esc(p.label || 'Matchup Predictor')}: ${esc(g.away?.abbr)} ${p.away}% · ${esc(g.home?.abbr)} ${p.home}% · as of ${esc(fmtTime(new Date(p.retrievedAt).toISOString()))}</small></div>`;
  } else if (p.status === 'loading') prob = '<div class="pl-prob"><small class="muted">Checking ESPN win probability…</small></div>';
  else prob = '<div class="pl-prob"><small class="muted">ESPN win probability unavailable</small></div>';

  const lockTxt = g.phase === 'postponed' ? 'Postponed. Picks reopen if it gets a new start time.'
    : g.editable ? `Locks ${esc(fmtTime(new Date(g.start).toISOString()))} · <b>in ${esc(plUntil(g.start))}</b>`
    : final ? esc(g.detail || 'Final') : g.phase === 'in' ? `🔴 ${esc(g.detail || 'Live')}` : 'Locked at kickoff';
  const split = g.split && (g.split.home + g.split.away + g.split.draw) ? `<span class="muted">League: ${esc(g.away?.abbr)} ${g.split.away} · ${g.drawPick ? `Draw ${g.split.draw} · ` : ''}${esc(g.home?.abbr)} ${g.split.home}</span>` : '';
  const mineTxt = g.draft ? '<span class="hot-txt">Not submitted yet</span>'
    : g.mine?.auto ? `<span class="muted">Auto pick: ${esc(sideName(g, 'home'))} (missed-pick rule)</span>`
    : g.mine ? `<span class="muted">Your pick: <b>${esc(sideName(g, g.mine.pick))}</b> · saved ${esc(ago(g.mine.updatedAt))}</span>`
    : g.editable ? '<span class="muted">Tap a team to pick</span>' : '';
  return `<article class="pl-match st-${esc(g.view)} ${g.editable ? 'editable' : ''}" data-key="${esc(g.key)}">
    <div class="pl-m-top"><span>${esc(l.sports.find((s) => s.key === g.league)?.emoji || '')} ${esc(g.league.toUpperCase())} · ${esc(plWhen(g.start))}</span>${plBadge(g.view, g.view === 'correct' && g.points ? ` +${g.points}` : '')}</div>
    <div class="pl-sides ${g.drawPick ? 'three' : ''}">${side('away')}${g.drawPick ? `<button type="button" class="pl-side pl-draw ${sel === 'draw' ? 'sel' : ''} ${final && g.outcome === 'tie' ? 'won' : ''}" data-side="draw" aria-pressed="${sel === 'draw'}" ${g.editable ? '' : 'disabled'}><b>Draw</b>${sel === 'draw' ? '<span class="pl-check">✓</span>' : ''}</button>` : ''}${side('home')}</div>
    ${final || g.phase === 'in' ? '' : prob}
    ${final && p.status === 'ok' ? prob : ''}
    <div class="pl-m-foot"><span>${lockTxt}</span>${mineTxt}${split}</div>
  </article>`;
}

function paintSlate(quiet = false) {
  const d = pl.slate, l = d.league;
  const all = slateGames();
  const inSport = (g) => pl.sport === 'all' || g.league === pl.sport;
  const match = {
    all: () => true,
    needed: (g) => g.editable && !g.mine,
    submitted: (g) => g.mine && !g.mine.auto,
    upcoming: (g) => g.editable || (g.phase === 'scheduled' && g.start > Date.now()),
    live: (g) => g.phase === 'in',
    final: (g) => g.outcome != null,
  };
  const list = all.filter((g) => inSport(g) && match[pl.filter](g));
  const drafts = all.filter((g) => g.draft);
  if (quiet && $('#plGames')) {
    // countdown refresh only: repaint cards in place
    $('#plGames').innerHTML = slateGroups(list, l);
    paintSubmitBar(drafts);
    return;
  }
  const el = $('#plTab');
  el.innerHTML = `
    ${plWeekStepper(l, d.week, d.weeks, 'picks')}
    ${d.failed?.length ? `<p class="pl-warn">⚠️ Couldn't refresh ${esc(d.failed.join(', ').toUpperCase())} from the data feed. Showing the last known schedule.</p>` : ''}
    <div class="controls pl-filters">
      <div class="chips" role="group" aria-label="Filter games">${PICK_FILTERS.map(([k, label]) => { const n = all.filter((g) => inSport(g) && match[k](g)).length; return `<button class="chip ${n ? '' : 'empty'} ${k === 'needed' && n ? 'chip-live' : ''}" data-f="${k}" aria-pressed="${pl.filter === k}">${label} <span class="count">${n}</span></button>`; }).join('')}</div>
      ${l.sports.length > 1 ? `<div class="chips" role="group" aria-label="Sport">${[{ key: 'all', emoji: '🌎', label: 'All sports' }, ...l.sports].map((s) => `<button class="chip" data-sp="${s.key}" aria-pressed="${pl.sport === s.key}">${s.emoji} ${esc(s.label)}</button>`).join('')}</div>` : ''}
    </div>
    <p class="pl-note">${l.rules.picks === 'all' ? 'Every game counts. Skipping one is a miss.' : 'Pick any games you like. Unpicked games don\'t count.'}
      Picks lock at each game's scheduled start. Times are in ${esc(plTz)}. ${l.settings.allowEdits ? 'You can change a submitted pick until it locks.' : '<b>Picks are final once submitted.</b>'}
      ${l.settings.picksVisible === 'always' ? 'Everyone can see your picks right away.' : 'Others see your picks only after each game locks.'}</p>
    <div id="plGames">${slateGroups(list, l)}</div>
    <div class="pl-submitbar" id="plSubmit" hidden></div>
    <p class="pl-source">Schedules and results: ${esc(pl.cfg?.dataSource || 'ESPN public site API')}, unofficial and undocumented. ${d.probabilitySource ? `Win probabilities: ${esc(d.probabilitySource)} from the same feed, for context only. They don't affect scoring.` : 'Win probabilities are turned off on this server.'}</p>`;
  if (!pl.cfg) plConfig().catch(() => {});
  paintSubmitBar(drafts);

  el.querySelector('.pl-filters').onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.f) pl.filter = b.dataset.f;
    if (b.dataset.sp) pl.sport = b.dataset.sp;
    paintSlate();
  };
  $('#plGames').onclick = (e) => {
    const b = e.target.closest('[data-side]'); if (!b || b.disabled) return;
    const key = b.closest('[data-key]').dataset.key;
    const g = pl.slate.games.find((x) => x.key === key);
    const dr = getDrafts(l.id);
    const cur = dr[key] || g.mine?.pick;
    if (cur === b.dataset.side && dr[key]) delete dr[key]; // tap the draft again to undo
    else if (b.dataset.side === g.mine?.pick) delete dr[key];
    else dr[key] = b.dataset.side;
    setDrafts(l.id, dr);
    paintSlate(true);
  };

  // ESPN numbers still loading server-side: check back a couple of times.
  if (all.some((g) => g.prob.status === 'loading') && pl.probRetry < 8) {
    pl.probRetry++;
    setTimeout(async () => {
      if (pl.lid !== l.id || !$('#plGames')) return;
      try { pl.slate = await api(`/pl/leagues/${l.id}/slate?week=${d.week.week}`); paintSlate(true); } catch { /* fine */ }
    }, 4000);
  }
}

function slateGroups(list, l) {
  if (!pl.slate.games.length) return `<div class="empty-state"><div class="big">🗓️</div><p>No ${plSports(l)} games scheduled for this week.</p><p class="muted">The schedule comes from the data feed. Try the next week.</p></div>`;
  if (!list.length) {
    const msg = { needed: ['🎉', 'Nothing left to pick. You\'re all set.'], submitted: ['🫥', 'No submitted picks yet this week.'], live: ['🍿', 'No games in progress right now.'], final: ['⏳', 'No final results yet. Waiting on the games.'] }[pl.filter] || ['🔍', 'No games match these filters.'];
    return `<div class="empty-state"><div class="big">${msg[0]}</div><p>${msg[1]}</p></div>`;
  }
  const days = new Map();
  for (const g of list) { const k = plDay(g.start); if (!days.has(k)) days.set(k, []); days.get(k).push(g); }
  return [...days].map(([day, gs]) => `<h2 class="league-head">${esc(day)} <small>${pluralize(gs.length, 'game')}</small></h2><div class="pl-grid">${gs.map((g) => matchCard(g, l)).join('')}</div>`).join('');
}

function paintSubmitBar(drafts) {
  const bar = $('#plSubmit'); if (!bar) return;
  bar.hidden = !drafts.length;
  if (!drafts.length) return;
  bar.innerHTML = `<span><b>${pluralize(drafts.length, 'pick')} not submitted</b><small>Saved on this device only until you submit.</small></span>
    <button class="btn ghost" type="button" id="plDiscard">Discard</button><button class="btn primary" type="button" id="plReview">Review & submit</button>`;
  $('#plDiscard').onclick = () => { const dr = getDrafts(pl.slate.league.id); for (const g of drafts) delete dr[g.key]; setDrafts(pl.slate.league.id, dr); paintSlate(true); };
  $('#plReview').onclick = () => reviewPicks(drafts);
}

function reviewPicks(drafts) {
  const l = pl.slate.league;
  const d = document.createElement('dialog');
  d.className = 'dialog pl-dialog';
  d.innerHTML = `<h2>Review your picks</h2>
    <p class="muted">${l.settings.allowEdits ? 'You can change these until each game locks.' : '<b>Heads up: picks are final in this league.</b>'}</p>
    <ul class="pl-review">${drafts.map((g) => `<li data-key="${esc(g.key)}"><span>${esc(g.away?.abbr)} @ ${esc(g.home?.abbr)}<small>${esc(plWhen(g.start))}</small></span><b>${esc(sideName(g, g.draft))}</b>${g.mine ? `<small class="muted">was ${esc(sideName(g, g.mine.pick))}</small>` : ''}<span class="pl-r-res"></span></li>`).join('')}</ul>
    <div class="row end"><button class="btn ghost" type="button" data-x>Keep editing</button><button class="btn primary" type="button" data-go>Submit ${pluralize(drafts.length, 'pick')}</button></div>`;
  document.body.appendChild(d);
  d.addEventListener('close', () => d.remove());
  d.querySelector('[data-x]').onclick = () => d.close();
  const go = d.querySelector('[data-go]');
  go.onclick = async () => {
    go.disabled = true; go.textContent = 'Submitting…';
    try {
      const r = await api(`/pl/leagues/${l.id}/picks`, { method: 'POST', body: { picks: drafts.map((g) => ({ game: g.key, pick: g.draft })) } });
      const dr = getDrafts(l.id);
      let ok = 0;
      for (const x of r.results) {
        const li = d.querySelector(`[data-key="${CSS.escape(x.game)}"] .pl-r-res`);
        if (x.ok) { ok++; delete dr[x.game]; if (li) li.innerHTML = '<span class="good-txt">✓ Saved</span>'; }
        else if (li) li.innerHTML = `<span class="hot-txt">✕ ${esc(x.error)}</span>`;
      }
      setDrafts(l.id, dr);
      pl.slate = await api(`/pl/leagues/${l.id}/slate?week=${pl.slate.week.week}`).catch(() => pl.slate);
      paintSlate();
      if (ok === r.results.length) { d.close(); confetti(80); toast(`✅ ${pluralize(ok, 'pick')} submitted. Locked in.`); }
      else { toast(`${ok} saved, ${r.results.length - ok} couldn't be saved. See why below.`, true); go.textContent = 'Done'; go.disabled = false; go.onclick = () => d.close(); }
    } catch (e) {
      toast(`Couldn't submit: ${e.message} Your picks are still here. Try again.`, true);
      go.disabled = false; go.textContent = 'Try again';
    }
  };
  d.showModal();
}

// ---------- weekly ----------
async function paintLgWeek(l, el, week) {
  el.innerHTML = '<div class="skeleton" style="height:300px"></div>';
  let d;
  try { d = await api(`/pl/leagues/${l.id}/week${week ? `?week=${week}` : ''}`); } catch (e) { el.innerHTML = plError(e); return; }
  const w = d.week, rows = d.rows, leader = rows[0];
  const meRow = rows.find((r) => r.me);
  const state = !w.games ? `No ${plSports(l)} games this week.`
    : w.final ? 'Final. Every result is in.'
    : !w.started ? `Starts ${esc(plWhen(w.start))}.`
    : `In progress: ${w.resolved} of ${w.games} results in${w.postponed ? ` (${w.postponed} postponed: the week stays open until ${w.postponed === 1 ? 'it\'s' : 'they\'re'} played or canceled)` : ''}. ${w.lastStart && w.lastStart > Date.now() ? `Last game starts ${esc(plWhen(w.lastStart))}.` : 'Standings go final when the last result is in.'}`;
  const lead = leader && leader.points > 0
    ? (leader.tied ? `Tied at the top with ${leader.points} pts.` : `${esc(leader.avatar)} <b>${esc(leader.name)}</b> leads with ${leader.points} pts.`)
      + (meRow && meRow !== leader && !(meRow.rank === leader.rank) ? ` You're ${meRow.behind} back.` : meRow && meRow.rank === 1 ? ' That\'s you. 👑' : '')
    : 'No points on the board yet.';
  el.innerHTML = `${plWeekStepper(l, w, d.weeks, 'week')}
    <div class="pl-next ${w.final ? '' : 'soft'}"><span class="pl-next-ico">${w.final ? '🏁' : '⏳'}</span><span><b>${lead}</b><small>${state}</small></span></div>
    <section class="panel"><h3>📅 Week ${w.week} leaderboard <small>${pluralize(w.games, 'game')}</small></h3>
      ${plTable(l, rows, 'week')}
      <p class="muted pl-legend">✅ correct · ❌ wrong · ⌛ missed · Acc = correct ÷ decided picks. ${l.rules.ties === 'shared' ? 'Equal points share a rank (T-).' : 'Ties are broken by correct picks, then fewer misses, then accuracy.'}</p>
    </section>`;
}

function plTable(l, rows, kind) {
  if (!rows.length) return '<p class="muted">No members yet.</p>';
  const season = kind === 'season';
  const maxWeek = season ? Math.max(1, ...rows.flatMap((r) => r.weekly.map((x) => x.points))) : 0;
  return `<div class="table-scroll"><table class="lines pl-table"><thead><tr>
      <th>#</th>${season ? '<th title="Change since last week">±</th>' : ''}<th class="pl-who">Player</th><th>Pts</th><th title="Correct">✅</th><th title="Wrong">❌</th><th title="Missed">⌛</th><th>Acc</th>${season ? '<th>By week</th>' : '<th>Back</th>'}
    </tr></thead><tbody>${rows.map((r) => `<tr class="${r.me ? 'mine' : ''}">
      <td>${plRank(r.rank, r.tied)}</td>
      ${season ? `<td class="pl-move">${r.move == null ? '' : r.move > 0 ? `<span class="good-txt">▲${r.move}</span>` : r.move < 0 ? `<span class="hot-txt">▼${-r.move}</span>` : '<span class="muted">–</span>'}</td>` : ''}
      <td><a href="#/predict/l/${esc(l.id)}/m/${esc(r.mid)}">${esc(r.avatar)} ${esc(r.name)}</a>${r.role === 'owner' ? ' <span title="League owner">👑</span>' : ''}${r.me ? ' <span class="muted">(you)</span>' : ''}</td>
      <td class="tot">${r.points}</td><td>${r.correct}</td><td>${r.incorrect}</td><td>${r.missed}</td><td>${plAcc(r.accuracy)}</td>
      ${season ? `<td><span class="pl-spark" aria-label="Weekly points: ${r.weekly.map((x) => x.points).join(', ')}">${r.weekly.slice(-12).map((x) => `<i style="height:${Math.max(8, (x.points / maxWeek) * 100)}%" title="Week ${x.week}: ${x.points} pts"></i>`).join('')}</span></td>` : `<td>${r.behind ? `-${r.behind}` : '–'}</td>`}
    </tr>`).join('')}</tbody></table></div>`;
}

// ---------- season ----------
async function paintLgSeason(l, el) {
  el.innerHTML = '<div class="skeleton" style="height:300px"></div>';
  let d;
  try { d = await api(`/pl/leagues/${l.id}/season`); } catch (e) { el.innerHTML = plError(e); return; }
  const scored = d.rows.reduce((a, r) => a + r.scored, 0);
  el.innerHTML = `<section class="panel"><h3>🏆 Season standings <small>through week ${d.currentWeek} of ${d.totalWeeks}</small></h3>
      ${scored ? '' : '<p class="muted">No graded games yet. Points show up here when results go final.</p>'}
      ${plTable(l, d.rows, 'season')}
      <p class="muted pl-legend">± = movement since before this week's results. Tap a player to see their record and the picks you're allowed to see. Weekly and season numbers come from the same graded picks.</p>
    </section>`;
}

// ---------- members + invites ----------
async function paintLgMembers(l, el) {
  el.innerHTML = '<div class="skeleton" style="height:300px"></div>';
  let d, inv = null;
  try {
    [d, inv] = await Promise.all([api(`/pl/leagues/${l.id}/members`), l.perms.invite ? api(`/pl/leagues/${l.id}/invite`).catch(() => null) : null]);
  } catch (e) { el.innerHTML = plError(e); return; }
  const lg = d.league;
  el.innerHTML = `<div class="layout">
    <section class="panel"><h3>👥 Members <small>${lg.members} of ${lg.settings.maxMembers}</small></h3>
      <ul class="pl-members">${d.members.map((m) => `<li class="${m.me ? 'mine' : ''}">
        <span class="av">${esc(m.avatar)}</span>
        <a href="#/predict/l/${esc(lg.id)}/m/${esc(m.mid)}"><b>${esc(m.name)}${m.me ? ' <span class="muted">(you)</span>' : ''}</b><small>${m.role === 'owner' ? '👑 Owner' : 'Member'} · joined ${esc(plDay(m.joinedAt))}</small></a>
        <span class="pl-mstat">${plRank(m.rank)} · ${m.points} pts</span>
        ${lg.perms.owner && m.role !== 'owner' ? `<button class="btn ghost danger-txt" type="button" data-remove="${esc(m.mid)}" data-name="${esc(m.name)}">Remove</button>` : ''}
      </li>`).join('')}</ul>
      ${!lg.perms.owner ? '<div class="pl-leave"><button class="btn ghost danger-txt" type="button" id="plLeave">Leave league</button></div>' : ''}
    </section>
    <aside class="side"><section class="panel" id="plInvite"></section></aside>
  </div>`;
  paintInvite(lg, inv);
  el.querySelector('.pl-members').onclick = async (e) => {
    const b = e.target.closest('[data-remove]'); if (!b) return;
    if (!await plDialog({ title: `Remove ${b.dataset.name}?`, html: '<p>They\'ll lose access to this league and can\'t rejoin. Their past picks stay in the records but drop out of the standings.</p>', ok: 'Remove', danger: true })) return;
    try { await api(`/pl/leagues/${lg.id}/members/${b.dataset.remove}`, { method: 'DELETE' }); toast(`${b.dataset.name} removed.`); paintLgMembers(lg, el); }
    catch (err) { toast(err.message, true); }
  };
  $('#plLeave')?.addEventListener('click', async () => {
    if (!await plDialog({ title: 'Leave this league?', html: '<p>You\'ll drop out of the standings. You can rejoin later if the league still has room.</p>', ok: 'Leave', danger: true })) return;
    try { await api(`/pl/leagues/${lg.id}/leave`, { method: 'POST', body: {} }); toast('You left the league.'); location.hash = '#/predict'; }
    catch (err) { toast(err.message, true); }
  });
}

function paintInvite(lg, inv) {
  const el = $('#plInvite'); if (!el) return;
  if (!lg.perms.invite) {
    el.innerHTML = `<h3>✉️ Invites</h3><p class="muted">${lg.archived || lg.status === 'archived' ? 'This league is archived.' : lg.status === 'completed' ? 'The season is over.' : 'Only the league owner can invite people to this league.'}</p>`;
    return;
  }
  const i = inv?.invite;
  const link = i ? `${location.origin}/#/predict/join/${i.code}` : '';
  el.innerHTML = `<h3>✉️ Invite people</h3>
    ${i ? `<div class="pl-code" aria-label="Invite code">${esc(i.code)}</div>
      <div class="pl-linkrow"><input readonly value="${esc(link)}" aria-label="Invite link" id="plLink"><button class="btn" type="button" id="plCopy">Copy link</button></div>
      <div class="row" style="margin-top:8px;flex-wrap:wrap">${navigator.share ? '<button class="btn primary" type="button" id="plShare">Share…</button>' : ''}<button class="btn ghost" type="button" id="plCopyCode">Copy code</button></div>
      <p class="muted pl-hint">${i.expiresAt ? `Expires ${esc(plWhen(i.expiresAt))}` : 'Never expires'} · ${i.maxUses ? `${i.uses}/${i.maxUses} uses` : `${i.uses} used`}${lg.visibility === 'public' ? ' · Public leagues can also be joined from Discover.' : ''}</p>`
      : '<p class="muted">No active invite. People can\'t join with a code right now.</p>'}
    ${inv?.canManage ? `<details class="pl-adv"${i ? '' : ' open'}><summary>Manage invite</summary>
      <div class="pl-row2">
        <label class="field"><span>Expires</span><select class="select" id="plExp"><option value="">Never</option><option value="1">In 1 day</option><option value="7">In 7 days</option><option value="30">In 30 days</option></select></label>
        <label class="field"><span>Max uses</span><select class="select" id="plUses"><option value="">Unlimited</option><option value="1">1</option><option value="5">5</option><option value="10">10</option><option value="25">25</option></select></label>
      </div>
      <div class="row" style="flex-wrap:wrap"><button class="btn" type="button" id="plRegen">${i ? 'New code (old one stops working)' : 'Make an invite'}</button>${i ? '<button class="btn ghost danger-txt" type="button" id="plRevoke">Turn off invites</button>' : ''}</div>
    </details>` : ''}`;
  const copy = async (txt, what) => { try { await navigator.clipboard.writeText(txt); toast(`${what} copied.`); } catch { $('#plLink')?.select(); toast('Press Ctrl+C to copy.'); } };
  $('#plCopy')?.addEventListener('click', () => copy(link, 'Invite link'));
  $('#plCopyCode')?.addEventListener('click', () => copy(i.code, 'Code'));
  $('#plShare')?.addEventListener('click', () => navigator.share({ title: `Join ${lg.name}`, text: `Join my prediction league "${lg.name}" on Trash Talk Live. Code: ${i.code}`, url: link }).catch(() => {}));
  const manage = async (action) => {
    try {
      const r = await api(`/pl/leagues/${lg.id}/invite`, { method: 'POST', body: { action, expiresInDays: $('#plExp')?.value || null, maxUses: $('#plUses')?.value || null } });
      toast(action === 'revoke' ? 'Invites turned off.' : 'New invite ready. The old code no longer works.');
      paintInvite(lg, r);
    } catch (e) { toast(e.message, true); }
  };
  $('#plRegen')?.addEventListener('click', () => manage('regenerate'));
  $('#plRevoke')?.addEventListener('click', async () => { if (await plDialog({ title: 'Turn off invites?', html: '<p>The current code and link stop working right away. You can make a new one any time.</p>', ok: 'Turn off', danger: true })) manage('revoke'); });
}

// ---------- history / member profile ----------
async function paintLgProfile(l, el, mid) {
  el.innerHTML = '<div class="skeleton" style="height:300px"></div>';
  let d;
  try { d = await api(`/pl/leagues/${l.id}/members/${encodeURIComponent(mid)}`); } catch (e) { el.innerHTML = plError(e, false); return; }
  const m = d.member, r = d.row || {};
  const weeks = new Map();
  for (const p of d.picks) { if (!weeks.has(p.week)) weeks.set(p.week, []); weeks.get(p.week).push(p); }
  const wkPts = new Map((r.weekly || []).map((x) => [x.week, x.points]));
  el.innerHTML = `
    ${m.me ? '' : `<a class="back" href="#/predict/l/${esc(l.id)}/season">← Season standings</a>`}
    <section class="panel pl-profile">
      <span class="pl-av big">${esc(m.avatar)}</span>
      <div><h2>${esc(m.name)}${m.me ? ' <span class="muted">(you)</span>' : ''}</h2><small class="muted">${m.role === 'owner' ? '👑 League owner · ' : ''}joined ${esc(plDay(m.joinedAt))} · stats for this league only${m.me ? ' (see <a href="#/predict/me">all leagues</a>)' : ''}</small></div>
      <div class="pl-card-stats">
        <div><b>${plRank(r.rank, r.tied)}</b><span>rank</span></div><div><b>${r.points ?? 0}</b><span>points</span></div>
        <div><b>${r.correct ?? 0}-${r.incorrect ?? 0}</b><span>record</span></div><div><b>${plAcc(r.accuracy)}</b><span>accuracy</span></div><div><b>${r.missed ?? 0}</b><span>missed</span></div>
      </div>
    </section>
    ${d.hiddenNote ? `<p class="pl-note">🙈 ${esc(d.hiddenNote)}</p>` : ''}
    ${d.picks.length ? [...weeks].map(([w, ps]) => `<section class="panel"><h3>Week ${w ?? '?'} <small>${wkPts.has(w) ? `${wkPts.get(w)} pts` : ''}</small></h3>
      <ul class="pl-list">${ps.map((p) => `<li><span><b>${esc(p.game.away?.abbr)}${p.game.outcome ? ` ${p.game.away?.score ?? ''}` : ''} @ ${esc(p.game.home?.abbr)}${p.game.outcome ? ` ${p.game.home?.score ?? ''}` : ''}</b><small>${esc(plWhen(p.game.start))} · pick: ${esc(p.pick ? sideName(p.game, p.pick) : 'none')}${p.auto ? ' (auto)' : ''}</small></span>${plBadge(p.status, p.points ? ` +${p.points}` : '')}</li>`).join('')}</ul></section>`).join('')
      : `<div class="empty-state"><div class="big">📭</div><p>${m.me ? 'No picks yet. Your history builds up as you play.' : 'Nothing to show yet. Picks appear here once games lock.'}</p>${m.me ? `<a class="btn primary" href="#/predict/l/${esc(l.id)}/picks">Make picks</a>` : ''}</div>`}`;
}

// ---------- rules & settings ----------
function plRulesList(l, short = false) {
  const r = l.rules, s = l.settings;
  const items = [
    ...(l.scoring?.rules || []),
    r.picks === 'all' ? 'Every eligible game counts' : 'Only games you pick count',
    r.missed === 'home' ? 'Missed picks default to the home team' : null,
    'Picks lock at each game\'s scheduled start',
    l.sports.some((s) => s.sport === 'soccer') ? 'Soccer games have a Draw option' : null,
    l.sports.some((s) => s.sport !== 'soccer') ? 'A tie in a game without a Draw option is a push (no points either way)' : null,
    short ? null : (s.allowEdits ? 'You can change picks until they lock' : 'Picks are final once submitted'),
    short ? null : (s.picksVisible === 'always' ? 'Picks are visible to everyone right away' : 'Picks are hidden until each game locks'),
    short ? null : (r.ties === 'shared' ? 'Equal points share a rank' : 'Ties broken by correct picks, then fewer misses, then accuracy'),
  ].filter(Boolean);
  return `<ul class="pl-rules">${items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
}

async function paintLgSettings(l, el) {
  const cfg = await plConfig().catch(() => null);
  const own = l.perms.edit, locked = l.started;
  const opt = (name, opts, val, disabled) => `<select class="select" name="${name}" ${disabled ? 'disabled' : ''}>${opts.map(([v, t]) => `<option value="${v}" ${String(val) === String(v) ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>`;
  el.innerHTML = `<div class="layout">
    <div>
      <section class="panel"><h3>📜 How this league works</h3>
        <dl class="pl-dl">
          <dt>Format</dt><dd>${esc(l.formatLabel)}</dd>
          <dt>Scoring</dt><dd>${esc(l.scoring?.label)}</dd>
          <dt>Sports</dt><dd>${plSports(l)}</dd>
          <dt>Season</dt><dd>${esc(plDay(l.seasonStart))} – ${esc(plDay(l.seasonEnd - 1))} · ${pluralize(l.weeks, 'week')} (weeks start ${esc(new Date(l.seasonStart).toLocaleDateString([], { weekday: 'long' }))})</dd>
          <dt>Joining</dt><dd>${l.visibility === 'public' ? 'Public, listed in Discover' : 'Private, invite only'} · max ${l.settings.maxMembers} · ${l.settings.lateJoin ? 'late joins allowed' : 'no late joins'}</dd>
          <dt>Owner</dt><dd>${esc(l.ownerName || '–')}</dd>
        </dl>
        ${plRulesList(l)}
        <p class="muted pl-hint">Postponed games stay open for scoring and count once they're actually played. Canceled games aren't scored. If an official result gets corrected, standings update automatically.</p>
      </section>
      ${own ? `<section class="panel"><h3>⚙️ League settings <small>owner only</small></h3>
        <form id="plSettings" class="pl-form">
          <label class="field"><span>Name</span><input name="leagueName" value="${esc(l.name)}" maxlength="40" minlength="3" required></label>
          <label class="field"><span>Description</span><textarea name="description" maxlength="200" rows="2">${esc(l.description)}</textarea></label>
          <div class="pl-row2">
            <label class="field"><span>Visibility</span>${opt('visibility', [['private', '🔒 Private (invite only)'], ['public', '🌎 Public (in Discover)']], l.visibility)}</label>
            <label class="field"><span>Max members</span><input type="number" name="maxMembers" min="${Math.max(2, l.members)}" max="${cfg?.limits.maxMembers || 500}" value="${l.settings.maxMembers}"></label>
            <label class="field"><span>Changing picks</span>${opt('allowEdits', [['1', 'Allowed until lock'], ['0', 'First pick is final']], l.settings.allowEdits ? 1 : 0)}</label>
            <label class="field"><span>Others see picks</span>${opt('picksVisible', [['after_lock', 'After each game locks'], ['always', 'Right away']], l.settings.picksVisible)}</label>
            <label class="field"><span>Late joins</span>${opt('lateJoin', [['1', 'Allowed'], ['0', 'Not allowed']], l.settings.lateJoin ? 1 : 0)}</label>
            <label class="field"><span>Who can invite</span>${opt('membersCanInvite', [['1', 'Any member'], ['0', 'Only me']], l.settings.membersCanInvite ? 1 : 0)}</label>
          </div>
          <h4 class="pl-subh">Competition rules ${locked ? '<small class="muted">locked: the season has started</small>' : ''}</h4>
          <div class="pl-row2">
            <label class="field"><span>Which games count</span>${opt('picks', [['all', 'Every eligible game'], ['select', 'Only games you pick']], l.rules.picks, locked)}</label>
            <label class="field"><span>Missed picks</span>${opt('missed', [['zero', 'Score 0'], ['home', 'Default to home team']], l.rules.missed, locked)}</label>
            <label class="field"><span>Standings ties</span>${opt('ties', [['shared', 'Share the rank'], ['break', 'Break ties']], l.rules.ties, locked)}</label>
            <label class="field"><span>Format</span>${opt('format', Object.entries(cfg?.formats || { [l.format]: l.formatLabel }), l.format, locked)}</label>
          </div>
          <div class="row end"><button class="btn primary" type="submit">Save settings</button></div>
        </form></section>
      <section class="panel pl-danger"><h3>🗄️ Archive league</h3><p class="muted">Ends the league for everyone: no more picks, invites turn off, and standings are frozen as they are. This can't be undone.</p><button class="btn danger" type="button" id="plArchive" ${l.status === 'archived' ? 'disabled' : ''}>${l.status === 'archived' ? 'Archived' : 'Archive league'}</button></section>` : ''}
    </div>
    <aside class="side"><section class="panel"><h3>🛡️ Fair play</h3><ul class="pl-rules">
      <li>Deadlines are checked on the server against the data provider's current game status and start time. Changing your device clock won't help.</li>
      <li>Points come only from official final results, never from ESPN's win probabilities.</li>
      <li>Every result change is logged, and standings are recalculated from the picks, so nobody gets scored twice.</li>
    </ul></section></aside>
  </div>`;
  const f = $('#plSettings');
  if (f) f.onsubmit = async (e) => {
    e.preventDefault();
    const body = {
      leagueName: f.leagueName.value.trim(), description: f.description.value.trim(), visibility: f.visibility.value,
      settings: { maxMembers: Number(f.maxMembers.value), allowEdits: f.allowEdits.value === '1', picksVisible: f.picksVisible.value, lateJoin: f.lateJoin.value === '1', membersCanInvite: f.membersCanInvite.value === '1' },
    };
    if (!locked) { body.rules = { ...l.rules, picks: f.picks.value, missed: f.missed.value, ties: f.ties.value }; body.format = f.format.value; }
    try { await api(`/pl/leagues/${l.id}`, { method: 'PATCH', body }); toast('Settings saved.'); route(); }
    catch (err) { toast(err.message, true); }
  };
  $('#plArchive')?.addEventListener('click', async () => {
    if (!await plDialog({ title: `Archive ${l.name}?`, html: '<p>No more picks, invites turn off, and the standings freeze. This can\'t be undone.</p>', ok: 'Archive', danger: true })) return;
    try { await api(`/pl/leagues/${l.id}/archive`, { method: 'POST', body: {} }); toast('League archived.'); route(); }
    catch (err) { toast(err.message, true); }
  });
}

// =================================================================
// MY STATS (all leagues)
// =================================================================
async function renderPlStats() {
  const app = $('#app');
  app.innerHTML = '<a class="back" href="#/predict">← Prediction Leagues</a><div class="skeleton" style="height:320px"></div>';
  let d;
  try { d = await api('/pl/me/stats'); } catch (e) { app.innerHTML = plError(e); return; }
  const o = d.overall;
  const st = d.streak.current;
  const maxW = Math.max(1, ...d.byWeek.map((w) => w.correct + w.incorrect));
  app.innerHTML = `<a class="back" href="#/predict">← Prediction Leagues</a>
    <h1 class="hero-title">YOUR <span class="hl">PREDICTION</span> RECORD</h1>
    <p class="hero-sub">Every pick you've made, across every league, as ${esc(me.avatar)} ${esc(me.name)}. Only real picks and official results count.</p>
    ${!o.picks ? `<div class="empty-state"><div class="big">🔮</div><h2>No picks yet</h2><p>Your record starts with your first pick. Join or create a league to get going.</p><a class="btn primary" href="#/predict">Go to Prediction Leagues</a></div>` : `
    <div class="stats pl-stats">
      <div class="stat"><b>${o.picks}</b><span>picks made</span></div>
      <div class="stat"><b>${o.correct}-${o.incorrect}</b><span>right-wrong</span></div>
      <div class="stat"><b>${plAcc(o.accuracy)}</b><span>accuracy</span></div>
      <div class="stat ${st?.kind === 'correct' && st.length >= 3 ? 'hot' : ''}"><b>${st ? `${st.kind === 'correct' ? '🔥' : '🧊'} ${st.length}` : '–'}</b><span>current streak</span></div>
      <div class="stat"><b>${d.streak.best}</b><span>best streak</span></div>
    </div>
    ${o.pending ? `<p class="pl-note">⏳ ${pluralize(o.pending, 'pick')} waiting on results.${o.push || o.void ? ` ${o.push + o.void} pushed or voided.` : ''}</p>` : ''}
    <div class="pl-cols">
      <section class="panel"><h3>🏟️ By sport</h3>${d.bySport.length ? `<table class="lines pl-table compact"><thead><tr><th>Sport</th><th>Picks</th><th>W-L</th><th>Acc</th></tr></thead><tbody>${d.bySport.map((s) => `<tr><td>${s.emoji} ${esc(s.label)}</td><td>${s.picks}</td><td>${s.correct}-${s.incorrect}</td><td>${plAcc(s.accuracy)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">–</p>'}</section>
      <section class="panel"><h3>📈 Week by week <small>calendar weeks, Mon–Sun</small></h3>${d.byWeek.length ? `<ul class="pl-bars">${d.byWeek.slice(-12).map((w) => `<li><span>${esc(plDay(w.start))}</span><div class="pl-bar"><i class="c" style="width:${(w.correct / maxW) * 100}%"></i><i class="x" style="width:${(w.incorrect / maxW) * 100}%"></i></div><b>${w.correct}-${w.incorrect}</b></li>`).join('')}</ul>` : '<p class="muted">Weekly results appear once your picks are graded.</p>'}</section>
    </div>`}
    <section class="panel" style="margin-top:18px"><h3>🏆 By league <small>league-only numbers include misses</small></h3>
      ${d.leagues.length ? `<div class="table-scroll"><table class="lines pl-table"><thead><tr><th>League</th><th>Rank</th><th>Pts</th><th>✅</th><th>❌</th><th>⌛</th><th>Acc</th></tr></thead><tbody>${d.leagues.map((l) => `<tr><td><a href="#/predict/l/${esc(l.id)}">${esc(l.avatar)} ${esc(l.name)}</a> ${l.active ? '' : '<span class="muted">(left)</span>'}</td><td>${plRank(l.rank)} / ${l.of}</td><td class="tot">${l.points}</td><td>${l.correct}</td><td>${l.incorrect}</td><td>${l.missed}</td><td>${plAcc(l.accuracy)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">You\'re not in any leagues yet.</p>'}
    </section>`;
}

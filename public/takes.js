/* Takes: one home for every opinion and every bet.
   - Takes: the best takes from every game thread, with a composer that posts
     straight into a game's thread, and the threads heating up today.
   - Tail or Fade / My bets / Bad beats: the betting sections (bets.js).
   One sport switcher filters all four, and it lives in the URL
   (#/takes/<section>?sport=nba&sort=new) so every view can be shared.
   Loaded before app.js; uses its helpers at call time. */
'use strict';

const tk = { tab: 'takes', sport: 'all', sort: 'hot', money: false, leagues: [], heat: 'mild', board: null, boardAt: 0 };
const TK_TABS = [
  ['takes', 'Takes', ''],
  ['tailfade', 'Tail or Fade', '21+'],
  ['mybets', 'My bets', '21+'],
  ['badbeats', 'Bad beats', '21+'],
];
const TK_SORTS = [['hot', 'Hot'], ['new', 'New'], ['top', 'Top']];
const TK_PROMPTS = [
  'Say it with your chest. Pick a game first.',
  'Bold prediction? It goes in the thread forever.',
  'Who is the fraud tonight? Explain yourself.',
  'Lock of the night. Receipts will be kept.',
];

const tkLeagueLabel = (k) => tk.leagues.find((l) => l.key === k)?.label || String(k || '').toUpperCase();

function tkReadParams() {
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  const sport = q.get('sport');
  tk.sport = sport && tk.leagues.some((l) => l.key === sport) ? sport : 'all';
  tk.sort = TK_SORTS.some(([k]) => k === q.get('sort')) ? q.get('sort') : 'hot';
  tk.money = q.get('money') === '1';
}

// Build a Takes URL from the current state plus overrides.
function tkHref(tab = tk.tab, over = {}) {
  const s = { sport: tk.sport, sort: tk.sort, money: tk.money, ...over };
  const q = new URLSearchParams();
  if (s.sport !== 'all') q.set('sport', s.sport);
  if (tab === 'takes' && s.sort !== 'hot') q.set('sort', s.sort);
  if (tab === 'takes' && s.money) q.set('money', '1');
  const qs = q.toString();
  return `#/takes${tab === 'takes' ? '' : `/${tab}`}${qs ? `?${qs}` : ''}`;
}

async function renderTakes(sub) {
  tk.tab = TK_TABS.some(([k]) => k === sub) ? sub : 'takes';
  const app = $('#app');
  app.innerHTML = '<div class="page-head"><h1 class="hero-title">Takes</h1></div><div class="skeleton" style="height:320px"></div>';
  if (!tk.leagues.length) tk.leagues = await api('/leagues').catch(() => []);
  tkReadParams();
  app.innerHTML = `
    <div class="page-head tk-head"><h1 class="hero-title">Takes</h1>
      <p class="hero-sub">Hot takes, shared bets and bad beats from every game. Pick a sport, then pick a side.</p></div>
    <nav class="tk-tabs" aria-label="Takes sections">${TK_TABS.map(([k, l, tag]) => `<a class="tk-tab" href="${tkHref(k)}" ${k === tk.tab ? 'aria-current="page"' : ''}>${l}${tag ? `<small>${tag}</small>` : ''}</a>`).join('')}</nav>
    <div class="chips tk-sports" role="group" aria-label="Sport">
      <a class="chip" href="${tkHref(tk.tab, { sport: 'all' })}" aria-pressed="${tk.sport === 'all'}" data-sport="all">All sports <span class="count"></span></a>
      ${tk.leagues.map((l) => `<a class="chip" href="${tkHref(tk.tab, { sport: l.key })}" aria-pressed="${tk.sport === l.key}" data-sport="${esc(l.key)}">${esc(l.label)} <span class="count"></span></a>`).join('')}
    </div>
    <div id="tkBody"></div>`;
  if (tk.tab === 'takes') return renderTakeFeed();
  return renderBetsSection(tk.tab, tk.sport);
}

// ---------- takes section ----------
function renderTakeFeed() {
  const body = $('#tkBody');
  body.innerHTML = `<div class="layout tk-layout">
    <div>
      <section class="panel tk-compose">
        <h3>Drop a take <small>it posts to that game's thread</small></h3>
        <label class="tk-gamepick"><span class="muted">Game</span><select class="select" id="tkGame" aria-label="Game to post in"><option>Loading today's games…</option></select></label>
        <div class="composer">
          <textarea id="tkText" maxlength="500" placeholder="${esc(rand(TK_PROMPTS))}" aria-label="Your take"></textarea>
          <div class="composer-foot">
            <div class="heat tk-heat" role="group" aria-label="Take temperature">
              ${['mild', 'spicy', 'nuclear'].map((h) => `<button type="button" data-heat="${h}" aria-pressed="${tk.heat === h}">${h[0].toUpperCase() + h.slice(1)}</button>`).join('')}
            </div>
            <span class="counter" id="tkCounter">0/500</span>
            <button class="btn primary" id="tkPost" type="button">Post take</button>
          </div>
          <div class="posting-as" style="margin-top:8px">Posting as ${esc(me.avatar)} <b>${esc(me.name)}</b> · <button type="button" id="tkChangeMe">change</button></div>
        </div>
      </section>
      <div class="tk-feedbar">
        <div class="chips" role="group" aria-label="Sort takes">${TK_SORTS.map(([k, l]) => `<a class="chip" href="${tkHref('takes', { sort: k })}" aria-pressed="${tk.sort === k}">${l}</a>`).join('')}</div>
        <a class="chip tk-money" href="${tkHref('takes', { money: !tk.money })}" aria-pressed="${tk.money}" title="Only takes from fans who shared a real bet on that game">💸 Money on it</a>
        <span class="spacer"></span>
        <span class="muted tk-count" id="tkCount" aria-live="polite"></span>
      </div>
      <div class="tk-feed" id="tkFeed"><div class="skeleton" style="height:240px"></div></div>
    </div>
    <aside class="side">
      <section class="panel"><h3>Threads heating up <small>today</small></h3><div id="tkThreads"><div class="skeleton" style="height:160px"></div></div></section>
      <section class="panel tk-betside"><h3>On the betting side <small>21+</small></h3>
        <a class="tk-jump" href="${tkHref('tailfade')}"><b>Tail or Fade</b><span>Bets fans shared. The crowd votes.</span></a>
        <a class="tk-jump" href="${tkHref('mybets')}"><b>My bets</b><span>Link a book and sweat every leg live.</span></a>
        <a class="tk-jump" href="${tkHref('badbeats')}"><b>Bad beats</b><span>Lost by the hook. Immortalized.</span></a>
      </section>
      <section class="panel tk-betside"><h3>All-time</h3>
        <a class="tk-jump" href="#/hall"><b>Hall of Takes</b><span>The hottest takes ever, the prophets, the clowns.</span></a>
      </section>
    </aside>
  </div>`;

  const ta = $('#tkText');
  ta.oninput = () => { $('#tkCounter').textContent = `${ta.value.length}/500`; };
  ta.onkeydown = (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) $('#tkPost').click(); };
  $('.tk-heat').onclick = (e) => {
    const b = e.target.closest('[data-heat]'); if (!b) return;
    tk.heat = b.dataset.heat; $$('.tk-heat button').forEach((x) => x.setAttribute('aria-pressed', x === b));
    if (tk.heat === 'nuclear') toast('Nuclear take armed. Proceed with caution.');
  };
  $('#tkPost').onclick = postHubTake;
  $('#tkChangeMe').onclick = openMeDialog;
  $('#tkFeed').onclick = onHubTakeClick;

  loadTakeFeed();
  loadHubBoard();
  every(() => loadTakeFeed(true), 30000);
  every(() => loadHubBoard(true), 60000);
}

async function loadTakeFeed(quiet = false) {
  const el = $('#tkFeed'); if (!el) return;
  const q = new URLSearchParams({ sort: tk.sort });
  if (tk.sport !== 'all') q.set('league', tk.sport);
  if (tk.money) q.set('money', '1');
  let d;
  try { d = await api(`/takes?${q}`); }
  catch (e) { if (!quiet) el.innerHTML = `<div class="empty-state"><p>${esc(e.message)}</p><button class="btn primary" type="button" data-retry>Try again</button></div>`; return; }
  if (!$('#tkFeed')) return;
  // Sport chip counts (root takes per league).
  for (const chip of $$('.tk-sports [data-sport]')) {
    const k = chip.dataset.sport, n = k === 'all' ? d.all : d.counts[k] || 0;
    $('.count', chip).textContent = n || '';
    chip.classList.toggle('empty', !n && k !== 'all');
  }
  $('#tkCount').textContent = `${d.total} take${d.total === 1 ? '' : 's'}${tk.sport !== 'all' ? ` in ${tkLeagueLabel(tk.sport)}` : ''}`;
  if (quiet && document.activeElement?.closest?.('#tkFeed')) return; // don't repaint under someone's cursor
  el.innerHTML = d.takes.length ? d.takes.map(hubTakeHTML).join('')
    : `<div class="empty-state"><p>${tk.money ? 'Nobody has put money behind a take here yet.' : `No takes${tk.sport !== 'all' ? ` in ${esc(tkLeagueLabel(tk.sport))}` : ''} yet. Pick a game above and be the first.`}</p></div>`;
}

function hubTakeHTML(c) {
  const heat = { mild: 'Mild', spicy: 'Spicy', nuclear: 'Nuclear' }[c.heat] || '';
  const [league, id] = c.gameKey.split(':');
  const tag = (c.fire >= 3 && c.fire >= c.cap * 3 ? '<span class="ratio">Verified hot</span>'
    : c.cap >= 3 && c.cap > c.fire * 2 ? '<span class="ratio clown">Ratio\'d</span>' : '')
    + (c.receipt ? '<span class="ratio receipt" title="This fan shared a real bet on this game">Put money on it</span>' : '');
  const thread = `#/game/${esc(league)}/${esc(id)}`;
  return `<article class="take tk-take ${esc(c.heat)}" data-id="${esc(c.id)}">
    <div class="av" aria-hidden="true">${esc(c.avatar || '🙂')}</div>
    <div class="take-body">
      <div class="take-meta"><b>${esc(c.name)}</b>${c.mine ? '<span class="muted">(you)</span>' : ''}<span class="heat-tag ${esc(c.heat)}">${heat}</span>${tag}<span class="t">${ago(c.createdAt)}</span></div>
      <a class="tk-game" href="${thread}"><span class="tk-lg">${esc(tkLeagueLabel(league))}</span>${esc(String(c.gameLabel || '').replace(/\s*\([^)]*\)\s*$/, ''))}</a>
      <p class="take-text">${esc(c.text)}</p>
      <div class="take-actions">
        <button class="tact fire" data-act="fire" aria-pressed="${c.myVote === 'fire'}" title="This take is fire">🔥 ${c.fire}</button>
        <button class="tact cap" data-act="cap" aria-pressed="${c.myVote === 'cap'}" title="This take is cap">🧢 ${c.cap}</button>
        <a class="tact" href="${thread}">${c.replies ? `${c.replies} repl${c.replies === 1 ? 'y' : 'ies'}` : 'Reply'} in thread</a>
      </div>
    </div>
  </article>`;
}

async function onHubTakeClick(e) {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const art = b.closest('.tk-take'), id = art.dataset.id, act = b.dataset.act;
  try {
    const upd = await api(`/comments/${id}/vote`, { method: 'POST', body: { kind: act } });
    $('.tact.fire', art).textContent = `🔥 ${upd.fire}`; $('.tact.fire', art).setAttribute('aria-pressed', upd.myVote === 'fire');
    $('.tact.cap', art).textContent = `🧢 ${upd.cap}`; $('.tact.cap', art).setAttribute('aria-pressed', upd.myVote === 'cap');
    if (upd.myVote) { const r = b.getBoundingClientRect(); floatEmoji(act === 'fire' ? '🔥' : '🧢', r.left + r.width / 2, r.top); }
  } catch (err) { toast(err.message, true); }
}

// Today's games: the composer's game picker and the "heating up" list.
async function loadHubBoard(quiet = false) {
  if (!tk.board || Date.now() - tk.boardAt > 30000) {
    try { tk.board = (await api(`/scoreboard?league=all&date=${ymd(new Date())}`)).games; tk.boardAt = Date.now(); }
    catch (e) {
      if (!quiet && $('#tkThreads')) $('#tkThreads').innerHTML = `<p class="muted">${esc(e.message)}</p>`;
      if (!quiet && $('#tkGame')) { $('#tkGame').innerHTML = '<option value="">Couldn\'t load today\'s games</option>'; $('#tkPost').disabled = true; }
      return;
    }
  }
  if (!$('#tkThreads')) return;
  const order = { in: 0, pre: 1, post: 2 };
  const games = tk.board.filter((g) => g.home && g.away && (tk.sport === 'all' || g.league === tk.sport));
  const label = (g) => `${tk.sport === 'all' ? `${g.leagueLabel} · ` : ''}${g.away.abbr} @ ${g.home.abbr}${g.status.state === 'in' ? ' (live)' : g.status.state === 'post' ? ' (final)' : ` · ${fmtTime(g.date)}`}`;

  const sel = $('#tkGame');
  if (sel && !(quiet && document.activeElement === sel)) {
    const keep = sel.value;
    const byState = [...games].sort((x, y) => order[x.status.state] - order[y.status.state] || new Date(x.date) - new Date(y.date));
    sel.innerHTML = byState.length ? byState.map((g) => `<option value="${esc(g.league)}/${esc(g.id)}">${esc(label(g))}</option>`).join('')
      : `<option value="">No ${tk.sport === 'all' ? '' : `${esc(tkLeagueLabel(tk.sport))} `}games today</option>`;
    if (keep && byState.some((g) => `${g.league}/${g.id}` === keep)) sel.value = keep;
    sel.disabled = !byState.length; $('#tkPost').disabled = !byState.length;
  }

  const hot = [...games].sort((x, y) => y.takeCount - x.takeCount || order[x.status.state] - order[y.status.state] || y.vibe.chaos - x.vibe.chaos).slice(0, 8);
  $('#tkThreads').innerHTML = hot.length ? `<ul class="tk-threads">${hot.map((g) => {
    const sc = g.status.state === 'pre' ? '' : ` <b>${esc(g.away.score ?? 0)}-${esc(g.home.score ?? 0)}</b>`;
    return `<li><a href="#/game/${esc(g.league)}/${esc(g.id)}"><span class="tk-lg">${esc(g.leagueLabel)}</span><span class="tk-match">${esc(g.away.abbr)} @ ${esc(g.home.abbr)}${sc}</span>${statusLabel(g)}<small>${g.takeCount} take${g.takeCount === 1 ? '' : 's'}</small></a></li>`;
  }).join('')}</ul>`
    : `<p class="muted">No ${tk.sport === 'all' ? '' : `${esc(tkLeagueLabel(tk.sport))} `}games today. The threads from earlier games are still in the feed.</p>`;
}

async function postHubTake() {
  const ta = $('#tkText'), btn = $('#tkPost'), sel = $('#tkGame');
  const text = ta.value.trim();
  if (!sel.value) return toast('Pick a game first. Takes live in game threads.', true);
  if (text.length < 2) return toast('Say something! Even "booo" counts.', true);
  const [league, id] = sel.value.split('/');
  btn.disabled = true;
  try {
    await api(`/game/${league}/${id}/comments`, { method: 'POST', body: { text, heat: tk.heat } });
    ta.value = ''; ta.oninput();
    confetti(tk.heat === 'nuclear' ? 200 : 70, tk.heat === 'nuclear' ? ['#ff4d6d', '#ff9f1c', '#ffd23f'] : undefined);
    toast(rand(['Take posted. The people will judge.', 'Bold words. Bookmarked for later.', 'Your take is live. No refunds.']));
    if (tk.sort !== 'new') location.hash = tkHref('takes', { sort: 'new', money: false });
    else loadTakeFeed();
  } catch (e) { toast(e.message, true); }
  finally { btn.disabled = false; }
}

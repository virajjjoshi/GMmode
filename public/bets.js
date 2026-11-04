/* Bets: link a sportsbook (via SharpSports, or the Demo Book), then sweat your
   bets live, share them for Tail or Fade, and enshrine your bad beats.
   Loaded before app.js; uses its helpers at call time. */
'use strict';

const bt = { action: null, actionAt: 0, view: null, config: null, tab: 'sweat' };
const BT_TABS = [['sweat', '🫠 My Sweat'], ['feed', '🗳️ Tail or Fade'], ['hall', '🪦 Bad Beat Hall of Fame']];

const usd = (cents, sign = false) => {
  const v = Math.abs(cents || 0) / 100;
  const s = v >= 1000 ? v.toLocaleString(undefined, { maximumFractionDigits: 0 }) : v.toFixed(v % 1 ? 2 : 0);
  return `${sign ? (cents > 0 ? '+' : cents < 0 ? '−' : '') : ''}$${s}`;
};

// Your open action keyed "league:id", cached 20s. Used by game cards and live rooms.
async function loadBetAction(force = false) {
  if (!store.get('ttl:bets', null)?.linked) { bt.action = null; return; }
  if (!force && bt.action && Date.now() - bt.actionAt < 20000) return;
  try { bt.action = (await api('/bets/action')).games; bt.actionAt = Date.now(); } catch { bt.action = null; }
}

function betChip(g) {
  const mine = bt.action?.[`${g.league}:${g.id}`];
  if (!mine?.length) return '';
  const first = mine[0];
  const cls = mine.some((m) => m.oneLegAway) ? 'bad' : first.status === 'winning' ? 'good' : first.status === 'losing' ? 'bad' : '';
  return `<div class="bt-chip ${cls}" title="Your open bets on this game (only you can see this)">💸 ${mine.length > 1 ? `${mine.length} bets` : 'Your action'}: <b>${esc(first.label)}</b>${first.text && g.status.state !== 'pre' ? ` · ${esc(first.text)}` : ''}${mine.some((m) => m.oneLegAway) ? ' · 🚨 ONE LEG AWAY' : ''}</div>`;
}

const mood = (p) => p >= 0.85 ? '🧊 Ice cold' : p >= 0.6 ? '😌 Comfy' : p >= 0.4 ? '😬 Sweating' : p >= 0.15 ? '🫠 Melting' : '💀 Start the eulogy';
function sweatMeter(p, label = 'Chance to cash') {
  const pct = Math.round(p * 100);
  return `<div class="sweat" style="--p:${pct}%;--h:${Math.round(p * 125)}"><div class="sweat-top"><span>${label}</span><b>${pct}% · ${mood(p)}</b></div><div class="sweat-bar"><i></i></div></div>`;
}

// ---------- page ----------
async function renderBets(sub) {
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  bt.tab = BT_TABS.some(([k]) => k === sub) ? sub : 'sweat';
  const app = $('#app');
  app.innerHTML = `<h1 class="hero-title">BETS, BUT <span class="hl">BRUTALLY HONEST</span></h1>
    <p class="hero-sub">Link your sportsbook and sweat every bet live. Share one for the crowd to tail or fade, and immortalize your worst beats.</p>
    <div id="bt"></div>
    <p class="bt-rg">21+ only. Read-only tracking: we never take, place, or hold bets. Bets are private unless you share one. If betting stops being fun, call <a href="tel:18004264237">1-800-GAMBLER</a>.</p>`;
  if (q.get('linked')) toast('Sportsbook linked. Your bets will show up after the first sync.');
  if (!bt.config) bt.config = await api('/bets/config').catch(() => ({ sharpsports: false, books: [] }));
  try { bt.view = await api('/bets/me'); } catch (e) { $('#bt').innerHTML = `<div class="empty-state"><div class="big">🧯</div><p>${esc(e.message)}</p></div>`; return; }
  if (!bt.view.account?.age21) return paintAgeGate();
  paintBets();
  every(async () => {
    if (bt.tab === 'sweat' && bt.view?.slips?.some((s) => s.live)) { bt.view = await api('/bets/me').catch(() => bt.view); paintSweat(); }
    if (bt.tab === 'feed') paintFeed(true);
  }, 20000);
}

function paintAgeGate() {
  $('#bt').innerHTML = `<section class="panel bt-gate">
    <div class="big">🔞</div>
    <h3>Quick check: are you 21 or older?</h3>
    <p class="muted">Sports betting is 21+ in most US states. This section tracks real-money bets, so we have to ask.</p>
    <div class="row"><button class="btn primary" id="btYes">Yes, I'm 21+</button><button class="btn ghost" id="btNo">No</button></div>
  </section>`;
  $('#btYes').onclick = async () => {
    try { await api('/bets/age', { method: 'POST', body: { confirm: true } }); renderBets(bt.tab); }
    catch (e) { toast(e.message, true); }
  };
  $('#btNo').onclick = () => { $('#bt').innerHTML = '<div class="empty-state"><div class="big">🎂</div><p>Come back on your 21st birthday. We\'ll save you a seat. The rest of the site is all yours, though.</p><a class="btn primary" href="#/">Back to the scores</a></div>'; };
}

function paintBets() {
  const linked = bt.view.account?.links?.length > 0;
  store.set('ttl:bets', { linked });
  $('#bt').innerHTML = `
    <div class="chips bt-tabs" role="tablist" aria-label="Bets sections">${BT_TABS.map(([k, l]) => `<a class="chip" role="tab" href="#/bets/${k}" aria-pressed="${k === bt.tab}" aria-selected="${k === bt.tab}">${l}</a>`).join('')}</div>
    <div id="btBody"></div>`;
  if (bt.tab === 'feed') return paintFeed();
  if (bt.tab === 'hall') return paintHall();
  if (!linked) return paintBookConnect();
  paintSweat();
}

// ---------- connect ----------
function paintBookConnect(extra = false) {
  const real = bt.config.sharpsports;
  const html = `<section class="panel bt-connect">
    <h3>🔗 Connect a sportsbook</h3>
    <div class="bt-books">${bt.config.books.map((b) => `<button class="bt-book" ${real ? '' : 'disabled'} data-book="${esc(b)}">${esc(b)}</button>`).join('')}</div>
    <p class="muted bt-note">${real
      ? 'You\'ll log in on SharpSports\' secure page and pick your state and book. We never see your sportsbook password, and we can\'t place bets.'
      : '🔧 Real sportsbook linking (via <b>SharpSports</b>, think Plaid but for sportsbooks) switches on as soon as we add our API keys. Until then, take the Demo Book for a spin.'}</p>
    <div class="bt-demo">
      <div><b>🧪 Demo Book</b><small>A pretend sportsbook with bets on tonight's real games at real DraftKings lines, plus a sample history (with a couple of very painful beats).</small></div>
      <button class="btn primary" id="btDemo">Connect the Demo Book</button>
    </div>
  </section>`;
  if (extra) return html;
  $('#btBody').innerHTML = html;
  wireConnect();
}

function wireConnect() {
  $$('.bt-book:not([disabled])').forEach((b) => {
    b.onclick = async () => {
      b.disabled = true; b.textContent = 'Opening…';
      try { const { url } = await api('/bets/link', { method: 'POST', body: { provider: 'sharpsports' } }); location.href = url; }
      catch (e) { toast(e.message, true); b.disabled = false; b.textContent = b.dataset.book; }
    };
  });
  const demo = $('#btDemo');
  if (demo) demo.onclick = async () => {
    demo.disabled = true; demo.textContent = 'Placing some questionable bets…';
    try {
      bt.view = await api('/bets/link', { method: 'POST', body: { provider: 'demo' } });
      store.set('ttl:bets', { linked: true }); bt.action = null;
      toast('Demo Book connected. Let the sweating begin.');
      paintBets();
    } catch (e) { toast(e.message, true); demo.disabled = false; demo.textContent = 'Connect the Demo Book'; }
  };
}

// ---------- my sweat ----------
function paintSweat() {
  const body = $('#btBody'); if (!body || bt.tab !== 'sweat') return;
  const v = bt.view, s = v.stats;
  const open = v.slips.filter((x) => !x.outcome), settled = v.slips.filter((x) => x.outcome);
  const hasDemo = v.account.links.some((l) => l.provider === 'demo');
  const hasReal = v.account.links.some((l) => l.provider === 'sharpsports');
  body.innerHTML = `
    <div class="bt-links">${v.account.links.map((l) => `<span class="bt-link">${l.provider === 'demo' ? '🧪' : '🔗'} ${esc(l.book)} <small>linked</small><button class="linkish" data-unlink="${esc(l.provider)}">disconnect</button></span>`).join('')}
      <button class="btn ghost" id="btSync">↻ Sync</button>${hasReal ? '' : '<button class="btn ghost" id="btAdd">+ Add a sportsbook</button>'}</div>
    <div id="btAddBox"></div>
    <div class="bt-stats">
      <div><b>${s.w}-${s.l}${s.p ? `-${s.p}` : ''}</b><span>Record</span></div>
      <div class="${s.net > 0 ? 'good' : s.net < 0 ? 'bad' : ''}"><b>${usd(s.net, true)}</b><span>Net</span></div>
      <div><b>${(s.roi * 100).toFixed(1)}%</b><span>ROI</span></div>
      <div><b>${usd(s.openRisk)} → ${usd(s.openToWin + s.openRisk)}</b><span>${s.open} open</span></div>
    </div>
    <section class="panel bt-therapist"><h3>🛋️ The Bet Therapist <small>${hasDemo ? 'Demo Book data' : 'updated daily'}</small></h3>
      <ul>${v.therapist.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></section>
    <h2 class="league-head">🫠 Live &amp; open <small class="muted">${open.length}</small></h2>
    ${open.length ? `<div class="bt-grid">${open.map((x) => slipHTML(x, { own: true })).join('')}</div>` : '<div class="empty-state bt-empty"><p>No open bets. Your blood pressure thanks you.</p></div>'}
    <h2 class="league-head">📜 Settled <small class="muted">${settled.length}</small></h2>
    ${settled.length ? `<div class="bt-grid">${settled.map((x) => slipHTML(x, { own: true })).join('')}</div>` : '<div class="empty-state bt-empty"><p>Nothing settled yet.</p></div>'}`;
  wireSlips(body);
  $('#btSync').onclick = async (e) => {
    e.target.disabled = true;
    try { bt.view = await api('/bets/sync', { method: 'POST', body: {} }); bt.action = null; paintSweat(); toast('Synced.'); }
    catch (err) { toast(err.message, true); e.target.disabled = false; }
  };
  const add = $('#btAdd');
  if (add) add.onclick = () => { $('#btAddBox').innerHTML = paintBookConnect(true); $('#btDemo')?.closest('.bt-demo')?.remove(); wireConnect(); add.remove(); };
  $$('[data-unlink]', body).forEach((b) => {
    b.onclick = async () => {
      if (!confirm('Disconnect this account? Its bets will be removed from Trash Talk Live.')) return;
      await api('/bets/unlink', { method: 'POST', body: { provider: b.dataset.unlink } }).catch(() => {});
      bt.action = null; renderBets('sweat');
    };
  });
}

function legHTML(l) {
  const dot = l.result === 'win' ? 'win' : l.result === 'loss' ? 'loss' : l.result ? 'push' : l.status === 'winning' ? 'winning' : l.status === 'losing' ? 'losing' : l.state === 'in' ? 'push' : 'pending';
  const liveLink = l.state === 'in' && l.gameId ? `<a class="bt-live" href="#/live/${esc(l.league)}/${esc(l.gameId)}">🔴 Live room</a>` : '';
  return `<li class="bt-leg ${dot}"><span class="bt-dot" aria-hidden="true"></span>
    <span class="bt-leg-main"><b>${esc(l.label)}</b> <small class="muted">${esc(l.event || '')}${l.odds && l.odds !== -110 ? ` · ${l.odds > 0 ? '+' : ''}${esc(l.odds)}` : ''}</small><br><small>${esc(l.text || (l.result ? l.result.toUpperCase() : ''))}</small></span>${liveLink}</li>`;
}

function slipHTML(x, { own = false, social = null } = {}) {
  const head = x.type === 'parlay' ? `Parlay · ${x.legs.length} legs` : 'Single';
  const result = x.outcome === 'win' ? `<div class="bt-result win">💰 CASHED ${usd(x.net, true)}</div>`
    : x.outcome === 'loss' ? `<div class="bt-result loss">🪦 ${usd(x.net, true)}</div>`
      : x.outcome ? `<div class="bt-result">↩️ ${esc(x.outcome.toUpperCase())}</div>` : sweatMeter(x.p);
  const shareRow = own ? `<div class="bt-actions">
      ${!x.outcome ? `<button class="chip" data-share="tailfade" data-on="${x.shared?.tailfade ? 0 : 1}" data-id="${esc(x.id)}" aria-pressed="${!!x.shared?.tailfade}">${x.shared?.tailfade ? '✅ Shared for Tail or Fade' : '🗳️ Share for Tail or Fade'}</button>` : ''}
      ${x.badBeat ? `<button class="chip" data-share="hall" data-on="${x.shared?.hall ? 0 : 1}" data-id="${esc(x.id)}" aria-pressed="${!!x.shared?.hall}">${x.shared?.hall ? '🪦 In the Hall of Fame' : '🪦 Submit to Hall of Fame'}</button>` : ''}
    </div>` : '';
  return `<article class="bt-slip ${x.oneLegAway ? 'one-leg' : ''} ${x.outcome ? `done ${x.outcome}` : ''} ${x.live ? 'live' : ''}">
    ${social ? `<div class="bt-fan">${esc(social.avatar)} ${social.sim ? '<span class="sim-tag">SIM</span>' : ''}<b>${esc(social.name)}</b>${social.mine ? ' <span class="muted">(you)</span>' : ''}</div>` : ''}
    <div class="bt-head"><span>${esc(x.book?.name || 'Sportsbook')} · ${head}</span><span class="bt-odds">${esc(x.oddsText)}</span></div>
    <div class="bt-stake">${usd(x.atRisk)} to win <b>${usd(x.toWin)}</b>${x.live ? ' <span class="status live"><span class="dot"></span>LIVE</span>' : ''}</div>
    ${x.oneLegAway ? '<div class="bt-oneleg">🚨 ONE LEG AWAY 🚨</div>' : ''}
    ${result}
    <ul class="bt-legs">${x.legs.map(legHTML).join('')}</ul>
    ${x.badBeat ? `<p class="bt-roast">🪦 ${esc(x.badBeatLine)}</p>` : ''}
    ${shareRow}
  </article>`;
}

function wireSlips(root) {
  $$('[data-share]', root).forEach((b) => {
    b.onclick = async () => {
      try {
        await api('/bets/share', { method: 'POST', body: { slipId: b.dataset.id, where: b.dataset.share, on: b.dataset.on === '1' } });
        const on = b.dataset.on === '1';
        toast(b.dataset.share === 'hall' ? (on ? 'Enshrined. The Hall of Fame thanks you for your sacrifice.' : 'Removed from the Hall.') : (on ? 'Shared. The crowd will now judge you.' : 'Unshared. Back to private.'));
        bt.view = await api('/bets/me'); paintSweat();
      } catch (e) { toast(e.message, true); }
    };
  });
}

// ---------- tail or fade ----------
async function paintFeed(quiet = false) {
  const body = $('#btBody'); if (!body) return;
  if (!quiet) body.innerHTML = '<div class="skeleton" style="height:320px"></div>';
  let d;
  try { d = await api('/bets/feed'); } catch (e) { if (!quiet) body.innerHTML = `<div class="empty-state"><p>${esc(e.message)}</p></div>`; return; }
  if (bt.tab !== 'feed' || !$('#btBody')) return;
  const item = (x) => {
    const tot = x.tails + x.fades;
    const tp = tot ? Math.round((x.tails / tot) * 100) : 50;
    const canVote = !x.fan.mine && !x.outcome;
    return `<div class="bt-feed-item">${slipHTML(x, { social: x.fan })}
      <div class="bt-vote">
        <div class="bt-tf"><span>👍 Tail ${x.tails}</span><div class="bt-tf-bar" style="--t:${tp}%"><i></i></div><span>Fade ${x.fades} 👎</span></div>
        <p class="muted">${esc(x.crowd)}</p>
        ${canVote ? `<div class="row"><button class="btn ${x.myVote === 'tail' ? 'primary' : ''}" data-vote="tail" data-id="${esc(x.id)}">👍 Tail</button><button class="btn ${x.myVote === 'fade' ? 'primary' : ''}" data-vote="fade" data-id="${esc(x.id)}">👎 Fade</button></div>` : x.outcome ? '<p class="muted">Settled. Votes are locked.</p>' : '<p class="muted">Your bet. The crowd decides.</p>'}
      </div></div>`;
  };
  body.innerHTML = `<div class="bt-feed-wrap">
    <div>${d.items.length ? d.items.map(item).join('') : '<div class="empty-state"><div class="big">🗳️</div><p>No shared bets yet. Share one from My Sweat and let the people decide.</p></div>'}</div>
    <aside>
      <section class="panel"><h3>🙃 Fade these people <small>betting against them</small></h3>
        ${d.fadeBoard.length ? `<ol class="bt-board">${d.fadeBoard.map((r) => `<li>${esc(r.fan.avatar)} ${r.fan.sim ? '<span class="sim-tag">SIM</span>' : ''}<span>${esc(r.fan.name)}</span><b>${esc(r.fadeRecord)}</b></li>`).join('')}</ol><p class="muted bt-small">Record you'd have by betting against everything they shared.</p>` : '<p class="muted">Needs a few settled bets first.</p>'}</section>
      <section class="panel"><h3>🔮 Crowd callers <small>right · wrong</small></h3>
        ${d.callers.length ? `<ol class="bt-board">${d.callers.map((r) => `<li>${esc(r.fan.avatar || '🎟️')} ${r.fan.sim ? '<span class="sim-tag">SIM</span>' : ''}<span>${esc(r.fan.name)}${r.fan.mine ? ' (you)' : ''}</span><b>${r.right}-${r.wrong}</b></li>`).join('')}</ol>` : '<p class="muted">No settled votes yet.</p>'}</section>
    </aside></div>`;
  $$('[data-vote]', body).forEach((b) => {
    b.onclick = async () => {
      try { await api('/bets/vote', { method: 'POST', body: { slipId: b.dataset.id, side: b.dataset.vote } }); toast(b.dataset.vote === 'tail' ? 'Tailed. Riding together, crying together.' : 'Faded. Cold. Calculated. Correct?'); paintFeed(true); }
      catch (e) { toast(e.message, true); }
    };
  });
}

// ---------- bad beat hall of fame ----------
async function paintHall() {
  const body = $('#btBody');
  body.innerHTML = '<div class="skeleton" style="height:320px"></div>';
  let d;
  try { d = await api('/bets/hall'); } catch (e) { body.innerHTML = `<div class="empty-state"><p>${esc(e.message)}</p></div>`; return; }
  if (!d.items.length) { body.innerHTML = '<div class="empty-state"><div class="big">🪦</div><p>The Hall is empty. Lose a bet by half a point and you could be first.</p></div>'; return; }
  body.innerHTML = `<p class="muted">Lost by the hook, or a parlay that died on the last leg. Submitted by the victims themselves.</p>
    <ol class="bt-hall">${d.items.map((x, i) => `<li class="bt-plaque">
      <div class="bt-rank">${i < 3 ? ['🥇', '🥈', '🥉'][i] : `#${i + 1}`}</div>
      <div class="bt-plaque-body">
        <div class="bt-fan">${esc(x.fan.avatar)} ${x.fan.sim ? '<span class="sim-tag">SIM</span>' : ''}<b>${esc(x.fan.name)}</b>${x.fan.mine ? ' <span class="muted">(you)</span>' : ''} <span class="muted">· ${esc(x.badBeat.kind === 'one-leg' ? `${x.legs.length}-leg parlay, one leg short` : `lost by ${x.badBeat.miss}`)} · would've won ${usd(x.toWin)}</span></div>
        <p class="bt-roast">${esc(x.badBeatLine)}</p>
        <ul class="bt-legs">${x.legs.map(legHTML).join('')}</ul>
      </div></li>`).join('')}</ol>`;
}

// ---------- live room panel ----------
// Your bets on the game in this live room, refreshed every 15s while you're here.
function paintBetsLive() {
  const key = `${lv.league}:${lv.id}`;
  const fill = async (force) => {
    if (`${lv.league}:${lv.id}` !== key) return false;
    await loadBetAction(force);
    const mine = bt.action?.[key];
    const panel = $('#btPanel'); if (!panel) return false;
    if (!mine?.length) { panel.hidden = true; return true; }
    panel.hidden = false;
    $('#btLive').innerHTML = mine.map((m) => `<div class="bt-live-row ${m.oneLegAway ? 'one-leg' : ''}">
      <div class="bt-live-top"><b>${esc(m.label)}</b><span class="muted">${m.type === 'parlay' ? `${m.legs}-leg parlay` : 'single'} · ${usd(m.atRisk)} → ${usd(m.toWin)}</span></div>
      ${m.oneLegAway ? '<div class="bt-oneleg">🚨 ONE LEG AWAY: it all comes down to this game</div>' : ''}
      ${sweatMeter(m.type === 'parlay' ? m.slipP : m.legP, m.type === 'parlay' ? 'Parlay chance to cash' : 'Chance to cash')}
      <small>${esc(m.text || '')}</small></div>`).join('') + '<a class="linkish bt-more" href="#/bets">All your bets →</a>';
    return true;
  };
  fill(false);
  const t = setInterval(() => { if (`${lv.league}:${lv.id}` !== key) return clearInterval(t); if (!document.hidden) fill(true); }, 15000);
}

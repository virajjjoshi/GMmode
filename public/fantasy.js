/* Fantasy: connect Sleeper, see your matchup with jokes, trash-talk your league.
   Loaded before app.js; uses its helpers at call time. */
'use strict';

const fz = { map: null, mapAt: 0, week: null, data: null, nflLive: {} };

const fantasyLink = () => store.get('ttl:fantasy', null);
function setFantasyLink(v) { store.set('ttl:fantasy', v); fz.map = null; fz.mapAt = 0; fz.week = null; }

// NFL team -> your starters, cached for 2 minutes. Used by game cards and live rooms.
async function loadFantasyMap() {
  const f = fantasyLink();
  if (!f?.leagueId) { fz.map = null; return; }
  if (fz.map && Date.now() - fz.mapAt < 120000) return;
  try {
    const d = await api(`/fantasy/sleeper/league/${f.leagueId}/mine?user=${f.userId}`);
    fz.map = d.byTeam; fz.mapAt = Date.now();
  } catch { fz.map = null; }
}

function fantasyChip(g) {
  if (g.league !== 'nfl' || !fz.map) return '';
  const guys = [...(fz.map[g.away?.abbr] || []), ...(fz.map[g.home?.abbr] || [])];
  if (!guys.length) return '';
  const names = guys.map((p) => p.name.split(' ').slice(-1)[0]).join(', ');
  const pts = guys.reduce((a, p) => a + (p.points || 0), 0);
  return `<div class="fz-chip" title="Your fantasy starters in this game">🧑‍🌾 Your guys: <b>${esc(names)}</b>${g.status.state !== 'pre' ? ` · ${pts.toFixed(1)} pts` : ''}</div>`;
}

// ---------- page ----------
async function renderFantasy() {
  const f = fantasyLink();
  const app = $('#app');
  app.innerHTML = `<h1 class="hero-title">FANTASY, BUT <span class="hl">FUNNIER</span></h1>
    <p class="hero-sub">Connect your league. We'll show your matchup, point out your bench mistakes, and give you a place to trash-talk your league-mates.</p>
    <div id="fz"></div>`;
  if (!f?.userId) return paintConnect();
  if (!f.leagueId) return paintLeaguePicker();
  return paintLeague();
}

function paintConnect(prefill = '') {
  $('#fz').innerHTML = `<section class="panel fz-connect">
    <h3>🔌 Connect a league</h3>
    <div class="chips" role="tablist" style="margin-bottom:14px">
      <button class="chip" aria-pressed="true">🌙 Sleeper</button>
      <button class="chip empty" data-soon="ESPN">ESPN · soon</button>
      <button class="chip empty" data-soon="Yahoo">Yahoo · soon</button>
    </div>
    <form id="fzForm" class="row" autocomplete="off">
      <input id="fzUser" class="fz-input" placeholder="Your Sleeper username" value="${esc(prefill)}" maxlength="40" required aria-label="Sleeper username">
      <button class="btn primary" type="submit">Connect</button>
    </form>
    <p class="muted" style="font-size:13px;margin:10px 0 0">Read-only. We only use your public Sleeper username. No password, no login, and we can't touch your roster (your bad trades are all yours).</p>
  </section>`;
  $('#fzForm').onsubmit = async (e) => {
    e.preventDefault();
    const u = $('#fzUser').value.trim();
    const btn = $('#fzForm button'); btn.disabled = true; btn.textContent = 'Scouting…';
    try {
      const d = await api(`/fantasy/sleeper/user/${encodeURIComponent(u)}`);
      setFantasyLink({ platform: 'sleeper', username: u, userId: d.user.id, userName: d.user.name, avatar: d.user.avatar, leagues: d.leagues, season: d.season, currentSeason: d.currentSeason });
      if (d.leagues.length === 1) { pickLeague(d.leagues[0]); return; }
      paintLeaguePicker();
    } catch (err) { toast(err.message, true); btn.disabled = false; btn.textContent = 'Connect'; }
  };
  $$('[data-soon]').forEach((b) => { b.onclick = () => toast(`${b.dataset.soon} is on the roadmap. Sleeper only for now.`); });
}

function pickLeague(l) {
  const f = fantasyLink();
  setFantasyLink({ ...f, leagueId: l.id, leagueName: l.name });
  toast(`Connected to ${l.name}. Let the trash talk begin.`);
  renderFantasy();
}

function paintLeaguePicker() {
  const f = fantasyLink();
  const old = f.season !== f.currentSeason;
  $('#fz').innerHTML = `<section class="panel">
    <h3>${f.avatar ? `<img class="fz-av" src="${esc(f.avatar)}" alt="">` : '🌙'} Hey ${esc(f.userName)}, pick a league <small><button class="linkish" id="fzOut">not you?</button></small></h3>
    ${old && f.leagues.length ? `<p class="muted">No ${esc(f.currentSeason)} leagues yet, so here's ${esc(f.season)}. Did you even renew?</p>` : ''}
    ${f.leagues.length ? `<div class="fz-leagues">${f.leagues.map((l, i) => `<button class="fz-league" data-i="${i}">${l.avatar ? `<img src="${esc(l.avatar)}" alt="">` : '<span class="fz-ph">🏈</span>'}<span><b>${esc(l.name)}</b><small>${l.size}-team · ${esc(l.season)}</small></span></button>`).join('')}</div>`
      : '<div class="empty-state"><div class="big">🫥</div><p>No leagues found on this account. Your league-mates may have kicked you out. (Or it\'s just a new account.)</p></div>'}
  </section>`;
  $('#fzOut').onclick = () => { setFantasyLink(null); paintConnect(); };
  $$('.fz-league').forEach((b) => { b.onclick = () => pickLeague(f.leagues[+b.dataset.i]); });
}

async function loadNflLive() {
  // Which NFL teams are playing right now, so players can link to the live room.
  try {
    const { games } = await api(`/scoreboard?league=nfl&date=${ymd(new Date())}`);
    fz.nflLive = {};
    for (const g of games) for (const t of [g.home, g.away]) if (t?.abbr) fz.nflLive[t.abbr] = g;
  } catch { /* fine without */ }
}

async function paintLeague() {
  const f = fantasyLink();
  const el = $('#fz');
  if (!fz.data) el.innerHTML = '<div class="skeleton" style="height:320px"></div>';
  let d;
  try {
    [d] = await Promise.all([
      api(`/fantasy/sleeper/league/${f.leagueId}?user=${f.userId}${fz.week ? `&week=${fz.week}` : ''}`),
      loadNflLive(),
    ]);
  } catch (e) {
    el.innerHTML = `<div class="empty-state"><div class="big">🧯</div><p>${esc(e.message)}</p><button class="btn" id="fzReset">Pick a different league</button></div>`;
    $('#fzReset').onclick = () => { setFantasyLink({ ...f, leagueId: null }); renderFantasy(); };
    return;
  }
  fz.data = d; fz.week = d.week;
  const me_ = d.me, opp = d.opp;
  const tot = (me_?.points || 0) + (opp?.points || 0) || 1;
  const weeks = Array.from({ length: d.maxWeek }, (_, i) => i + 1);

  const playerRow = (p) => {
    const g = p.team && fz.nflLive[p.team];
    const tag = g?.status.state === 'in' ? `<a class="fz-live" href="#/live/nfl/${esc(g.id)}" title="Playing now. Join the live room">🔴 LIVE</a>`
      : g?.status.state === 'pre' ? `<span class="fz-when">${esc(fmtTime(g.date))}</span>` : '';
    return `<li class="${p.empty ? 'empty' : ''}"><span class="pos pos-${esc(p.pos)}">${esc(p.pos)}</span>
      <span class="pl">${esc(p.name)} <small class="muted">${esc(p.team || '')}</small>${p.inj ? ` <span class="inj">${esc(p.inj)}</span>` : ''} ${tag}</span>
      <b>${Number(p.points || 0).toFixed(1)}</b></li>`;
  };
  const lineup = (s, label) => s ? `<div class="fz-lineup"><h4>${esc(label)}: ${esc(s.team)} <small class="muted">${esc(s.record)}</small></h4><ul>${s.starters.map(playerRow).join('')}</ul>
      <details><summary>Bench (${s.bench.length})</summary><ul>${s.bench.map(playerRow).join('')}</ul></details></div>` : '';

  el.innerHTML = `
    <div class="fz-bar">
      <span class="fz-lg">${d.league.avatar ? `<img class="fz-av" src="${esc(d.league.avatar)}" alt="">` : '🏈'} <b>${esc(d.league.name)}</b> <small class="muted">${esc(d.league.season)} · ${d.league.size}-team · ${esc(d.league.scoring)}</small></span>
      <span class="spacer"></span>
      <select class="select" id="fzWeek" aria-label="Week">${weeks.map((w) => `<option value="${w}" ${w === d.week ? 'selected' : ''}>Week ${w}</option>`).join('')}</select>
      <button class="btn ghost" id="fzSwitch">Switch league</button>
    </div>
    ${me_ ? `<section class="scorehero fz-hero" style="--away-c:#3ddbd9;--home-c:#ff4d6d">
      <div class="sh-meta">Week ${d.week} ${d.live ? '· <span class="live-pill"><span class="dot"></span>LIVE</span>' : ''}</div>
      <div class="sh-main">
        <div class="sh-team">${me_.avatar ? `<img class="fz-big" src="${esc(me_.avatar)}" alt="">` : '<div class="logo-fallback">YOU</div>'}<div class="nm">${esc(me_.team)}</div><div class="rec">You · ${esc(me_.record)}</div></div>
        <div class="sh-score"><span>${me_.points.toFixed(1)}</span><span class="dash">–</span><span>${(opp?.points || 0).toFixed(1)}</span></div>
        <div class="sh-team">${opp?.avatar ? `<img class="fz-big" src="${esc(opp.avatar)}" alt="">` : '<div class="logo-fallback">?</div>'}<div class="nm">${esc(opp?.team || 'BYE')}</div><div class="rec">${esc(opp?.owner || '')} ${opp ? `· ${esc(opp.record)}` : ''}</div></div>
      </div>
      <div class="poll-bar"><div class="away" style="flex-grow:${Math.max(1, (me_.points / tot) * 100)};background:#3ddbd9;color:#002"></div><div class="home" style="flex-grow:${Math.max(1, ((opp?.points || 0) / tot) * 100)};background:#ff4d6d"></div></div>
    </section>` : ''}
    <div class="layout">
      <div>
        <section class="panel"><h3>🛋️ The Fantasy Therapist</h3><ul class="intern"><li><div class="mic">🧠</div><div class="bubble">${esc(d.therapist)}</div></li>
          ${d.regret ? `<li><div class="mic">🪑</div><div class="bubble"><b>Bench regret:</b> ${esc(d.regret.benched.name)} scored ${d.regret.benched.points.toFixed(1)} on your bench while ${esc(d.regret.started.name)} gave you ${d.regret.started.points.toFixed(1)}. That's ${d.regret.diff} points you left on the couch.</div></li>` : ''}</ul></section>
        ${me_ ? `<section class="panel"><h3>📋 Lineups</h3><div class="fz-lineups">${lineup(me_, 'You')}${lineup(opp, 'Them')}</div></section>` : ''}
        <section class="panel"><h3>💬 League Trash Talk <small>for ${esc(d.league.name)} only</small></h3>
          <div class="composer"><textarea id="flText" maxlength="500" placeholder="Talk your talk. @ your opponent. Bring receipts."></textarea>
            <div class="composer-foot"><span class="posting-as">Posting as ${esc(me.avatar)} <b>${esc(me.name)}</b></span><span class="counter"></span><button class="btn primary" id="flPost">Post</button></div></div>
          <div class="takes" id="flTakes"></div></section>
      </div>
      <aside class="side">
        <section class="panel"><h3>🏆 Standings</h3><table class="lines fz-stand"><thead><tr><th>Team</th><th>W-L</th><th>PF</th></tr></thead><tbody>
          ${d.standings.map((s, i) => `<tr class="${s.mine ? 'mine' : ''}"><td>${i + 1}. ${esc(s.team)}${i === d.standings.length - 1 ? ' 🚽' : i === 0 ? ' 👑' : ''}</td><td>${s.wins}-${s.losses}${s.ties ? `-${s.ties}` : ''}</td><td>${s.pf.toFixed(0)}</td></tr>`).join('')}
        </tbody></table><p class="muted" style="font-size:12px;margin:8px 0 0">🚽 = last place. Check your league's punishment rules.</p></section>
        <section class="panel"><h3>🌎 Around the League <small>week ${d.week}</small></h3><ul class="fz-around">
          ${d.around.map((m) => `<li class="${m.mine ? 'mine' : ''}"><span>${esc(m.a.team)}</span><b>${m.a.points.toFixed(1)}</b><i>vs</i><b>${m.b.points.toFixed(1)}</b><span>${esc(m.b.team)}</span></li>`).join('')}
        </ul></section>
      </aside>
    </div>`;

  $('#fzWeek').onchange = (e) => { fz.week = +e.target.value; paintLeague(); };
  $('#fzSwitch').onclick = () => { setFantasyLink({ ...f, leagueId: null }); fz.data = null; renderFantasy(); };
  $('#flPost').onclick = postLeagueTake;
  $('#flTakes').onclick = voteLeagueTake;
  paintLeagueThread();
  clearTimers();
  if (d.live) every(paintLeague, 60000);
  every(paintLeagueThread, 15000);
}

async function paintLeagueThread() {
  const f = fantasyLink(); const el = $('#flTakes'); if (!el || !f?.leagueId) return;
  try {
    const { comments } = await api(`/fantasy/thread/${f.leagueId}`);
    comments.sort((a, b) => b.createdAt - a.createdAt);
    el.innerHTML = comments.length ? comments.map((c) => `<article class="take" data-id="${esc(c.id)}"><div class="av">${esc(c.avatar || '🙂')}</div><div class="take-body">
        <div class="take-meta"><b>${esc(c.name)}</b>${c.mine ? '<span class="muted">(you)</span>' : ''}<span class="t">${ago(c.createdAt)}</span></div>
        <p class="take-text">${esc(c.text)}</p>
        <div class="take-actions"><button class="tact fire" data-act="fire" aria-pressed="${c.myVote === 'fire'}">🔥 ${c.fire}</button><button class="tact cap" data-act="cap" aria-pressed="${c.myVote === 'cap'}">🧢 ${c.cap}</button></div></div></article>`).join('')
      : '<p class="muted">Quiet league. Suspiciously quiet. Somebody start something.</p>';
  } catch { /* keep old */ }
}
async function postLeagueTake() {
  const f = fantasyLink(), ta = $('#flText'), btn = $('#flPost');
  if (ta.value.trim().length < 2) return toast('Say something! Even "booo" counts.', true);
  btn.disabled = true;
  try {
    await api(`/fantasy/thread/${f.leagueId}`, { method: 'POST', body: { text: ta.value.trim(), leagueName: f.leagueName } });
    ta.value = ''; confetti(60); paintLeagueThread();
  } catch (e) { toast(e.message, true); } finally { btn.disabled = false; }
}
async function voteLeagueTake(e) {
  const b = e.target.closest('[data-act]'); if (!b) return;
  try { await api(`/comments/${b.closest('.take').dataset.id}/vote`, { method: 'POST', body: { kind: b.dataset.act } }); paintLeagueThread(); }
  catch (err) { toast(err.message, true); }
}

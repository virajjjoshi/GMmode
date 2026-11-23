/* GM Mode: run a real MLB team through the current offseason.
   Routes: #/games/gm (pick a team, your saves), #/games/gm/<saveId>?tab=…
   Everything is prefixed fo (front office) to stay clear of games.js (gm…). */

const fo = { cfg: null, v: null, tab: 'office', partner: null, pv: null, give: new Set(), get: new Set(), faPos: 'all', faQ: '', offer: null, sim: null };
const FO_TABS = [['office', 'Front office'], ['fa', 'Free agents'], ['trade', 'Trades'], ['roster', '40-man roster'], ['news', 'News'], ['seasons', 'Seasons']];
const FO_GROUPS = [['all', 'All'], ['C', 'C'], ['IF', 'Infield'], ['OF', 'Outfield'], ['DH', 'DH'], ['SP', 'SP'], ['RP', 'RP']];
const FO_MODE = { contend: 'Contending', neutral: 'In the mix', rebuild: 'Rebuilding' };

const foLogo = (id, cls = 'fo-logo') => `<img class="${cls}" src="https://www.mlbstatic.com/team-logos/${Number(id)}.svg" alt="" loading="lazy">`;
const foHead = (id) => `<img class="fo-head" src="https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_96,q_auto:best/v1/people/${Number(id)}/headshot/67/current" alt="" loading="lazy">`;
const fo$ = (x) => (x == null ? '—' : x >= 100 ? `$${Math.round(x)}M` : x >= 10 ? `$${x.toFixed(1).replace(/\.0$/, '')}M` : `$${x.toFixed(2).replace(/0$/, '')}M`);
const foWar = (x) => (x == null ? '—' : `${x > 0 ? '' : ''}${x.toFixed(1)}`);
const foSign = (x) => (x > 0 ? `+${x}` : `${x}`);
const foGroup = (p) => (p.role === 'SP' ? 'SP' : p.role === 'RP' ? 'RP' : p.pos === 'C' ? 'C' : ['1B', '2B', '3B', 'SS'].includes(p.pos) ? 'IF' : ['LF', 'CF', 'RF', 'OF'].includes(p.pos) ? 'OF' : p.pos === 'TWP' ? 'DH' : 'DH');
const foPos = (p) => (p.role === 'SP' || p.role === 'RP' ? p.role : p.pos === 'TWP' ? 'TWP' : p.pos);
const foLine = (p) => {
  const h = p.line?.hit, q = p.line?.pit;
  const parts = [];
  if (h && h.pa) parts.push(`${h.avg}/${h.obp}/${h.slg}, ${h.hr} HR${h.sb ? `, ${h.sb} SB` : ''} (${h.pa} PA)`);
  if (q && q.ip) parts.push(`${q.era} ERA, ${q.ip} IP, ${q.k} K${q.sv ? `, ${q.sv} SV` : ''}`);
  return parts.length ? `${p.lineSeason}: ${parts.join(' · ')}` : p.prospect ? 'Prospect: no big-league stats yet' : 'No recent big-league stats';
};
const foOvr = (o) => `<span class="fo-ovr ${o >= 80 ? 'elite' : o >= 68 ? 'good' : o >= 58 ? 'ok' : ''}">${o}</span>`;
const foCls = { pre: 'Pre-arb', arb: 'Arbitration', vet: 'Veteran', signed: 'Signed by you', fa: 'Free agent' };

async function foConfig() {
  if (!fo.cfg) fo.cfg = await api('/office/config');
  return fo.cfg;
}

function renderOffice(id) {
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  fo.tab = FO_TABS.some(([k]) => k === q.get('tab')) ? q.get('tab') : 'office';
  if (!id) return renderOfficeHome();
  return renderOfficeSave(id);
}

// =================================================================
// PICK A TEAM
// =================================================================
async function renderOfficeHome() {
  const app = $('#app');
  app.innerHTML = `<a class="back" href="#/games">← Games</a>
    <div class="page-head"><h1 class="hero-title">GM Mode</h1><p class="hero-sub">Loading the MLB offseason: every 40-man roster, every free agent, every move so far…</p></div>
    <div class="skeleton" style="height:420px"></div>`;
  let cfg, saves;
  try { [cfg, { saves }] = await Promise.all([foConfig(), api('/office/saves')]); }
  catch (e) { app.innerHTML = `<a class="back" href="#/games">← Games</a><div class="empty-state"><p>${esc(e.message)}</p><button class="btn primary" type="button" data-retry>Try again</button></div>`; return; }
  const divs = [...new Set(cfg.teams.map((t) => t.division))].sort((a, b) => (a.startsWith('AL') === b.startsWith('AL') ? ['East', 'Central', 'West'].indexOf(a.split(' ')[1]) - ['East', 'Central', 'West'].indexOf(b.split(' ')[1]) : a.startsWith('AL') ? -1 : 1));
  app.innerHTML = `<a class="back" href="#/games">← Games</a>
    <div class="page-head"><h1 class="hero-title">GM Mode: ${cfg.next} MLB offseason</h1>
      <p class="hero-sub">Take over any team as it stands today. Sign free agents, make trades, manage the budget, then simulate the ${cfg.next} season and see if you built a champion.</p></div>
    <div class="fo-facts">
      <div><b>${cfg.counts.players.toLocaleString()}</b><span>players on real 40-man rosters</span></div>
      <div><b>${cfg.counts.freeAgents}</b><span>free agents on the market</span></div>
      <div><b>${cfg.counts.moves}</b><span>MLB signings &amp; trades so far</span></div>
      <div><b>${esc(new Date(`${cfg.asOf}T12:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric' }))}</b><span>data as of</span></div>
    </div>
    ${saves.length ? `<section class="panel fo-saves"><h3>Continue <small>your front offices</small></h3><ul>${saves.map((s) => `<li>
      <a href="#/games/gm/${esc(s.id)}">${foLogo(s.team)}<span><b>${esc(s.teamName || 'Team')}</b><small>Week ${Math.min(s.week, 12)}${s.week > 12 ? ' · Opening Day' : ''} · ${s.moves} move${s.moves === 1 ? '' : 's'} · ${s.sims} season${s.sims === 1 ? '' : 's'} simmed${s.best ? ` · best ${s.best.record.w}-${s.best.record.l}` : ''}</small></span></a>
      <button class="linkish" type="button" data-del="${esc(s.id)}">Delete</button></li>`).join('')}</ul></section>` : ''}
    <h2 class="league-head">Pick your team</h2>
    <div class="fo-divs">${divs.map((d) => `<section class="fo-div"><h4>${esc(d)}</h4>${cfg.teams.filter((t) => t.division === d).map((t) => `<button type="button" class="fo-team" data-team="${t.id}">${foLogo(t.id)}<span>${esc(t.name)}</span></button>`).join('')}</section>`).join('')}</div>
    <p class="gm-disclaimer">${esc(cfg.disclaimer)}</p>`;
  $$('[data-team]').forEach((b) => { b.onclick = () => foCreate(b.dataset.team, b); });
  $$('[data-del]').forEach((b) => { b.onclick = async () => {
    if (!confirm('Delete this front office? This can\'t be undone.')) return;
    try { await api(`/office/saves/${b.dataset.del}`, { method: 'DELETE' }); renderOfficeHome(); } catch (e) { toast(e.message, true); }
  }; });
}

async function foCreate(team, btn) {
  $$('[data-team]').forEach((b) => { b.disabled = true; });
  btn.classList.add('busy');
  try {
    const v = await api('/office/saves', { method: 'POST', body: { team: Number(team) } });
    fo.v = v; fo.partner = null; fo.pv = null; fo.give.clear(); fo.get.clear();
    location.hash = `#/games/gm/${v.save.id}`;
  } catch (e) { toast(e.message, true); $$('[data-team]').forEach((b) => { b.disabled = false; }); btn.classList.remove('busy'); }
}

// =================================================================
// THE FRONT OFFICE
// =================================================================
async function renderOfficeSave(id) {
  const app = $('#app');
  if (!fo.v || fo.v.save.id !== id) {
    fo.partner = null; fo.pv = null; fo.give.clear(); fo.get.clear(); fo.sim = null; fo.offer = null;
    app.innerHTML = '<a class="back" href="#/games/gm">← GM Mode</a><div class="skeleton" style="height:180px"></div><div class="skeleton" style="height:420px;margin-top:18px"></div>';
    try { fo.v = await api(`/office/saves/${id}`); }
    catch (e) { app.innerHTML = `<a class="back" href="#/games/gm">← GM Mode</a><div class="empty-state"><p>${esc(e.message)}</p><a class="btn primary" href="#/games/gm">Pick a team</a></div>`; return; }
  }
  foPaint();
}

function foSetTab(tab) {
  fo.tab = tab;
  history.replaceState(null, '', `#/games/gm/${fo.v.save.id}${tab === 'office' ? '' : `?tab=${tab}`}`);
  foPaint();
}

function foPaint() {
  const v = fo.v, t = v.team;
  const used = Math.min(100, (t.payroll / t.budget) * 100);
  const delta = t.wins - v.save.baseWins;
  const opening = v.save.week > v.save.weeks;
  $('#app').innerHTML = `<a class="back" href="#/games/gm">← GM Mode</a>
    <section class="fo-hero" style="--fo-l:url('https://www.mlbstatic.com/team-logos/${t.id}.svg')">
      <div class="fo-hero-top">${foLogo(t.id, 'fo-logo big')}<div><h1>${esc(t.name)}</h1>
        <p>${v.next} offseason · ${opening ? '<b>Opening Day</b>' : `Week <b>${v.save.week}</b> of ${v.save.weeks}`} · ${esc(t.division)} · ${FO_MODE[t.mode]}</p></div>
        <div class="fo-hero-act">
          <button class="btn" type="button" id="foAdvance" ${opening ? 'disabled' : ''} title="Other teams sign free agents as the weeks go by">${opening ? 'Market closed' : 'Advance a week'}</button>
          <button class="btn primary" type="button" id="foSim">Simulate ${v.next}</button>
        </div></div>
      <div class="fo-kpis">
        <div><b>${t.wins}</b><span>projected wins${delta ? ` <em class="${delta > 0 ? 'up' : 'down'}">${foSign(delta)}</em>` : ''}</span></div>
        <div><b>#${t.leagueRank}</b><span>in the ${t.league}</span></div>
        <div class="fo-pay"><b>${fo$(t.payroll)} <small>/ ${fo$(t.budget)}</small></b><span>payroll (est.) · ${fo$(Math.max(0, t.budget - t.payroll))} room</span><i style="--w:${used}%" class="${used >= 97 ? 'full' : ''}"></i></div>
        <div><b>${t.rosterSize}<small>/40</small></b><span>40-man roster</span></div>
      </div>
    </section>
    <nav class="pl-ltabs" aria-label="Front office">${FO_TABS.map(([k, l]) => `<a href="#" data-tab="${k}" class="${fo.tab === k ? 'active' : ''}">${l}${k === 'fa' ? ` <span class="pl-dot">${v.freeAgents.length}</span>` : ''}</a>`).join('')}</nav>
    <div id="foBody"></div>
    <p class="gm-disclaimer">${esc(v.disclaimer)}</p>`;
  $$('[data-tab]').forEach((a) => { a.onclick = (e) => { e.preventDefault(); foSetTab(a.dataset.tab); }; });
  $('#foAdvance').onclick = foAdvance;
  $('#foSim').onclick = foSimulate;
  ({ office: foOffice, fa: foFreeAgents, trade: foTrade, roster: foRoster, news: foNews, seasons: foSeasons }[fo.tab] || foOffice)();
}

async function foAct(path, body, btn) {
  if (btn) btn.disabled = true;
  try { return await api(`/office/saves/${fo.v.save.id}/${path}`, { method: 'POST', body }); }
  catch (e) { toast(e.message, true); return null; }
  finally { if (btn) btn.disabled = false; }
}

// ---------- overview ----------
function foPlayerCell(id, extra = '') {
  const p = fo.v.roster.find((x) => x.id === id);
  if (!p) return '<td colspan="3" class="muted">Nobody: hole on the roster</td>';
  return `<td><span class="fo-who">${foHead(p.id)}<span><b>${esc(p.name)}</b><small>${esc(foPos(p))} · ${p.age}${extra}</small></span></span></td><td>${foOvr(p.ovr)}</td><td class="num">${foWar(p.war)}</td>`;
}
function foOffice() {
  const v = fo.v, c = v.chart;
  const lineup = c.lineup.map((x) => `<tr><th>${x.slot}</th>${foPlayerCell(x.id, x.off ? ' · out of position' : '')}</tr>`).join('');
  const rot = c.rotation.map((x, i) => `<tr><th>SP${i + 1}</th>${foPlayerCell(x.id, x.stretched ? ' · stretched out' : '')}</tr>`).join('');
  const pen = c.bullpen.map((x, i) => `<tr><th>RP</th>${foPlayerCell(x.id)}</tr>`).join('');
  const myMoves = v.log.filter((x) => x.mine);
  const real = v.realMoves.filter((m) => m.mine);
  $('#foBody').innerHTML = `<div class="layout">
    <div>
      <section class="panel"><h3>Depth chart <small>projected ${v.next} WAR</small></h3>
        <div class="fo-depth">
          <table class="fo-table"><caption>Lineup</caption><tbody>${lineup}</tbody></table>
          <div><table class="fo-table"><caption>Rotation</caption><tbody>${rot}</tbody></table>
          <table class="fo-table"><caption>Bullpen</caption><tbody>${pen}</tbody></table></div>
        </div></section>
      <section class="panel"><h3>Your moves <small>${myMoves.length}</small></h3>${myMoves.length ? `<ul class="fo-log">${myMoves.map((x) => `<li><span>${esc(x.text)}</span>${x.delta ? `<em class="${x.delta > 0 ? 'up' : 'down'}">${foSign(x.delta)} W</em>` : ''}</li>`).join('')}</ul>` : `<p class="muted">Nothing yet. Start with <a href="#" data-go="fa">free agents</a> or <a href="#" data-go="trade">the trade market</a>.</p>`}</section>
    </div>
    <aside class="side">
      <section class="panel"><h3>${esc(v.team.division)} <small>projected wins</small></h3><table class="fo-table fo-stand"><tbody>${v.division.map((d) => `<tr class="${d.id === v.team.id ? 'mine' : ''}"><td>${foLogo(d.id, 'fo-logo sm')} ${esc(d.name)}</td><td class="num"><b>${d.wins}</b></td></tr>`).join('')}</tbody></table></section>
      <section class="panel"><h3>Real moves <small>${esc(v.team.short)}, this offseason</small></h3>${real.length ? `<ul class="fo-feed">${real.slice(0, 8).map((m) => `<li><small>${esc(m.date)}</small>${esc(m.text)}</li>`).join('')}</ul>` : '<p class="muted">No MLB signings or trades yet this offseason.</p>'}
        <p class="fo-note">Your save started from these. <a href="#" data-go="news">All real moves →</a></p></section>
      ${v.sims[0] ? `<section class="panel"><h3>Last simulation</h3><p class="fo-last"><b>${v.sims[0].record.w}-${v.sims[0].record.l}</b> ${esc(v.sims[0].reached)}</p><a href="#" data-go="seasons">All seasons →</a></section>` : ''}
    </aside></div>`;
  $$('[data-go]').forEach((a) => { a.onclick = (e) => { e.preventDefault(); foSetTab(a.dataset.go); }; });
}

// ---------- free agents ----------
function foFreeAgents() {
  const v = fo.v;
  const q = fo.faQ.toLowerCase();
  const list = v.freeAgents.filter((p) => (fo.faPos === 'all' || foGroup(p) === fo.faPos) && (!q || p.name.toLowerCase().includes(q)));
  const room = v.team.budget - v.team.payroll;
  $('#foBody').innerHTML = `<div class="fo-bar">
      <div class="chips" role="group" aria-label="Position">${FO_GROUPS.map(([k, l]) => `<button class="chip" type="button" data-fpos="${k}" aria-pressed="${fo.faPos === k}">${l}</button>`).join('')}</div>
      <label class="search"><svg class="ico" aria-hidden="true" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input id="foQ" type="search" placeholder="Find a player…" value="${esc(fo.faQ)}" autocomplete="off"></label>
      <span class="muted fo-room">Budget room: <b>${fo$(Math.max(0, room))}</b> · ${40 - v.team.rosterSize} open roster spot${40 - v.team.rosterSize === 1 ? '' : 's'}</span>
    </div>
    ${v.save.week > v.save.weeks ? '<p class="pl-warn">It\'s Opening Day: free agency is closed. You can still trade.</p>' : ''}
    ${list.length ? `<div class="table-scroll"><table class="fo-table fo-list"><thead><tr><th>Player</th><th>OVR</th><th class="num" title="Projected wins above replacement next season">Proj WAR</th><th class="hide-sm">Last season</th><th>Asking (est.)</th><th></th></tr></thead><tbody>
    ${list.map((p) => `<tr data-pid="${p.id}"><td><span class="fo-who">${foHead(p.id)}<span><b>${esc(p.name)}</b><small>${esc(foPos(p))} · ${p.age}</small></span></span></td><td>${foOvr(p.ovr)}</td><td class="num">${foWar(p.war)}</td><td class="hide-sm fo-line">${esc(foLine(p))}</td>
      <td class="nowrap">${p.ask.years} yr · ${fo$(p.ask.aav)}/yr</td><td><button class="btn ${p.ask.aav <= room ? 'primary' : ''}" type="button" data-offer="${p.id}" ${v.save.week > v.save.weeks ? 'disabled' : ''}>Offer</button></td></tr>
      ${fo.offer?.id === p.id ? `<tr class="fo-offer-row"><td colspan="6">${foOfferForm(p)}</td></tr>` : ''}`).join('')}
    </tbody></table></div>` : '<div class="empty-state"><p>No free agents match. The market moves fast.</p></div>'}`;
  $$('[data-fpos]').forEach((b) => { b.onclick = () => { fo.faPos = b.dataset.fpos; foFreeAgents(); }; });
  let tq; $('#foQ').oninput = (e) => { clearTimeout(tq); tq = setTimeout(() => { fo.faQ = e.target.value.trim(); foFreeAgents(); $('#foQ').focus(); const i = $('#foQ'); i.setSelectionRange(i.value.length, i.value.length); }, 200); };
  $$('[data-offer]').forEach((b) => { b.onclick = () => {
    const p = v.freeAgents.find((x) => x.id === Number(b.dataset.offer));
    fo.offer = fo.offer?.id === p.id ? null : { id: p.id, aav: p.ask.aav, years: p.ask.years, msg: null };
    foFreeAgents();
  }; });
  foWireOffer();
}

function foOfferForm(p) {
  const o = fo.offer, v = fo.v;
  const after = v.team.payroll + Number(o.aav || 0);
  return `<form class="fo-offer" id="foOffer">
    <label>Years <select name="years">${Array.from({ length: 10 }, (_, i) => i + 1).map((y) => `<option ${y === Number(o.years) ? 'selected' : ''}>${y}</option>`).join('')}</select></label>
    <label>Per year ($M) <input name="aav" type="number" min="0.78" max="60" step="any" inputmode="decimal" value="${esc(o.aav)}"></label>
    <span class="fo-offer-sum">Total <b>${fo$(o.aav * o.years)}</b> · payroll after <b class="${after > v.team.budget ? 'hot-txt' : ''}">${fo$(after)}</b> of ${fo$(v.team.budget)}</span>
    <button class="btn primary" type="submit">Send offer</button>
    ${o.msg ? `<p class="fo-reply ${o.verdict}">${esc(o.msg)}${o.verdict === 'counter' ? ` <button class="btn" type="button" id="foTakeCounter">Accept: ${o.counter.years} yr · ${fo$(o.counter.aav)}/yr</button>` : ''}</p>` : `<p class="fo-hint">He's asking about ${p.ask.years} yr · ${fo$(p.ask.aav)}/yr. Contenders get a small discount, rebuilding teams pay a premium, and every lowball makes his camp a little less patient.</p>`}
  </form>`;
}
function foWireOffer() {
  const f = $('#foOffer'); if (!f) return;
  f.oninput = () => { fo.offer.aav = Number(f.aav.value); fo.offer.years = Number(f.years.value); const s = $('.fo-offer-sum', f); const after = fo.v.team.payroll + fo.offer.aav; s.innerHTML = `Total <b>${fo$(fo.offer.aav * fo.offer.years)}</b> · payroll after <b class="${after > fo.v.team.budget ? 'hot-txt' : ''}">${fo$(after)}</b> of ${fo$(fo.v.team.budget)}`; };
  f.onsubmit = (e) => { e.preventDefault(); foSendOffer(fo.offer.aav, fo.offer.years, $('button[type=submit]', f)); };
  const c = $('#foTakeCounter'); if (c) c.onclick = () => foSendOffer(fo.offer.counter.aav, fo.offer.counter.years, c);
}
async function foSendOffer(aav, years, btn) {
  const p = fo.v.freeAgents.find((x) => x.id === fo.offer.id);
  const r = await foAct('sign', { playerId: p.id, aav, years }, btn);
  if (!r) return;
  if (r.verdict === 'accept') {
    fo.v = r.view; fo.offer = null;
    confetti(90); toast(`${p.name} signed${r.delta ? ` · ${foSign(r.delta)} projected wins` : ''}`);
    foPaint(); return;
  }
  Object.assign(fo.offer, { aav, years, msg: r.message, verdict: r.verdict, counter: r.counter });
  foFreeAgents();
}

// ---------- trades ----------
async function foLoadPartner(team) {
  fo.partner = Number(team); fo.get.clear(); fo.pv = null; fo.verdict = null;
  foTrade();
  try { fo.pv = await api(`/office/saves/${fo.v.save.id}/teams/${team}`); } catch (e) { toast(e.message, true); }
  foTrade();
}
function foTrade() {
  const v = fo.v;
  const teams = v.teams.filter((t) => t.id !== v.team.id).sort((a, b) => a.name.localeCompare(b.name));
  const mine = v.roster;
  const theirs = fo.pv?.roster || [];
  const row = (p, side) => {
    const set = side === 'give' ? fo.give : fo.get;
    const lock = side === 'get' && p.untouchable;
    return `<li class="${set.has(p.id) ? 'on' : ''} ${lock ? 'lock' : ''}"><label><input type="checkbox" data-${side}="${p.id}" ${set.has(p.id) ? 'checked' : ''} ${lock ? 'disabled' : ''}>
      ${foHead(p.id)}<span><b>${esc(p.name)}</b><small>${esc(foPos(p))} · ${p.age} · ${fo$(p.salary)}${p.years ? ` × ${p.years}` : ''}${lock ? ' · not available' : ''}</small></span>${foOvr(p.ovr)}</label></li>`;
  };
  const pick = (set, list) => list.filter((p) => set.has(p.id));
  const give = pick(fo.give, mine), get = pick(fo.get, theirs);
  const sal = (l) => l.reduce((a, p) => a + p.salary, 0);
  const net = sal(get) - sal(give);
  const vd = fo.verdict;
  $('#foBody').innerHTML = `<div class="fo-bar">
      <label class="fo-partner">Trade with <select id="foPartner"><option value="">Choose a team…</option>${teams.map((t) => `<option value="${t.id}" ${fo.partner === t.id ? 'selected' : ''}>${esc(t.name)} (${t.wins} W, ${FO_MODE[t.mode].toLowerCase()})</option>`).join('')}</select></label>
      ${fo.pv ? `<span class="muted">${esc(fo.pv.team.short)}: ${FO_MODE[fo.pv.team.mode]} · payroll ${fo$(fo.pv.team.payroll)} of ${fo$(fo.pv.team.budget)} · ${fo.pv.team.rosterSize}/40</span>` : ''}
    </div>
    <div class="fo-trade">
      <section class="panel"><h3>You send <small>${give.length} player${give.length === 1 ? '' : 's'} · ${fo$(sal(give))}</small></h3><ul class="fo-pick">${mine.map((p) => row(p, 'give')).join('')}</ul></section>
      <section class="panel"><h3>You get <small>${get.length} player${get.length === 1 ? '' : 's'} · ${fo$(sal(get))}</small></h3>${fo.partner ? (fo.pv ? `<ul class="fo-pick">${theirs.map((p) => row(p, 'get')).join('')}</ul>` : '<div class="skeleton" style="height:300px"></div>') : '<p class="muted">Choose a team to see their 40-man roster.</p>'}</section>
    </div>
    <div class="fo-deal">
      <div><b>${give.length} for ${get.length}</b><span>Payroll ${net >= 0 ? '+' : ''}${fo$(Math.abs(net)).replace('$', net < 0 ? '−$' : '$')} this season</span></div>
      ${vd ? `<div class="fo-verdict ${vd.ok ? 'yes' : 'no'}"><b>${vd.ok ? `${esc(vd.partnerName)} would accept.` : `${esc(vd.partnerName)} say no.`}</b>${vd.reasons.map((r) => `<span>${esc(r)}</span>`).join('')}${vd.suggestion ? `<button class="btn" type="button" id="foAddSug">${esc(vd.suggestion.text)}</button>` : ''}</div>` : '<div class="muted">Tick players on both sides, then ask what they think. They\'ll tell you what it would take.</div>'}
      <div class="fo-deal-act"><button class="btn" type="button" id="foAsk" ${(!give.length && !get.length) || !fo.partner ? 'disabled' : ''}>Ask what they think</button>
        <button class="btn primary" type="button" id="foDo" ${vd?.ok ? '' : 'disabled'}>Make the trade</button></div>
    </div>`;
  $('#foPartner').onchange = (e) => { if (e.target.value) foLoadPartner(e.target.value); };
  $$('[data-give]').forEach((x) => { x.onchange = () => { x.checked ? fo.give.add(+x.dataset.give) : fo.give.delete(+x.dataset.give); fo.verdict = null; foTrade(); }; });
  $$('[data-get]').forEach((x) => { x.onchange = () => { x.checked ? fo.get.add(+x.dataset.get) : fo.get.delete(+x.dataset.get); fo.verdict = null; foTrade(); }; });
  $('#foAsk').onclick = () => foPropose(false, $('#foAsk'));
  $('#foDo').onclick = () => foPropose(true, $('#foDo'));
  const sug = $('#foAddSug'); if (sug) sug.onclick = () => { fo.give.add(vd.suggestion.add); fo.verdict = null; foPropose(false, sug); };
}
async function foPropose(execute, btn) {
  const r = await foAct('trade', { partner: fo.partner, give: [...fo.give], get: [...fo.get], execute }, btn);
  if (!r) return;
  if (r.verdict === 'done') {
    fo.v = r.view; fo.give.clear(); fo.get.clear(); fo.verdict = null;
    toast(`${r.message}${r.delta ? ` ${foSign(r.delta)} projected wins.` : ''}`);
    fo.pv = await api(`/office/saves/${fo.v.save.id}/teams/${fo.partner}`).catch(() => null);
    foPaint(); return;
  }
  fo.verdict = r; foTrade();
}

// ---------- roster ----------
function foRoster() {
  const v = fo.v;
  const groups = [['Position players', v.roster.filter((p) => p.role === 'H' || p.role === 'TWP')], ['Starting pitchers', v.roster.filter((p) => p.role === 'SP')], ['Relievers', v.roster.filter((p) => p.role === 'RP')]];
  $('#foBody').innerHTML = `<p class="fo-note">Salaries and contract years are estimates (real contracts aren't public in any free feed). Releasing a player keeps this season's salary on your books as dead money${v.team.dead ? `: you're carrying <b>${fo$(v.team.dead)}</b>` : ''}.</p>
    ${groups.map(([title, list]) => `<section class="panel"><h3>${title} <small>${list.length}</small></h3><div class="table-scroll"><table class="fo-table fo-list"><thead><tr><th>Player</th><th>OVR</th><th class="num">Proj WAR</th><th class="hide-sm">Last season</th><th>Salary (est.)</th><th class="hide-sm">Status</th><th></th></tr></thead><tbody>
      ${list.map((p) => `<tr><td><span class="fo-who">${foHead(p.id)}<span><b>${esc(p.name)}</b><small>${esc(foPos(p))} · ${p.age}</small></span></span></td><td>${foOvr(p.ovr)}</td><td class="num">${foWar(p.war)}</td><td class="hide-sm fo-line">${esc(foLine(p))}</td>
        <td class="nowrap">${fo$(p.salary)}${p.years ? ` × ${p.years}` : ''}</td><td class="hide-sm">${esc(foCls[p.cls] || p.cls)}</td><td><button class="linkish" type="button" data-release="${p.id}">Release</button></td></tr>`).join('')}
    </tbody></table></div></section>`).join('')}`;
  $$('[data-release]').forEach((b) => { b.onclick = async () => {
    const p = v.roster.find((x) => x.id === Number(b.dataset.release));
    if (!confirm(`Release ${p.name}? His ${fo$(p.salary)} this season stays on your payroll.`)) return;
    const r = await foAct('release', { playerId: p.id }, b);
    if (r) { fo.v = r.view; toast(r.message); foPaint(); }
  }; });
}

// ---------- news ----------
function foNews() {
  const v = fo.v;
  $('#foBody').innerHTML = `<div class="layout"><section class="panel"><h3>Around the league <small>in your save</small></h3>
      ${v.news.length ? `<ul class="fo-feed">${v.news.map((n) => `<li class="${n.team === v.team.id ? 'mine' : ''}"><small>Week ${n.week}</small>${foLogo(n.team, 'fo-logo sm')} ${esc(n.text)}</li>`).join('')}</ul>` : '<p class="muted">Quiet so far. Advance a week and the other 29 teams start shopping.</p>'}</section>
    <aside class="side"><section class="panel"><h3>Real MLB moves <small>before your save started</small></h3>
      ${v.realMoves.length ? `<ul class="fo-feed">${v.realMoves.map((m) => `<li class="${m.mine ? 'mine' : ''}"><small>${esc(m.date)}</small>${esc(m.text)}</li>`).join('')}</ul>` : '<p class="muted">No big-league signings or trades yet.</p>'}</section></aside></div>`;
}

// ---------- the calendar & simulation ----------
async function foAdvance() {
  const b = $('#foAdvance');
  const r = await foAct('advance', {}, b);
  if (!r) return;
  fo.v = r.view;
  toast(r.signed.length ? `${r.signed.length} free agent${r.signed.length === 1 ? '' : 's'} signed elsewhere: ${r.signed.slice(0, 3).map((x) => x.name).join(', ')}${r.signed.length > 3 ? '…' : ''}` : 'Quiet week on the market.');
  foPaint();
}
async function foSimulate() {
  const b = $('#foSim'); b.textContent = 'Simulating…';
  const r = await foAct('simulate', {}, b);
  if (!r) { b.textContent = `Simulate ${fo.v.next}`; return; }
  fo.v = r.view; fo.sim = r.result;
  if (r.result.reached === 'Won the World Series') confetti(260);
  fo.tab = 'seasons';
  history.replaceState(null, '', `#/games/gm/${fo.v.save.id}?tab=seasons`);
  foPaint();
}

function foSeasons() {
  const v = fo.v;
  const r = fo.sim && fo.sim.n === v.sims[0]?.n ? fo.sim : null;
  const name = (id) => v.teams.find((t) => t.id === id)?.abbr || '?';
  const series = (s) => `<li class="${s.a === v.team.id || s.b === v.team.id ? 'mine' : ''}"><small>${esc(s.round)}</small><span>${foLogo(s.winner, 'fo-logo sm')} <b>${name(s.winner)}</b> def. ${name(s.winner === s.a ? s.b : s.a)} ${Math.max(...s.score)}-${Math.min(...s.score)}</span></li>`;
  const divTable = r ? v.teams.filter((t) => v.division.some((d) => d.id === t.id)).map((t) => ({ ...t, rec: r.standings[t.id] })).sort((a, b) => b.rec.w - a.rec.w) : [];
  $('#foBody').innerHTML = `${r ? `<section class="fo-result ${r.reached === 'Won the World Series' ? 'champ' : ''}">
      <div><small>${v.next} season (simulated)</small><h2>${r.record.w}-${r.record.l}</h2><p>${esc(r.reached)}${r.divRank === 1 ? ' · Division champs' : ` · ${['', '1st', '2nd', '3rd', '4th', '5th'][r.divRank]} in the ${esc(v.team.division)}`}</p>
        <p class="muted">Projected ${r.projected} wins · champion: <b>${esc(v.teams.find((t) => t.id === r.champion)?.name || '')}</b></p></div>
      <div class="fo-result-grid">
        <section><h4>${esc(v.team.division)}</h4><table class="fo-table fo-stand"><tbody>${divTable.map((t) => `<tr class="${t.id === v.team.id ? 'mine' : ''}"><td>${foLogo(t.id, 'fo-logo sm')} ${esc(t.name)}</td><td class="num"><b>${t.rec.w}-${t.rec.l}</b></td></tr>`).join('')}</tbody></table></section>
        <section><h4>Postseason</h4><ul class="fo-bracket">${[...r.post.rounds.flatMap((x) => x.series), r.post.worldSeries].map(series).join('')}</ul></section>
      </div>
      <div class="fo-hero-act"><button class="btn primary" type="button" id="foSimAgain">Simulate again</button><span class="muted">Every simulation is a fresh season. Luck matters: a 90-win team misses the playoffs sometimes.</span></div>
    </section>` : ''}
    <section class="panel"><h3>Your simulated seasons <small>${v.sims.length}</small></h3>${v.sims.length ? `<table class="fo-table"><thead><tr><th>#</th><th>Record</th><th>Result</th><th class="num">Projected</th></tr></thead><tbody>${v.sims.map((s) => `<tr><td>${s.n}</td><td><b>${s.record.w}-${s.record.l}</b></td><td>${esc(s.reached)}</td><td class="num">${s.projected}</td></tr>`).join('')}</tbody></table>` : `<p class="muted">No seasons yet. Build your roster, then hit <b>Simulate ${v.next}</b>.</p>`}</section>`;
  const again = $('#foSimAgain'); if (again) again.onclick = foSimulate;
}

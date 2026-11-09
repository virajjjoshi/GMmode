/* Games: the historical perfect-season challenges.
   Random team -> its real roster that season -> draft a squad -> simulate the
   real schedule -> chase the perfect record.
   Routes: #/games (landing), #/games/play/<id>[?run=n], #/games/how.
   Roster strength is real fantasy production: each player's fantasy PPG from
   that season, plus verified chemistry. The server owns the rules: it rolls
   the team, checks every squad, scores it and runs the sim. This file only
   draws it. Loaded before app.js; uses its helpers. */
'use strict';

const gm = { config: null, view: null, squad: {}, stage: null, filter: 'all', q: '', sortCol: null, target: null, saveT: null, saving: null, revealT: null, attemptId: null, compare: [], flash: null };
const GM_COLORS = { nfl: 'var(--good)', nba: 'var(--orange)', mlb: 'var(--cool)', nhl: 'var(--purple)', epl: 'var(--hot)' };
const GM_KIND = { college: '🎓', teammates: '🤝', national: '🏳️' };

async function gmConfig() {
  if (!gm.config) gm.config = await api('/games/config');
  return gm.config;
}

function renderGames(a, b) {
  clearInterval(gm.revealT);
  if (a === 'play' && b) return renderGamePlay(b);
  if (a === 'how') return renderGamesHow();
  return renderGamesHome();
}

// ---------- formatting ----------
function gmRecord(rec, sport, season) {
  if (!rec) return '';
  if (sport === 'epl') return `${rec.w}W ${rec.t}D ${rec.l}L`;
  if (sport === 'nhl') return season <= 2004 ? `${rec.w}-${rec.l}-${rec.t}${rec.otl ? `-${rec.otl}` : ''}` : `${rec.w}-${rec.l}-${rec.otl}`;
  return `${rec.w}-${rec.l}${rec.t ? `-${rec.t}` : ''}`;
}
const gmGoal = (rules, games) => (rules.objective === 'undefeated' ? 'Unbeaten' : `${games}-0`);
const gmPct = (x) => (x == null ? '—' : x === 0 ? '<0.1%' : x >= 0.995 ? '>99%' : `${(x * 100).toFixed(x < 0.1 ? 1 : 0)}%`);
const gmRes = (r) => ({ W: 'w', L: 'l', T: 't', OTL: 'l' }[r] || 'l');
const gmF = (x, d = 1) => (x == null || !Number.isFinite(+x) ? '—' : (+x).toFixed(d));
const gmPlus = (x, d = 1) => (x > 0 ? `+${gmF(x, d)}` : gmF(x, d));
function gmTeamColor(team) { return usable({ color: team?.color, alt: null }) || 'var(--accent)'; }
function gmSlots(rules) { return rules.slots.flatMap((s) => Array.from({ length: s.n }, (_, i) => ({ key: `${s.id}.${i}`, slot: s }))); }
const gmFits = (slot, p) => slot.elig.some((g) => p.elig.includes(g));
// The group a slot scores this player in (his best-scoring eligible one).
const gmGroup = (slot, p) => slot.elig.filter((g) => p.elig.includes(g)).sort((a, b) => (p.pg[b] ?? 0) - (p.pg[a] ?? 0))[0];

// =================================================================
// LANDING
// =================================================================
async function renderGamesHome() {
  const app = $('#app');
  app.innerHTML = `<div class="page-head"><h1 class="hero-title">Games</h1></div><div class="gm-cards">${'<div class="skeleton" style="height:300px"></div>'.repeat(3)}</div>`;
  let cfg, mine;
  try { [cfg, mine] = await Promise.all([gmConfig(), api('/games/me').catch(() => null)]); }
  catch (e) { app.innerHTML = `<div class="page-head"><h1 class="hero-title">Games</h1></div><div class="empty-state"><p>${esc(e.message)}</p><button class="btn primary" type="button" data-retry>Try again</button></div>`; return; }
  gm.compare = [];
  const best = mine?.best || {};
  app.innerHTML = `
    <div class="page-head"><h1 class="hero-title">Games</h1>
      <p class="hero-sub">A random team from history. Its real roster that season. Your squad, built on real fantasy production. Can you run the table?</p></div>
    <ol class="gm-steps" aria-label="How a challenge works">
      <li><b>1</b><span><strong>Roll</strong> a random team &amp; season</span></li>
      <li><b>2</b><span><strong>Draft</strong> on real fantasy PPG + chemistry</span></li>
      <li><b>3</b><span><strong>Simulate</strong> the real schedule</span></li>
      <li><b>4</b><span><strong>Chase</strong> the perfect record</span></li>
    </ol>
    <div class="gm-cards">${cfg.sports.map((s) => {
      const b = best[s.key];
      return `<article class="gm-card" style="--gm-c:${GM_COLORS[s.key]}">
        <div class="gm-card-top"><span class="gm-emoji" aria-hidden="true">${s.emoji}</span><span class="gm-league">${esc(s.league)}</span><span class="gm-short">${esc(s.short)}</span></div>
        <h2>${esc(s.title)}</h2>
        <p>${esc(s.blurb).replace(/(\d+-\d+)/g, '<span class="nowrap">$1</span>')}</p>
        <dl class="gm-facts">
          <div><dt>Squad</dt><dd>${s.picks} picks: ${s.slots.map((x) => `${x.n > 1 ? `${x.n} ` : ''}${esc(x.label)}`).join(', ')}</dd></div>
          <div><dt>Seasons</dt><dd>${esc(s.seasons.labelFrom)} to ${esc(s.seasons.labelTo)} · ${s.seasons.count} seasons of real rosters</dd></div>
          <div><dt>Goal</dt><dd>${s.objective === 'undefeated' ? 'Finish the league season unbeaten' : 'Win every regular-season game'}</dd></div>
        </dl>
        <div class="gm-best">${b ? `Your best: <b>${esc(gmRecord(b.record, b.sport, 9999))}</b> · ${esc(b.seasonLabel)} ${esc(b.team.name)}${b.success ? ' <span class="gm-badge win">Perfect</span>' : ''}` : '<span class="muted">No seasons yet</span>'}</div>
        <button class="btn primary gm-roll" type="button" data-roll="${s.key}">Roll a team</button>
      </article>`;
    }).join('')}</div>
    ${mine?.runs?.length ? `<div class="layout gm-history">
      <section class="panel"><h3>Your seasons <small>tick two to compare</small></h3><div class="table-scroll">${gmRunsTable(mine.runs)}</div></section>
      <aside class="side"><section class="panel" id="gmCompare"><h3>Compare</h3><p class="muted">Tick any two seasons to put them side by side.</p></section>
        <section class="panel"><h3>Totals</h3><div class="gm-totals"><div><b>${mine.totals.runs}</b><span>seasons simmed</span></div><div><b>${mine.totals.attempts}</b><span>teams rolled</span></div><div><b>${mine.totals.perfect}</b><span>perfect</span></div></div></section></aside>
    </div>` : ''}
    <p class="gm-disclaimer">${esc(cfg.disclaimer)} <a href="#/games/how">How the sim works →</a></p>`;

  $$('[data-roll]').forEach((b) => { b.onclick = () => gmRoll(b.dataset.roll, b); });
  const cmp = $('.gm-runs');
  if (cmp) cmp.onchange = (e) => {
    const box = e.target.closest('input[type=checkbox]'); if (!box) return;
    const row = mine.runs[+box.dataset.i];
    gm.compare = box.checked ? [...gm.compare, row].slice(-2) : gm.compare.filter((r) => r !== row);
    $$('.gm-runs input[type=checkbox]').forEach((x) => { x.checked = gm.compare.includes(mine.runs[+x.dataset.i]); });
    paintCompare();
  };
}

function gmRunsTable(runs) {
  return `<table class="lines gm-runs"><thead><tr><th></th><th>Team</th><th>Record</th><th>Result</th><th class="hide-sm">Fantasy PPG</th><th></th></tr></thead><tbody>
    ${runs.map((r, i) => `<tr><td><input type="checkbox" data-i="${i}" aria-label="Compare ${esc(r.seasonLabel)} ${esc(r.team.name)} run ${r.n}"></td>
      <td><span class="gm-sport-dot" style="--gm-c:${GM_COLORS[r.sport]}"></span>${esc(r.seasonLabel)} ${esc(r.team.name)} <small class="muted">#${r.n}</small></td>
      <td><b>${esc(gmRecord(r.record, r.sport, 9999))}</b></td>
      <td>${r.success ? '<span class="gm-badge win">Perfect</span>' : `<span class="gm-badge">${esc(r.tier?.label || '')}</span>`}</td>
      <td class="hide-sm">${gmF(r.combined)}</td>
      <td><a class="take-link" href="#/games/play/${esc(r.attemptId)}?run=${r.n}">View</a></td></tr>`).join('')}
  </tbody></table>`;
}

function paintCompare() {
  const el = $('#gmCompare'); if (!el) return;
  if (gm.compare.length < 2) { el.innerHTML = '<h3>Compare</h3><p class="muted">Tick any two seasons to put them side by side.</p>'; return; }
  const [a, b] = gm.compare;
  const row = (label, f, better) => {
    const va = f(a), vb = f(b);
    const w = better ? better(a, b) : 0;
    return `<tr><td>${label}</td><td class="${w > 0 ? 'gm-better' : ''}">${va}</td><td class="${w < 0 ? 'gm-better' : ''}">${vb}</td></tr>`;
  };
  const pct = (r) => (r.record.w + 0.5 * r.record.t) / r.played;
  const sameSport = a.sport === b.sport;
  el.innerHTML = `<h3>Compare</h3><table class="lines gm-cmp"><thead><tr><th></th><th>${esc(a.seasonLabel)} ${esc(a.team.abbr)}</th><th>${esc(b.seasonLabel)} ${esc(b.team.abbr)}</th></tr></thead><tbody>
    ${row('Record', (r) => esc(gmRecord(r.record, r.sport, 9999)))}
    ${row('Win %', (r) => `${(pct(r) * 100).toFixed(1)}%`, (x, y) => pct(x) - pct(y))}
    ${row('Longest streak', (r) => r.maxStreak, (x, y) => x.maxStreak - y.maxStreak)}
    ${row('Point diff', (r) => `${r.pf - r.pa > 0 ? '+' : ''}${r.pf - r.pa}`, (x, y) => (x.pf - x.pa) / x.played - (y.pf - y.pa) / y.played)}
    ${row('Fantasy PPG', (r) => gmF(r.combined), sameSport ? (x, y) => (x.combined || 0) - (y.combined || 0) : null)}
    ${row('Chemistry', (r) => (r.chem ? `+${gmF(r.chem)}` : '—'))}
    ${row('Pre-sim odds', (r) => gmPct(r.chance), (x, y) => (x.chance || 0) - (y.chance || 0))}
    ${row('MVP', (r) => esc(r.mvp?.name || '—'))}
  </tbody></table>${sameSport ? '' : '<p class="muted gm-note">Fantasy PPG isn\'t comparable across sports, so it isn\'t ranked here.</p>'}`;
}

async function gmRoll(sport, btn) {
  const cards = $$('.gm-roll');
  cards.forEach((b) => { b.disabled = true; });
  if (btn) btn.textContent = 'Rolling…';
  const msg = document.createElement('div');
  msg.className = 'gm-rolling';
  msg.innerHTML = `<div class="gm-rolling-box" role="status"><div class="gm-dice" aria-hidden="true">🎲</div><b>Rolling a random team…</b><span>Pulling that season's box scores and every player's history. The first time a season is opened this can take a few seconds.</span></div>`;
  document.body.appendChild(msg);
  try {
    const v = await api('/games/attempts', { method: 'POST', body: { sport } });
    gm.view = v; gm.squad = { ...v.attempt.squad }; gm.stage = 'draft'; gm.attemptId = v.attempt.id; gm.filter = 'all'; gm.q = ''; gm.target = null; gm.sortCol = null; gm.flash = null;
    location.hash = `#/games/play/${v.attempt.id}`;
  } catch (e) {
    toast(e.message, true);
    cards.forEach((b) => { b.disabled = false; b.textContent = 'Roll a team'; });
  } finally { msg.remove(); }
}

// =================================================================
// PLAY
// =================================================================
async function renderGamePlay(id) {
  const app = $('#app');
  const run = Number(new URLSearchParams(location.hash.split('?')[1] || '').get('run')) || null;
  const fresh = gm.view?.attempt.id === id && !run;
  if (!fresh) {
    app.innerHTML = '<a class="back" href="#/games">← All challenges</a><div class="skeleton" style="height:160px"></div><div class="skeleton" style="height:360px;margin-top:18px"></div>';
    try { gm.view = await api(run ? `/games/attempts/${id}/runs/${run}` : `/games/attempts/${id}`); }
    catch (e) { app.innerHTML = `<a class="back" href="#/games">← All challenges</a><div class="empty-state"><p>${esc(e.message)}</p><button class="btn primary" type="button" data-retry>Try again</button></div>`; return; }
    if (gm.attemptId !== id) { gm.filter = 'all'; gm.q = ''; gm.target = null; gm.sortCol = null; gm.stage = null; gm.flash = null; }
    gm.attemptId = id;
    gm.squad = { ...gm.view.attempt.squad };
  }
  const v = gm.view, at = v.attempt;
  if (!at.mine) gm.stage = v.result ? 'results' : 'locked-out';
  else if (run || (gm.stage !== 'simulate' && v.result && at.locked && gm.stage !== 'review')) gm.stage = v.result ? 'results' : gm.stage;
  if (!gm.stage) gm.stage = at.locked ? (v.result ? 'results' : 'review') : 'draft';
  if (at.locked && gm.stage === 'draft') gm.stage = 'review';
  paintPlay();
}

function paintPlay() {
  const v = gm.view, at = v.attempt, ts = v.teamSeason, rules = v.rules;
  const color = gmTeamColor(ts.team);
  const steps = [['draft', 'Draft'], ['review', 'Review'], ['simulate', 'Simulate'], ['results', 'Results']];
  const cur = steps.findIndex(([k]) => k === gm.stage);
  const hist = ts.history;
  $('#app').innerHTML = `
    <a class="back" href="#/games">← All challenges</a>
    <section class="gm-team" style="--gm-c:${color}">
      ${logo(ts.team, 'gm-logo')}
      <div class="gm-team-main">
        <div class="gm-kicker">${esc(rules.league)} · ${esc(rules.title)}</div>
        <h1>${esc(ts.seasonLabel)} ${esc(ts.team.name)}</h1>
        <p>Real record <b>${esc(gmRecord(ts.record, at.sport, ts.season))}</b> · ${ts.games}-game schedule · <span class="gm-src" title="${esc(ts.source.note)}">Real roster: ${ts.players.length} players from ${ts.coverage.boxScores} of ${ts.coverage.games} ESPN box scores${hist && hist.known < hist.players ? ` · career history for ${hist.known} of ${hist.players}` : ''}</span></p>
      </div>
      <div class="gm-goal"><span>Goal</span><b>${esc(gmGoal(rules, ts.games))}</b></div>
    </section>
    ${at.mine ? `<ol class="gm-stepper" aria-label="Progress">${steps.map(([k, l], i) => `<li class="${i < cur ? 'done' : i === cur ? 'now' : ''}" ${i === cur ? 'aria-current="step"' : ''}><span>${i + 1}</span>${l}</li>`).join('')}</ol>` : ''}
    <div id="gmStage"></div>`;
  if (gm.stage === 'draft') return paintDraft();
  if (gm.stage === 'review') return paintReview();
  if (gm.stage === 'results') return paintResults();
  if (gm.stage === 'locked-out') {
    $('#gmStage').innerHTML = '<div class="empty-state"><p>This challenge hasn\'t been simulated yet. Roll your own and beat it.</p><a class="btn primary" href="#/games">Start a challenge</a></div>';
  }
}

// ---------- draft ----------
function keyFor(p, group) {
  const pitching = group === 'SP' || group === 'RP';
  if (p.pkey && pitching) return p.pkey; // two-way player: show the pitching line under SP/RP
  return p.key;
}
function lineFor(p, group) { return p.pline && (group === 'SP' || group === 'RP') ? p.pline : p.line; }

// A player's PPG cell: the real season number, plus the number the sim uses
// when his sample is too small to take at face value.
function gmPPGCell(p, group) {
  const f = p.fp[group] || p.fp[p.group];
  if (!f) return '<span class="muted">—</span>';
  const parts = f.parts.map((x) => `${x.label}: ${gmPlus(x.ppg, 2)}`).join('\n');
  const small = f.mppg !== f.ppg;
  return `<b class="gm-ppg" title="${esc(`${f.ppg} fantasy points a game over ${f.gp} games\n${parts}`)}">${gmF(f.ppg)}</b>${small ? `<small class="gm-adj" title="${esc(`Only ${f.gp} games: the sim tops his sample up with replacement-level games and counts ${f.mppg}`)}">≈${gmF(f.mppg)}</small>` : ''}`;
}

// Client-side combined PPG (players only); chemistry comes from the server.
function gmBase(slots, byId) {
  let base = 0;
  for (const { key, slot } of slots) { const p = byId.get(gm.squad[key]); if (p) base += p.pg[gmGroup(slot, p)] ?? p.mppg; }
  return base;
}

function paintDraft() {
  const v = gm.view, ts = v.teamSeason, rules = v.rules, pv = v.preview || {};
  const slots = gmSlots(rules);
  const filled = slots.filter((s) => gm.squad[s.key]).length;
  const byId = new Map(ts.players.map((p) => [p.id, p]));
  const picked = new Set(Object.values(gm.squad));
  const target = slots.find((s) => s.key === gm.target);
  const counts = Object.fromEntries(rules.groups.map((g) => [g, ts.players.filter((p) => p.elig.includes(g)).length]));
  const group = target ? (target.slot.elig.length === 1 ? target.slot.elig[0] : null) : gm.filter !== 'all' ? gm.filter : null;
  const hints = pv.hints || {};
  const chem = pv.chem || { total: 0, players: {}, links: [] };
  const synced = JSON.stringify(v.attempt.squad) === JSON.stringify(gm.squad);
  const base = gmBase(slots, byId);
  const groupOf = (p) => (group && p.elig.includes(group) ? group : target ? gmGroup(target.slot, p) : p.group);

  let pool = ts.players.filter((p) => (target ? gmFits(target.slot, p) : gm.filter === 'all' || p.elig.includes(gm.filter)));
  if (gm.q) pool = pool.filter((p) => p.name.toLowerCase().includes(gm.q.toLowerCase()));
  const cols = group ? (keyFor(pool[0] || ts.players.find((p) => p.elig.includes(group)) || { key: [] }, group) || []).map(([k]) => k) : ['GP', 'Season'];
  const val = (p, i) => { const k = keyFor(p, group); return group ? k?.[i]?.[1] : i === 0 ? p.gp : lineFor(p, group); };
  if (gm.sortCol !== null && group) {
    const num = (x) => { const n = parseFloat(String(x ?? '').replace(/[^\d.-]/g, '')); return Number.isFinite(n) ? n : -1e9; };
    pool.sort((a, b) => num(val(b, gm.sortCol)) - num(val(a, gm.sortCol)));
  } else pool.sort((a, b) => (b.fp[groupOf(b)]?.ppg ?? 0) - (a.fp[groupOf(a)]?.ppg ?? 0) || a.name.localeCompare(b.name));

  const openFor = (p) => {
    const open = slots.filter((s) => !gm.squad[s.key] && gmFits(s.slot, p));
    if (target && open.some((s) => s.key === target.key)) return target.key;
    return (open.find((s) => !s.slot.flex) || open[0])?.key || null;
  };
  const chemBadge = (p) => {
    const h = hints[p.id]; if (!h || picked.has(p.id)) return '';
    const who = h.with.map((w) => `${w.name}: ${w.text}`).join('\n');
    return `<span class="gm-chem" title="${esc(`Adds ${h.ppg} chemistry PPG to your squad\n${who}`)}">🔗 ${h.with.length > 1 ? `${h.with.length} links` : esc(h.with[0].name.split(' ').slice(-1)[0])} <b>+${gmF(h.ppg)}</b></span>`;
  };
  const row = (p) => {
    const isIn = picked.has(p.id), slot = isIn ? null : openFor(p);
    const action = isIn ? `<button class="btn ghost gm-act" data-drop="${esc(p.id)}" title="Remove from your squad">✓ In squad</button>`
      : slot ? `<button class="btn gm-act" data-add="${esc(p.id)}">Add</button>`
        : `<button class="btn gm-act" disabled title="Every slot ${esc(p.name)} can play is already filled">No slot</button>`;
    const g = groupOf(p);
    return `<tr class="${isIn ? 'gm-in' : ''} ${gm.flash?.has(p.id) ? 'gm-flash' : ''}"><td class="gm-pname"><b>${esc(p.name)}</b>${p.college ? `<small class="gm-college">${esc(p.college)}</small>` : ''}${chemBadge(p)}${group ? '' : `<div class="gm-sub show-sm">${esc(lineFor(p, g))}</div>`}</td>
      <td><span class="gm-pos">${esc(p.pos)}</span>${p.elig.length > 1 ? `<small class="muted gm-elig">${esc(p.elig.filter((e) => e !== 'DH' || p.elig.length === 1).join('/'))}</small>` : ''}</td>
      <td class="num gm-ppgcell">${gmPPGCell(p, g)}</td>
      ${cols.map((_, i) => `<td class="${!group && i === 1 ? 'gm-line hide-sm' : 'num'}">${esc(val(p, i) ?? '')}</td>`).join('')}<td class="gm-actcell">${action}</td></tr>`;
  };
  const linked = new Set(); // squad members connected to someone else in the squad
  for (const l of chem.links) { linked.add(l.a); linked.add(l.b); }

  $('#gmStage').innerHTML = `<div class="layout gm-draft">
    <section class="panel gm-pool">
      <h3>The ${esc(ts.seasonLabel)} roster <small>${ts.players.length} players who played for them</small></h3>
      <div class="gm-filters">
        <div class="chips" role="group" aria-label="Position">
          <button class="chip" data-filter="all" aria-pressed="${gm.filter === 'all' && !target}">All <span class="count">${ts.players.length}</span></button>
          ${rules.groups.filter((g) => counts[g]).map((g) => `<button class="chip" data-filter="${esc(g)}" aria-pressed="${!target && gm.filter === g}">${esc(g)} <span class="count">${counts[g]}</span></button>`).join('')}
        </div>
        <label class="search gm-search"><svg class="ico" aria-hidden="true" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input id="gmSearch" type="search" placeholder="Find a player…" value="${esc(gm.q)}" aria-label="Find a player" autocomplete="off"></label>
      </div>
      ${target ? `<div class="gm-target">Picking for <b>${esc(target.slot.label)}</b>${target.slot.hint ? ` <span class="muted">(${esc(target.slot.hint)})</span>` : ''} <button class="linkish" type="button" id="gmClearTarget">show everyone</button></div>` : ''}
      <div class="table-scroll"><table class="lines gm-table"><thead><tr><th>Player</th><th>Pos</th><th class="num"><button type="button" class="gm-sort ${gm.sortCol === null ? 'on' : ''}" data-col="ppg" title="Real fantasy points per game this season">PPG</button></th>${cols.map((c, i) => `<th class="${!group && i === 1 ? 'hide-sm' : ''}">${group ? `<button type="button" class="gm-sort ${gm.sortCol === i ? 'on' : ''}" data-col="${i}" title="Sort by ${esc(c)}">${esc(c)}</button>` : esc(c)}</th>`).join('')}<th></th></tr></thead>
        <tbody>${pool.length ? pool.map(row).join('') : `<tr><td colspan="${cols.length + 4}" class="muted" style="text-align:center;padding:24px">No players match.</td></tr>`}</tbody></table></div>
      <p class="muted gm-note">PPG is each player's real fantasy points per game with this team in ${esc(ts.seasonLabel)}. Hover a PPG to see where the points came from. 🔗 marks a verified connection to someone you've drafted.</p>
    </section>
    <aside class="side gm-board">
      <section class="panel">
        <h3>Your squad <small>${filled} of ${slots.length}</small></h3>
        <div class="gm-total" aria-live="polite"><span>Combined fantasy PPG</span><b>${gmF(base + (synced ? chem.total : 0))}</b>
          <small>${gmF(base)} from players${synced ? ` + ${gmF(chem.total)} chemistry` : ' · chemistry updating…'}</small></div>
        <div class="gm-meter" role="progressbar" aria-valuemin="0" aria-valuemax="${slots.length}" aria-valuenow="${filled}"><i style="width:${(filled / slots.length) * 100}%"></i></div>
        <ul class="gm-slots">${slots.map(({ key, slot }) => {
          const p = byId.get(gm.squad[key]);
          const g = p && gmGroup(slot, p);
          const bonus = p && synced ? chem.players[p.id]?.bonus : 0;
          return `<li class="gm-slot ${p ? 'filled' : ''} ${gm.target === key ? 'target' : ''} ${p && gm.flash?.has(p.id) ? 'gm-flash' : ''}">
            <span class="gm-slot-pos">${esc(slot.label)}</span>
            ${p ? `<span class="gm-slot-name"><b>${linked.has(p.id) && synced ? '<span class="gm-link" title="Has chemistry with a squad mate">🔗</span> ' : ''}${esc(p.name)}</b><small>${gmF(p.pg[g])} PPG${bonus ? ` <span class="gm-bonus">+${gmF(bonus, 2)} chem</span>` : ''} · ${esc(lineFor(p, g))}</small></span><button type="button" class="gm-x" data-remove="${esc(key)}" aria-label="Remove ${esc(p.name)}">×</button>`
              : `<button type="button" class="gm-slot-empty" data-target="${esc(key)}">Pick ${slot.hint ? `a ${esc(slot.label.toLowerCase())} (${esc(slot.hint)})` : `a ${esc(slot.label)}`}</button>`}
          </li>`;
        }).join('')}</ul>
        ${gmChemList(synced ? chem.links : [], 4)}
        <button class="btn primary gm-next" type="button" id="gmToReview" ${filled === slots.length ? '' : 'disabled'}>${filled === slots.length ? 'Review squad →' : `${slots.length - filled} pick${slots.length - filled === 1 ? '' : 's'} to go`}</button>
      </section>
      <section class="panel gm-rules"><h3>Rules</h3><p>${esc(rules.scheduleNote)}</p><p class="muted">${esc(rules.unitNote)}</p><p class="muted"><a href="#/games/how">Scoring and chemistry rules →</a></p></section>
    </aside>
  </div>
  <div class="gm-mobilebar"><span><b>${filled}</b>/${slots.length} · <b>${gmF(base + (synced ? chem.total : 0))}</b> PPG</span><button class="btn primary" type="button" id="gmToReview2" ${filled === slots.length ? '' : 'disabled'}>Review →</button></div>`;

  const stage = $('#gmStage');
  stage.onclick = (e) => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.dataset.filter) { gm.filter = t.dataset.filter; gm.target = null; gm.sortCol = null; gm.flash = null; return paintDraft(); }
    if (t.dataset.col !== undefined && t.classList.contains('gm-sort')) { gm.sortCol = t.dataset.col === 'ppg' || gm.sortCol === +t.dataset.col ? null : +t.dataset.col; return paintDraft(); }
    if (t.dataset.target) { gm.target = gm.target === t.dataset.target ? null : t.dataset.target; gm.sortCol = null; gm.flash = null; paintDraft(); $('.gm-pool')?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' }); return; }
    if (t.id === 'gmClearTarget') { gm.target = null; return paintDraft(); }
    if (t.dataset.remove) { delete gm.squad[t.dataset.remove]; gm.flash = null; gmQueueSave(); return paintDraft(); }
    if (t.dataset.drop) { for (const [k, id] of Object.entries(gm.squad)) if (id === t.dataset.drop) delete gm.squad[k]; gm.flash = null; gmQueueSave(); return paintDraft(); }
    if (t.dataset.add) {
      const p = byId.get(t.dataset.add), key = p && openFor(p);
      if (!key) return toast('No open slot for that player.', true);
      gm.squad[key] = p.id;
      if (gm.target === key) gm.target = null;
      // Light up the squad mates this pick has chemistry with.
      const h = hints[p.id];
      gm.flash = h ? new Set([p.id, ...h.with.map((w) => w.id)]) : null;
      if (h) toast(`🔗 ${p.name} + ${h.with.map((w) => w.name).join(', ')}: +${gmF(h.ppg)} chemistry PPG`);
      gmQueueSave(); paintDraft();
      return;
    }
    if (t.id === 'gmToReview' || t.id === 'gmToReview2') gmGoReview();
  };
  let qT;
  $('#gmSearch').oninput = (e) => { clearTimeout(qT); qT = setTimeout(() => { gm.q = e.target.value.trim(); const pos = e.target.selectionStart; paintDraft(); const s = $('#gmSearch'); s.focus(); s.setSelectionRange(pos, pos); }, 180); };
}

// Chemistry links, strongest first.
function gmChemList(links, max = 99, empty = '') {
  if (!links?.length) return empty ? `<p class="muted gm-note">${empty}</p>` : '';
  return `<div class="gm-chemlist"><h4>Chemistry</h4><ul>${links.slice(0, max).map((l) => `<li><span class="gm-kinds" aria-hidden="true">${(l.kinds || []).map((k) => GM_KIND[k.kind || k] || '').join('')}</span><span><b>${esc(l.aName || l.a)} + ${esc(l.bName || l.b)}</b><small>${esc((l.kinds || []).map((k) => k.text || '').filter(Boolean).join(' · ') || l.text || '')}</small></span><em>+${gmF(l.ppg, 2)}</em></li>`).join('')}</ul>${links.length > max ? `<p class="muted gm-note">and ${links.length - max} more</p>` : ''}</div>`;
}

// Drafts save to the server (which re-checks and re-scores them) shortly after each change.
function gmQueueSave() {
  clearTimeout(gm.saveT);
  gm.saveT = setTimeout(gmSave, 350);
}
async function gmSave() {
  clearTimeout(gm.saveT);
  const v = gm.view;
  const p = api(`/games/attempts/${v.attempt.id}/squad`, { method: 'POST', body: { squad: gm.squad } });
  gm.saving = p;
  try {
    const r = await p;
    if (gm.saving !== p) return r;
    v.attempt.squad = r.squad; v.preview = r.preview;
    // Repaint with fresh chemistry, unless the user is mid-search.
    if (gm.stage === 'draft' && document.activeElement?.id !== 'gmSearch') paintDraft();
    return r;
  } catch (e) {
    toast(e.message, true);
    gm.squad = { ...v.attempt.squad };
    if (gm.stage === 'draft') paintDraft();
    throw e;
  }
}

async function gmGoReview() {
  try { await gmSave(); } catch { return; }
  gm.stage = 'review'; gm.flash = null; paintPlay(); window.scrollTo(0, 0);
}

// ---------- review ----------
function paintReview() {
  const v = gm.view, ts = v.teamSeason, rules = v.rules, at = v.attempt, pv = v.preview || {};
  const byId = new Map(ts.players.map((p) => [p.id, p]));
  const slots = gmSlots(rules);
  const missing = slots.filter((s) => !gm.squad[s.key]);
  const chem = pv.chem || { total: 0, players: {}, links: [] };
  $('#gmStage').innerHTML = `<div class="layout gm-review">
    <div>
      <section class="panel"><h3>Squad review <small>${at.locked ? 'locked in' : 'real fantasy production'}</small></h3>
        <div class="table-scroll"><table class="lines gm-table gm-reviewtable"><thead><tr><th>Slot</th><th>Player</th><th class="hide-sm">Real season</th><th class="num">PPG</th><th class="num">Chem</th></tr></thead><tbody>
          ${slots.map(({ key, slot }) => {
            const p = byId.get(gm.squad[key]);
            if (!p) return `<tr class="gm-missing"><td><span class="gm-pos">${esc(slot.label)}</span></td><td colspan="4">Empty: pick a ${esc(slot.label)}</td></tr>`;
            const g = gmGroup(slot, p), bonus = chem.players[p.id]?.bonus;
            return `<tr><td><span class="gm-pos">${esc(slot.label)}</span></td><td><b>${esc(p.name)}</b> <small class="muted">${esc(p.pos)}${p.college ? ` · ${esc(p.college)}` : ''}</small><div class="gm-sub show-sm">${esc(lineFor(p, g))}</div></td><td class="hide-sm gm-line">${esc(lineFor(p, g))}</td><td class="num gm-ppgcell">${gmPPGCell(p, g)}</td><td class="num">${bonus ? `<span class="gm-bonus">+${gmF(bonus, 2)}</span>` : '<span class="muted">—</span>'}</td></tr>`;
          }).join('')}
        </tbody><tfoot><tr class="gm-tot"><td colspan="3">Combined fantasy PPG <small class="muted">players ${gmF(pv.base)} + chemistry ${gmF(chem.total)}</small></td><td class="num" colspan="2"><b>${gmF(pv.combined)}</b></td></tr></tfoot></table></div>
        <p class="muted gm-note">"≈" marks a player with only a handful of games: the sim tops his sample up with replacement-level games until it's big enough. Everyone else counts at his real PPG.</p>
      </section>
      <section class="panel"><h3>Chemistry <small>${chem.links.length ? `+${gmF(chem.total)} PPG from ${chem.links.length} connection${chem.links.length === 1 ? '' : 's'}` : 'no connections'}</small></h3>
        ${gmChemList(chem.links, 12, 'None of your picks share a college, a past team or a national team. That\'s fine: chemistry is a small bonus on top of real production.')}
      </section>
    </div>
    <aside class="side">
      <section class="panel gm-odds"><h3>Before you sim</h3>
        ${pv.complete && pv.odds ? `<div class="gm-oddsgrid">
            <div class="wide"><span>Combined fantasy PPG</span><b>${gmF(pv.combined)}</b><small>${gmF(pv.base)} from players + ${gmF(chem.total)} chemistry</small></div>
            <div class="wide"><span>Projected</span><b>${pv.odds.avgWins} wins</b><small>usually ${pv.odds.low} to ${pv.odds.high} of ${pv.odds.games}</small></div>
            <div><span>${rules.objective === 'undefeated' ? 'Unbeaten odds' : 'Perfect odds'}</span><b>${gmPct(pv.odds.chance)}</b></div>
            <div><span>Chemistry worth</span><b>${pv.odds.chemWins != null ? `${gmPlus(pv.odds.chemWins)}` : '0'}</b><small>wins a season</small></div>
          </div><p class="muted gm-note">From ${pv.odds.runs} quick test seasons of this exact squad against the real schedule.</p>`
          : `<p>Your squad isn't complete yet. Still to fill: <b>${missing.map((s) => esc(s.slot.label)).join(', ')}</b>.</p>`}
        <div class="gm-cta">
          ${at.locked
            ? `<button class="btn primary" type="button" id="gmSim">Simulate the season</button><button class="btn ghost" type="button" id="gmRebuild">Rebuild squad</button>`
            : `<button class="btn primary" type="button" id="gmLock" ${pv.complete ? '' : 'disabled'}>Lock in &amp; simulate</button><button class="btn ghost" type="button" id="gmEdit">← Edit squad</button>`}
        </div>
        <p class="muted gm-note">${at.locked ? 'Locked squads can be re-simmed as often as you like, or rebuilt.' : 'Once locked, the squad is set for this run. You can rebuild it after.'}</p>
      </section>
      <section class="panel gm-rules"><h3>Rules</h3><p>${esc(rules.scheduleNote)}</p><p class="muted">${esc(rules.unitNote)}</p></section>
    </aside>
  </div>`;
  $('#gmEdit')?.addEventListener('click', () => { gm.stage = 'draft'; paintPlay(); });
  $('#gmLock')?.addEventListener('click', async (e) => {
    e.target.disabled = true; e.target.textContent = 'Locking in…';
    try { gm.view = await api(`/games/attempts/${at.id}/lock`, { method: 'POST', body: { squad: gm.squad } }); gmSimulate(); }
    catch (err) { toast(err.message, true); e.target.disabled = false; e.target.textContent = 'Lock in & simulate'; }
  });
  $('#gmSim')?.addEventListener('click', gmSimulate);
  $('#gmRebuild')?.addEventListener('click', gmRebuild);
}

async function gmRebuild() {
  const at = gm.view.attempt;
  try {
    await api(`/games/attempts/${at.id}/unlock`, { method: 'POST', body: {} });
    at.locked = false; gm.squad = { ...at.squad }; gm.stage = 'draft';
    history.replaceState(null, '', `#/games/play/${at.id}`);
    paintPlay(); window.scrollTo(0, 0);
    toast('Squad unlocked. Same team, new plan.');
  } catch (e) { toast(e.message, true); }
}

// ---------- simulate ----------
async function gmSimulate() {
  const at = gm.view.attempt;
  gm.stage = 'simulate'; paintPlay();
  $('#gmStage').innerHTML = '<section class="panel gm-sim"><div class="gm-sim-top"><div class="gm-record">0-0</div><div class="gm-sim-meta">Simulating…</div></div><div class="gm-progress"><i style="width:0"></i></div></section>';
  let v;
  try { v = await api(`/games/attempts/${at.id}/simulate`, { method: 'POST', body: {} }); }
  catch (e) { toast(e.message, true); gm.stage = 'review'; paintPlay(); return; }
  gm.view = v;
  history.replaceState(null, '', `#/games/play/${at.id}?run=${v.result.n}`);
  revealSeason(v);
}

// Reveal the season game by game (a few seconds total, or instantly).
function revealSeason(v) {
  const r = v.result, rules = v.rules, sport = v.attempt.sport, season = v.teamSeason.season;
  const n = r.games.length;
  const done = () => { clearInterval(gm.revealT); gm.stage = 'results'; paintPlay(); if (r.success) confetti(260); };
  if (reduceMotion) return done();
  $('#gmStage').innerHTML = `<section class="panel gm-sim" aria-live="polite">
    <div class="gm-sim-top"><div class="gm-record" id="gmRec">0-0</div>
      <div class="gm-sim-meta"><div>Game <b id="gmN">0</b> of ${n}</div><div id="gmState" class="gm-alive">${rules.objective === 'undefeated' ? 'Unbeaten' : 'Perfect'} so far</div></div>
      <button class="btn ghost" type="button" id="gmSkip">Skip to the end</button></div>
    <div class="gm-progress"><i id="gmBar"></i></div>
    <div class="gm-latest" id="gmLatest"></div>
    <ol class="gm-chips" id="gmChips"></ol>
  </section>`;
  $('#gmSkip').onclick = done;
  const rec = { w: 0, l: 0, t: 0, otl: 0 };
  let i = 0, dead = false;
  const step = Math.max(25, Math.min(420, 6500 / n));
  const perTick = n > 120 ? 2 : 1;
  gm.revealT = setInterval(() => {
    if (!$('#gmChips')) return clearInterval(gm.revealT);
    for (let k = 0; k < perTick && i < n; k++, i++) {
      const g = r.games[i];
      rec[{ W: 'w', L: 'l', T: 't', OTL: 'otl' }[g.res]]++;
      const li = document.createElement('li');
      li.className = gmRes(g.res); li.textContent = g.opp.abbr;
      li.title = `${g.res} ${g.us}-${g.them} ${g.home ? 'vs' : 'at'} ${g.opp.abbr}${g.extra ? ` (${g.extra})` : ''}`;
      $('#gmChips').appendChild(li);
      $('#gmLatest').innerHTML = `<span class="gm-badge ${gmRes(g.res) === 'w' ? 'win' : gmRes(g.res) === 't' ? 'tie' : 'loss'}">${g.res === 'OTL' ? 'OTL' : g.res}</span> ${g.us}-${g.them} ${g.home ? 'vs' : 'at'} <b>${esc(g.opp.name)}</b>${g.extra ? ` <small class="muted">${esc(g.extra)}</small>` : ''}${g.star ? ` · <span class="muted">${esc(g.star.name)}: ${esc(g.star.line)} (${gmF(g.star.fp)} pts)</span>` : ''}`;
      const broke = rules.objective === 'undefeated' ? (g.res === 'L' || g.res === 'OTL') : g.res !== 'W';
      if (broke && !dead) { dead = true; const s = $('#gmState'); s.className = 'gm-dead'; s.textContent = `The dream died in game ${g.n}`; }
    }
    $('#gmRec').textContent = gmRecord(rec, sport, season);
    $('#gmN').textContent = i;
    $('#gmBar').style.width = `${(i / n) * 100}%`;
    if (i >= n) { clearInterval(gm.revealT); setTimeout(done, 700); }
  }, step);
}

// ---------- results ----------
function paintResults() {
  const v = gm.view, r = v.result, ts = v.teamSeason, rules = v.rules, at = v.attempt, sport = at.sport;
  if (!r) { gm.stage = at.locked ? 'review' : 'draft'; return paintPlay(); }
  const recTxt = gmRecord(r.record, sport, ts.season);
  const blem = r.firstBlemish ? r.games[r.firstBlemish - 1] : null;
  const head = r.tier.id === 'perfect' ? `Perfect season. ${recTxt}.`
    : r.tier.id === 'unbeaten' ? `Invincible. ${recTxt}, unbeaten.`
      : r.tier.id === 'close' ? `${recTxt}. One game from immortality.`
        : `${recTxt}. ${r.tier.label}.`;
  const diff = r.pf - r.pa;
  const unit = { nfl: 'pts', nba: 'pts', mlb: 'runs', nhl: 'goals', epl: 'goals' }[sport];
  const realRec = ts.record, realPct = ((realRec.w + 0.5 * realRec.t) / (realRec.gp || 1)) * 100;
  const gameRow = (g) => `<tr class="gm-g-${gmRes(g.res)}"><td>${g.n}</td><td>${g.home ? 'vs' : '@'} ${esc(g.opp.abbr)}</td><td><span class="gm-badge ${gmRes(g.res) === 'w' ? 'win' : gmRes(g.res) === 't' ? 'tie' : 'loss'}">${g.res}</span> ${g.us}-${g.them}${g.extra ? ` <small class="muted">${esc(g.extra)}</small>` : ''}</td><td class="hide-sm muted">${g.real ? `${g.real.us}-${g.real.them}` : ''}</td><td class="num hide-sm">${gmF(g.fp)}</td><td class="gm-line">${g.star ? `${esc(g.star.name)}: ${esc(g.star.line)}` : ''}</td></tr>`;
  const many = r.games.length > 40;
  const vorTxt = (p) => `${gmPlus(p.vor)} PPG vs. a replacement ${esc(p.slotLabel)}`;
  $('#gmStage').innerHTML = `
    <section class="gm-verdict ${r.success ? 'win' : ''}">
      <div class="gm-kicker">Run ${r.n} of ${r.of} · simulated by GMmode${r.drift ? ' · re-simulated with a newer engine; the stored record is the original' : ''}</div>
      <h2>${esc(head)}</h2>
      <p>${blem ? `The ${rules.objective === 'undefeated' ? 'unbeaten run' : 'perfect season'} ended in game ${blem.n}: ${blem.res} ${blem.us}-${blem.them} ${blem.home ? 'vs' : 'at'} ${esc(blem.opp.name)}.` : rules.objective === 'undefeated' && r.record.t ? `Not a single loss. ${r.record.t} draw${r.record.t === 1 ? '' : 's'} kept it from being perfect.` : 'Not a single slip all season.'}
        The real ${esc(ts.seasonLabel)} ${esc(ts.team.name)} went ${esc(gmRecord(ts.record, sport, ts.season))}.${r.beatReal ? ' <b>You beat history.</b>' : ''}</p>
      <div class="stats gm-stats">
        <div class="stat ${r.success ? 'hot' : ''}"><b>${esc(recTxt)}</b><span>record</span></div>
        <div class="stat"><b>${gmF(r.winPct)}%</b><span>win rate (real: ${gmF(realPct)}%)</span></div>
        <div class="stat"><b>${r.maxStreak}</b><span>longest win streak</span></div>
        <div class="stat"><b>${r.maxLoseStreak}</b><span>longest losing streak</span></div>
        <div class="stat"><b>${diff > 0 ? '+' : ''}${diff}</b><span>${unit} differential</span></div>
        <div class="stat"><b>${gmF(r.team.combined)}</b><span>combined fantasy PPG</span></div>
      </div>
      ${at.mine ? `<div class="gm-actions">
        <button class="btn primary" type="button" id="gmAgain">Run it back</button>
        <button class="btn" type="button" id="gmRebuild2">Rebuild squad</button>
        <button class="btn" type="button" id="gmNew">Roll a new ${esc(rules.league)} team</button>
        <button class="btn ghost" type="button" id="gmShare">Share</button>
      </div>` : `<div class="gm-actions"><a class="btn primary" href="#/games">Start your own challenge</a></div>`}
    </section>
    <div class="layout gm-results">
      <div>
        <section class="panel"><h3>Game by game <small>real result in grey</small></h3>
          <ol class="gm-chips static">${r.games.map((g) => `<li class="${gmRes(g.res)}" title="${esc(`Game ${g.n}: ${g.res} ${g.us}-${g.them} ${g.home ? 'vs' : 'at'} ${g.opp.abbr}`)}">${esc(g.opp.abbr)}</li>`).join('')}</ol>
          ${many ? `<div class="chips gm-logfilter" role="group" aria-label="Show games"><button class="chip" data-log="miss" aria-pressed="true">Losses &amp; draws</button><button class="chip" data-log="all" aria-pressed="false">All ${r.games.length}</button></div>` : ''}
          <div class="table-scroll"><table class="lines gm-log"><thead><tr><th>#</th><th>Opp</th><th>Result</th><th class="hide-sm">Real</th><th class="num hide-sm" title="Your squad's fantasy points that game">FPTS</th><th>Star</th></tr></thead><tbody id="gmLog">${(many ? r.games.filter((g) => g.res !== 'W') : r.games).map(gameRow).join('') || '<tr><td colspan="6" class="muted" style="text-align:center;padding:16px">No losses. None.</td></tr>'}</tbody></table></div>
        </section>
        <section class="panel"><h3>Fantasy production <small>simulated season vs. real one</small></h3>
          <div class="table-scroll"><table class="lines gm-table gm-break"><thead><tr><th>Player</th><th class="num" title="Real fantasy PPG this season">Real PPG</th><th class="num" title="Chemistry bonus PPG">Chem</th><th class="num" title="Fantasy PPG in the simulated season">Sim PPG</th><th>Simulated season</th><th class="hide-sm">Real season</th></tr></thead><tbody>
            ${[...r.players].sort((a, b) => b.simFp - a.simFp).map((p) => `<tr><td><b>${esc(p.name)}</b> <small class="muted">${esc(p.slotLabel)}</small></td><td class="num">${gmF(p.ppg)}</td><td class="num">${p.bonus ? `<span class="gm-bonus">+${gmF(p.bonus, 2)}</span>` : '<span class="muted">—</span>'}</td><td class="num"><b>${gmF(p.simPpg)}</b></td><td class="gm-line">${esc(p.sim)}</td><td class="hide-sm gm-line muted">${esc(p.real)}</td></tr>`).join('')}
          </tbody><tfoot><tr class="gm-tot"><td>Team</td><td class="num">${gmF(r.team.base)}</td><td class="num"><span class="gm-bonus">+${gmF(r.team.chem, 2)}</span></td><td class="num"><b>${gmF(r.team.simPpg)}</b></td><td colspan="2" class="muted">combined going in: ${gmF(r.team.combined)} PPG</td></tr></tfoot></table></div>
        </section>
      </div>
      <aside class="side">
        <section class="panel"><h3>Highs and lows</h3><ul class="gm-hl">
          ${r.mvp ? `<li><span>MVP</span><b>${esc(r.mvp.name)}</b><small>${gmF(r.mvp.simPpg)} PPG · ${vorTxt(r.mvp)}</small></li>` : ''}
          ${r.weakest ? `<li><span>Weakest link</span><b>${esc(r.weakest.name)}</b><small>${gmF(r.weakest.simPpg)} PPG · ${vorTxt(r.weakest)}</small></li>` : ''}
          ${r.bestWin ? `<li><span>Best win</span><b>${r.bestWin.us}-${r.bestWin.them} ${r.bestWin.home ? 'vs' : 'at'} ${esc(r.bestWin.opp.abbr)}</b><small>Game ${r.bestWin.n}</small></li>` : ''}
          ${r.worstLoss ? `<li><span>Worst ${r.worstLoss.res === 'T' ? 'result' : 'loss'}</span><b>${r.worstLoss.us}-${r.worstLoss.them} ${r.worstLoss.home ? 'vs' : 'at'} ${esc(r.worstLoss.opp.abbr)}</b><small>Game ${r.worstLoss.n}</small></li>` : ''}
        </ul></section>
        <section class="panel"><h3>Chemistry <small>${r.team.chem ? `+${gmF(r.team.chem)} PPG` : 'none'}</small></h3>
          ${r.chemWins != null ? `<p class="gm-note">Worth about <b>${gmPlus(r.chemWins)} wins</b> a season to this squad (from the pre-sim projection).</p>` : ''}
          ${gmChemList(r.chemistry.links, 6, 'No connections in this squad.')}
        </section>
        <section class="panel"><h3>Closest games</h3><ul class="gm-hl">${r.closest.map((g) => `<li><span>Game ${g.n} · ${g.res}</span><b>${g.us}-${g.them} ${g.home ? 'vs' : 'at'} ${esc(g.opp.abbr)}${g.extra ? ` <small class="muted">${esc(g.extra)}</small>` : ''}</b></li>`).join('')}</ul></section>
        <section class="panel"><h3>Best performances</h3><ol class="gm-perf">${r.topPerformances.map((x) => `<li><b>${esc(x.name)}</b><span>${esc(x.line)} · ${gmF(x.fp)} pts</span><small>Game ${x.n} · ${x.res} ${esc(x.score)} ${x.home ? 'vs' : 'at'} ${esc(x.opp)}</small></li>`).join('')}</ol></section>
        <section class="panel"><h3>Against history</h3><ul class="gm-hl">
          <li><span>The real ${esc(ts.seasonLabel)} ${esc(ts.team.abbr)}</span><b>${esc(gmRecord(ts.record, sport, ts.season))}</b><small>${gmF(realPct)}% · you ${r.beatReal ? 'beat' : 'didn\'t beat'} them</small></li>
          ${rules.benchmark?.text ? `<li><span>All-time</span><small>${esc(rules.benchmark.text)}</small></li>` : ''}
        </ul></section>
        ${at.runs.length > 1 ? `<section class="panel"><h3>This team's runs</h3><ul class="gm-runlist">${[...at.runs].reverse().map((x) => `<li class="${x.n === r.n ? 'on' : ''}"><a href="#/games/play/${esc(at.id)}?run=${x.n}">Run ${x.n}</a><b>${esc(gmRecord(x.record, sport, ts.season))}</b>${x.success ? '<span class="gm-badge win">Perfect</span>' : `<small class="muted">${esc(x.tier?.label || '')}</small>`}</li>`).join('')}</ul></section>` : ''}
      </aside>
    </div>
    <p class="gm-disclaimer">${esc(v.disclaimer)} <a href="#/games/how">How the sim works →</a></p>`;

  $('.gm-logfilter')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-log]'); if (!b) return;
    $$('.gm-logfilter .chip').forEach((x) => x.setAttribute('aria-pressed', x === b));
    const list = b.dataset.log === 'all' ? r.games : r.games.filter((g) => g.res !== 'W');
    $('#gmLog').innerHTML = list.map(gameRow).join('') || '<tr><td colspan="6" class="muted" style="text-align:center;padding:16px">No losses. None.</td></tr>';
  });
  if (!at.mine) return;
  $('#gmAgain').onclick = gmSimulate;
  $('#gmRebuild2').onclick = gmRebuild;
  $('#gmNew').onclick = (e) => gmRoll(sport, e.target);
  $('#gmShare').onclick = () => {
    const url = `${location.origin}/#/games/play/${at.id}?run=${r.n}`;
    const text = `I went ${recTxt} with the ${ts.seasonLabel} ${ts.team.name} in ${rules.title} on GMmode.${r.success ? ' PERFECT.' : ''} Can you beat it?`;
    if (navigator.share) navigator.share({ title: rules.title, text, url }).catch(() => {});
    else navigator.clipboard?.writeText(`${text} ${url}`).then(() => toast('Result copied. Go brag.'), () => toast('Couldn\'t copy. Here\'s the link: ' + url));
  };
}

// =================================================================
// HOW IT WORKS
// =================================================================
async function renderGamesHow() {
  const app = $('#app');
  let cfg;
  try { cfg = await gmConfig(); } catch (e) { app.innerHTML = `<div class="empty-state"><p>${esc(e.message)}</p><button class="btn primary" type="button" data-retry>Try again</button></div>`; return; }
  const setName = { all: '', bat: 'Hitters', pitch: 'Pitchers', skater: 'Skaters', goalie: 'Goalies', GK: 'Goalkeepers', DEF: 'Defenders', MID: 'Midfielders', FWD: 'Forwards' };
  const ch = cfg.chemistry;
  app.innerHTML = `<a class="back" href="#/games">← All challenges</a>
    <div class="page-head"><h1 class="hero-title">How the sim works</h1><p class="hero-sub">Real rosters, real stats, real fantasy points, real schedules. Simulated games.</p></div>
    <div class="gm-how">
      <section class="panel"><h3>1. The data is real</h3>
        <p>When you roll, the server picks a random season, then a random team from that season's real standings. The player pool is every player who appeared for that team in that season's regular-season box scores on ESPN's public feed. Stats are summed from those games only, so a player traded mid-season counts only his games with this team.</p>
        <table class="lines"><thead><tr><th>Challenge</th><th>Seasons with real box scores</th></tr></thead><tbody>${cfg.sports.map((s) => `<tr><td>${s.emoji} ${esc(s.title)}</td><td>${esc(s.seasons.labelFrom)} to ${esc(s.seasons.labelTo)} (${s.seasons.count})</td></tr>`).join('')}</tbody></table>
        <p class="muted">Older seasons exist on ESPN without player box scores, so they're left out rather than filled in. Nothing is invented: if a season's data is too thin, or a download fails, the roll is redone.</p></section>
      <section class="panel"><h3>2. Every player has a real fantasy PPG</h3>
        <p>Each sport has one fixed scoring formula, applied to every player's stats from the season you rolled (never career numbers). PPG is his fantasy points divided by the games he actually played. If he only played a handful of games, the sim leans his number toward a typical replacement player until the sample is big enough, and the draft board shows both.</p>
        ${cfg.sports.map((s) => { const f = cfg.scoring[s.key]; return `<details class="gm-formula"><summary>${s.emoji} ${esc(s.label)}: ${esc(f.name)}</summary>
          <div class="gm-formula-sets">${f.sets.map((set) => `<table class="lines"><thead><tr><th>${esc(setName[set.set] ?? set.set) || 'Stat'}</th><th class="num">Pts</th></tr></thead><tbody>${set.rows.map((x) => `<tr><td>${esc(x.label)}</td><td class="num">${x.pts > 0 ? '+' : ''}${x.pts}</td></tr>`).join('')}</tbody></table>`).join('')}</div>
          <p class="muted">${esc(f.omitted)}</p></details>`; }).join('')}
      </section>
      <section class="panel"><h3>3. Combined PPG and chemistry</h3>
        <p>Your squad's strength starts as the sum of your players' fantasy PPG, each in the slot he fills. Then chemistry: players with a verified history together get a small bonus, paid in fantasy points per game.</p>
        <ul class="gm-list">
          <li>🎓 <b>Same college</b> (from ESPN athlete records): +${esc(ch.college)} of each player's PPG.</li>
          <li>🤝 <b>Former teammates</b>: they played for the same franchise in the same season before this one (ESPN's season-by-season logs). +${esc(ch.season)} per shared season, up to ${ch.maxSeasons} seasons. The same franchise in different years doesn't count.</li>
          <li>🏳️ <b>National team</b> (soccer): they played for the same national team in the same international competition season, on a team ESPN marks as a national team. +${esc(ch.national)}.</li>
        </ul>
        <p>Connections stack for a pair up to +${esc(ch.pairCap)}, and a player's total chemistry is capped at +${esc(ch.playerCap)} of his PPG. Every pair and every shared season counts once. Chemistry helps, but it can't turn a weak player into a strong one.</p></section>
      <section class="panel"><h3>4. Fair across sports and eras</h3>
        <p>Fantasy points mean different things in different sports, and even in different eras of one sport. So your combined PPG is never compared with a fixed number. Instead it's adjusted for that season's league scoring level and placed among thousands of comparable rosters, with the same slots, drafted from real team-seasons in the same sport. Where it lands in that distribution is what drives the simulation. Those internal numbers aren't shown: you find out how good a squad is by building it.</p></section>
      <section class="panel"><h3>5. Each game is simulated</h3>
        <p>For every game on the real schedule, expected scores come from that season's real league scoring level, your roster's strength, and that opponent's real points for and against, plus home field. A score is drawn from a distribution shaped like the sport: touchdowns and field goals, a bell curve for basketball, goals and runs that arrive one at a time. Ties follow that season's real rules: NHL ties before 2005-06 and shootouts after, overtime in football, extra innings in baseball, and draws in soccer. In baseball the day's starter changes your strength that game.</p>
        <p>Player lines are drawn from each player's real per-game numbers, kept consistent with the score, and scored with the same fantasy formula. The model is calibrated on real seasons: draft a team's best players and you'll land near that team's real record on average. Better production means better odds, but upsets happen, and perfect seasons are rare because they're rare in real life.</p></section>
      <section class="panel"><h3>6. What isn't modeled</h3>
        <p>Injuries, rest and trades during your season (your squad plays every game). Offensive linemen and baseball defense, which box scores don't credit. Coaching and playoffs. Some stat categories aren't scored because ESPN didn't record them in every season; each sport's list is under its formula above.</p></section>
    </div>
    <p class="gm-disclaimer">${esc(cfg.disclaimer)}</p>`;
}

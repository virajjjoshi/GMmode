/* Games: the historical perfect-season challenges.
   Every pick comes from a new random historical team and season: roll a team ->
   draft ONE player from its real roster -> a new team is rolled -> ... until
   the squad is full -> simulate a real schedule -> chase the perfect record.
   One manual reroll per draft. Routes: #/games (landing),
   #/games/play/<id>[?run=n], #/games/how.
   The server owns everything: it rolls each team, checks every pick against
   the roster it actually rolled, keeps the draft state (so a refresh resumes)
   and runs the sim. This file only draws it. Loaded before app.js; uses its helpers. */
'use strict';

const gm = { config: null, view: null, stage: null, filter: 'open', q: '', sortCol: null, target: null, revealT: null, attemptId: null, compare: [], flash: null, busy: false };
const GM_COLORS = { nfl: 'var(--good)', nba: 'var(--orange)', mlb: 'var(--cool)', nhl: 'var(--purple)', epl: 'var(--hot)' };
const GM_KIND = { college: '🎓', teammates: '🤝', national: '🏳️' };
const GM_HOW = 'Draft one player from each randomly generated historical team and season. After every selection, a new team and season are rolled automatically. You get one manual reroll per simulation.';

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
const gmGoal = (rules, games) => (rules.objective === 'undefeated' ? 'Unbeaten' : games ? `${games}-0` : 'Perfect');
const gmPct = (x) => (x == null ? '—' : x === 0 ? '<0.1%' : x >= 0.995 ? '>99%' : `${(x * 100).toFixed(x < 0.1 ? 1 : 0)}%`);
const gmRes = (r) => ({ W: 'w', L: 'l', T: 't', OTL: 'l' }[r] || 'l');
const gmF = (x, d = 1) => (x == null || !Number.isFinite(+x) ? '—' : (+x).toFixed(d));
const gmPlus = (x, d = 1) => (x > 0 ? `+${gmF(x, d)}` : gmF(x, d));
function gmTeamColor(team) { return usable({ color: team?.color, alt: null }) || 'var(--accent)'; }
function gmSlots(rules) { return rules.slots.flatMap((s) => Array.from({ length: s.n }, (_, i) => ({ key: `${s.id}.${i}`, slot: s }))); }
const gmFits = (slot, p) => slot.elig.some((g) => p.elig.includes(g));
// The group a slot scores this player in (his best-scoring eligible one).
const gmGroup = (slot, p) => slot.elig.filter((g) => p.elig.includes(g)).sort((a, b) => (p.pg[b] ?? 0) - (p.pg[a] ?? 0))[0];
const gmFrom = (x) => `${x.seasonLabel} ${x.team?.abbr || x.team?.name || ''}`.trim();

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
      <p class="hero-sub">Build a squad from all of history, one random team at a time, on real fantasy production. Can you run the table?</p></div>
    <ol class="gm-steps" aria-label="How a challenge works">
      <li><b>1</b><span><strong>Roll</strong> a random team &amp; season</span></li>
      <li><b>2</b><span><strong>Draft</strong> one player from its real roster</span></li>
      <li><b>3</b><span><strong>Repeat</strong>: a new team every pick, one reroll</span></li>
      <li><b>4</b><span><strong>Simulate</strong> and chase perfect</span></li>
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
        <div class="gm-best">${b ? `Your best: <b>${esc(gmRecord(b.record, b.sport, 9999))}</b>${b.teams > 1 ? ` · squad from ${b.teams} teams` : ` · ${esc(b.seasonLabel)} ${esc(b.team?.name || '')}`}${b.success ? ' <span class="gm-badge win">Perfect</span>' : ''}` : '<span class="muted">No seasons yet</span>'}</div>
        <button class="btn primary gm-roll" type="button" data-roll="${s.key}">Start a draft</button>
      </article>`;
    }).join('')}</div>
    ${mine?.runs?.length ? `<div class="layout gm-history">
      <section class="panel"><h3>Your seasons <small>tick two to compare</small></h3><div class="table-scroll">${gmRunsTable(mine.runs)}</div></section>
      <aside class="side"><section class="panel" id="gmCompare"><h3>Compare</h3><p class="muted">Tick any two seasons to put them side by side.</p></section>
        <section class="panel"><h3>Totals</h3><div class="gm-totals"><div><b>${mine.totals.runs}</b><span>seasons simmed</span></div><div><b>${mine.totals.attempts}</b><span>drafts</span></div><div><b>${mine.totals.perfect}</b><span>perfect</span></div></div></section></aside>
    </div>` : ''}
    <p class="gm-disclaimer">${esc(cfg.disclaimer)} <a href="#/games/how">How the sim works →</a></p>`;

  $$('[data-roll]').forEach((b) => { b.onclick = () => gmStart(b.dataset.roll, b); });
  const cmp = $('.gm-runs');
  if (cmp) cmp.onchange = (e) => {
    const box = e.target.closest('input[type=checkbox]'); if (!box) return;
    const row = mine.runs[+box.dataset.i];
    gm.compare = box.checked ? [...gm.compare, row].slice(-2) : gm.compare.filter((r) => r !== row);
    $$('.gm-runs input[type=checkbox]').forEach((x) => { x.checked = gm.compare.includes(mine.runs[+x.dataset.i]); });
    paintCompare();
  };
}

const gmRunLabel = (r) => (r.teams > 1 ? `${r.teams}-team squad · ${r.seasonLabel} ${r.team?.abbr || ''} schedule` : `${r.seasonLabel} ${r.team?.name || ''}`);
function gmRunsTable(runs) {
  return `<table class="lines gm-runs"><thead><tr><th></th><th>Squad</th><th>Record</th><th>Result</th><th class="hide-sm">Fantasy PPG</th><th></th></tr></thead><tbody>
    ${runs.map((r, i) => `<tr><td><input type="checkbox" data-i="${i}" aria-label="Compare run ${r.n}: ${esc(gmRunLabel(r))}"></td>
      <td><span class="gm-sport-dot" style="--gm-c:${GM_COLORS[r.sport]}"></span>${esc(gmRunLabel(r))} <small class="muted">#${r.n}</small></td>
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
  const head = (r) => `${esc(r.sport.toUpperCase())} #${r.n}`;
  el.innerHTML = `<h3>Compare</h3><table class="lines gm-cmp"><thead><tr><th></th><th>${head(a)}</th><th>${head(b)}</th></tr></thead><tbody>
    ${row('Schedule', (r) => `${esc(r.seasonLabel || '')} ${esc(r.team?.abbr || '')}`)}
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

// A short "working" overlay for anything that rolls a team (it can take a few seconds).
function gmWorking(title, sub) {
  const msg = document.createElement('div');
  msg.className = 'gm-rolling';
  msg.innerHTML = `<div class="gm-rolling-box" role="status"><div class="gm-dice" aria-hidden="true">🎲</div><b>${esc(title)}</b><span>${esc(sub || 'Pulling that season\'s box scores and every player\'s history. A season seen for the first time can take a few seconds.')}</span></div>`;
  document.body.appendChild(msg);
  return () => msg.remove();
}

async function gmStart(sport, btn) {
  const cards = $$('.gm-roll');
  cards.forEach((b) => { b.disabled = true; });
  if (btn) btn.textContent = 'Rolling…';
  const done = gmWorking('Rolling your first team…');
  try {
    const v = await api('/games/attempts', { method: 'POST', body: { sport } });
    gm.view = v; gm.stage = 'draft'; gm.attemptId = v.attempt.id; gm.filter = 'open'; gm.q = ''; gm.target = null; gm.sortCol = null; gm.flash = null;
    location.hash = `#/games/play/${v.attempt.id}`;
  } catch (e) {
    toast(e.message, true);
    cards.forEach((b) => { b.disabled = false; b.textContent = 'Start a draft'; });
  } finally { done(); }
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
    if (gm.attemptId !== id) { gm.filter = 'open'; gm.q = ''; gm.target = null; gm.sortCol = null; gm.stage = null; gm.flash = null; }
    gm.attemptId = id;
  }
  // The stage follows the server's state, so a refresh lands in the same place.
  const v = gm.view, at = v.attempt;
  if (!at.mine) gm.stage = v.result ? 'results' : 'locked-out';
  else if (run && v.result) gm.stage = 'results';
  else if (!at.complete) gm.stage = 'draft';
  else if (!at.locked) gm.stage = 'review';
  else gm.stage = gm.stage === 'review' || !v.result ? 'review' : 'results';
  paintPlay();
}

function paintPlay() {
  const v = gm.view, at = v.attempt, rules = v.rules, home = v.homeSeason;
  const steps = [['draft', 'Draft'], ['review', 'Review'], ['simulate', 'Simulate'], ['results', 'Results']];
  const cur = steps.findIndex(([k]) => k === gm.stage);
  const drafting = gm.stage === 'draft';
  const team = drafting ? at.roll?.team : home?.team;
  const homeLine = home ? `Schedule: the real ${home.games}-game ${esc(home.seasonLabel)} ${esc(home.team.name)} schedule (they went <b>${esc(gmRecord(home.record, at.sport, home.season))}</b>)` : '';
  $('#app').innerHTML = `
    <a class="back" href="#/games">← All challenges</a>
    <section class="gm-team" style="--gm-c:${gmTeamColor(team)}">
      ${team ? logo(team, 'gm-logo') : `<span class="gm-emoji gm-logo" aria-hidden="true">${esc(rules.emoji)}</span>`}
      <div class="gm-team-main">
        <div class="gm-kicker">${esc(rules.league)} · ${esc(rules.title)}</div>
        <h1>${drafting ? `Draft: pick ${Math.min(at.picks.length + 1, at.total)} of ${at.total}` : `Your ${at.picks.length}-man squad from ${new Set(at.picks.map((p) => `${p.season}|${p.team?.abbr}`)).size} teams`}</h1>
        <p>${drafting ? (at.roll ? `Drafting from roll #${at.roll.n}: <b>${esc(at.roll.seasonLabel)} ${esc(at.roll.team.name)}</b> · ${at.rerollUsed ? 'reroll used' : '1 reroll left'}${home ? ` · ${homeLine}` : ''}` : 'Waiting for the next team…') : homeLine}</p>
      </div>
      <div class="gm-goal"><span>Goal</span><b>${esc(gmGoal(rules, home?.games))}</b></div>
    </section>
    ${at.mine ? `<ol class="gm-stepper" aria-label="Progress">${steps.map(([k, l], i) => `<li class="${i < cur ? 'done' : i === cur ? 'now' : ''}" ${i === cur ? 'aria-current="step"' : ''}><span>${i + 1}</span>${l}</li>`).join('')}</ol>` : ''}
    <div id="gmStage"></div>`;
  if (gm.stage === 'draft') return paintDraft();
  if (gm.stage === 'review') return paintReview();
  if (gm.stage === 'results') return paintResults();
  if (gm.stage === 'locked-out') {
    $('#gmStage').innerHTML = '<div class="empty-state"><p>This challenge hasn\'t been simulated yet. Start your own draft and beat it.</p><a class="btn primary" href="#/games">Start a challenge</a></div>';
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
  const f = p.fp?.[group] || p.fp?.[p.group];
  if (!f) return `<b class="gm-ppg">${gmF(p.ppg)}</b>`;
  const parts = (f.parts || []).map((x) => `${x.label}: ${gmPlus(x.ppg, 2)}`).join('\n');
  const small = f.mppg !== f.ppg;
  return `<b class="gm-ppg" title="${esc(`${f.ppg} fantasy points a game over ${f.gp} games\n${parts}`)}">${gmF(f.ppg)}</b>${small ? `<small class="gm-adj" title="${esc(`Only ${f.gp} games: the sim tops his sample up with replacement-level games and counts ${f.mppg}`)}">≈${gmF(f.mppg)}</small>` : ''}`;
}

function paintDraft() {
  const v = gm.view, at = v.attempt, rules = v.rules, pv = v.preview || {}, pool = v.pool;
  const slots = gmSlots(rules);
  const filled = at.picks.length;
  const open = slots.filter((s) => at.open.includes(s.key));
  const pickOf = (key) => at.picks.find((p) => p.key === key);
  const picked = new Set(at.picks.map((p) => p.playerId));
  const target = open.find((s) => s.key === gm.target);
  const hints = pv.hints || {};
  const chem = pv.chem || { total: 0, players: {}, links: [] };
  const fitsOpen = (p) => open.some((s) => gmFits(s.slot, p));
  const groups = rules.groups.filter((g) => open.some((s) => s.slot.elig.includes(g)));
  const group = target ? (target.slot.elig.length === 1 ? target.slot.elig[0] : null) : groups.includes(gm.filter) ? gm.filter : null;
  const groupOf = (p) => (group && p.elig.includes(group) ? group : target ? gmGroup(target.slot, p) : gmGroup({ elig: open.flatMap((s) => s.slot.elig) }, p) || p.group);
  const linked = new Set(); for (const l of chem.links) { linked.add(l.a); linked.add(l.b); }

  // ----- the current roll -----
  let rollPanel;
  if (at.rollFailed || !pool) {
    rollPanel = `<section class="panel gm-pool"><div class="empty-state"><p>Couldn't roll the next team: ESPN didn't answer. Your picks are safe.</p><button class="btn primary" type="button" id="gmRetryRoll">Roll the next team</button></div></section>`;
  } else {
    let list = pool.players.filter((p) => (target ? gmFits(target.slot, p) : gm.filter === 'all' ? true : gm.filter === 'open' ? fitsOpen(p) : p.elig.includes(gm.filter)));
    if (gm.q) list = list.filter((p) => p.name.toLowerCase().includes(gm.q.toLowerCase()));
    const cols = group ? (keyFor(list[0] || pool.players.find((p) => p.elig.includes(group)) || { key: [] }, group) || []).map(([k]) => k) : ['GP', 'Season'];
    const val = (p, i) => { const k = keyFor(p, group); return group ? k?.[i]?.[1] : i === 0 ? p.fp?.[groupOf(p)]?.gp ?? p.gp : lineFor(p, groupOf(p)); };
    if (gm.sortCol !== null && group) {
      const num = (x) => { const n = parseFloat(String(x ?? '').replace(/[^\d.-]/g, '')); return Number.isFinite(n) ? n : -1e9; };
      list.sort((a, b) => num(val(b, gm.sortCol)) - num(val(a, gm.sortCol)));
    } else list.sort((a, b) => (b.fp[groupOf(b)]?.ppg ?? 0) - (a.fp[groupOf(a)]?.ppg ?? 0) || a.name.localeCompare(b.name));
    const chemBadge = (p) => {
      const h = hints[p.id]; if (!h || picked.has(p.id)) return '';
      const who = h.with.map((w) => `${w.name}: ${w.text}`).join('\n');
      return `<span class="gm-chem" title="${esc(`Adds ${h.ppg} chemistry PPG to your squad\n${who}`)}">🔗 ${h.with.length > 1 ? `${h.with.length} links` : esc(h.with[0].name.split(' ').slice(-1)[0])} <b>+${gmF(h.ppg)}</b></span>`;
    };
    const row = (p) => {
      const isIn = picked.has(p.id), can = !isIn && (target ? gmFits(target.slot, p) : fitsOpen(p));
      const action = isIn ? '<button class="btn ghost gm-act" disabled>In squad</button>'
        : can ? `<button class="btn gm-act" data-pick="${esc(p.id)}" ${gm.busy ? 'disabled' : ''}>Draft</button>`
          : `<button class="btn gm-act" disabled title="Every slot ${esc(p.name)} can play is already filled">No slot</button>`;
      const g = groupOf(p);
      return `<tr class="${isIn ? 'gm-in' : ''}"><td class="gm-pname"><b>${esc(p.name)}</b>${p.college ? `<small class="gm-college">${esc(p.college)}</small>` : ''}${chemBadge(p)}${group ? '' : `<div class="gm-sub show-sm">${esc(lineFor(p, g))}</div>`}</td>
        <td><span class="gm-pos">${esc(p.pos)}</span>${p.elig.length > 1 ? `<small class="muted gm-elig">${esc(p.elig.filter((e) => e !== 'DH' || p.elig.length === 1).join('/'))}</small>` : ''}</td>
        <td class="num gm-ppgcell">${gmPPGCell(p, g)}</td>
        ${cols.map((_, i) => `<td class="${!group && i === 1 ? 'gm-line hide-sm' : 'num'}">${esc(val(p, i) ?? '')}</td>`).join('')}<td class="gm-actcell">${action}</td></tr>`;
    };
    const counts = { open: pool.players.filter(fitsOpen).length, all: pool.players.length };
    rollPanel = `<section class="panel gm-pool">
      <div class="gm-rollcard" style="--gm-c:${gmTeamColor(pool.team)}">
        ${logo(pool.team, 'gm-rolllogo')}
        <div class="gm-rollmain"><span class="gm-kicker">Roll #${at.roll.n} · pick ${filled + 1} of ${at.total}</span>
          <b>${esc(pool.seasonLabel)} ${esc(pool.team.name)}</b>
          <small>Real record ${esc(gmRecord(pool.record, at.sport, pool.season))} · ${pool.players.length} players from ${pool.coverage.boxScores} of ${pool.coverage.games} ESPN box scores</small></div>
        <div class="gm-reroll">${at.rerollUsed
          ? '<button class="btn ghost" type="button" disabled aria-disabled="true">Reroll used</button><small class="muted">One per draft</small>'
          : `<button class="btn ghost" type="button" id="gmReroll" ${gm.busy ? 'disabled' : ''}>🎲 Reroll this team</button><small class="muted">1 left this draft</small>`}</div>
      </div>
      <div class="gm-filters">
        <div class="chips" role="group" aria-label="Position">
          <button class="chip" data-filter="open" aria-pressed="${gm.filter === 'open' && !target}">Fits your squad <span class="count">${counts.open}</span></button>
          ${groups.map((g) => `<button class="chip" data-filter="${esc(g)}" aria-pressed="${!target && gm.filter === g}">${esc(g)} <span class="count">${pool.players.filter((p) => p.elig.includes(g)).length}</span></button>`).join('')}
          <button class="chip" data-filter="all" aria-pressed="${gm.filter === 'all' && !target}">Whole roster <span class="count">${counts.all}</span></button>
        </div>
        <label class="search gm-search"><svg class="ico" aria-hidden="true" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input id="gmSearch" type="search" placeholder="Find a player…" value="${esc(gm.q)}" aria-label="Find a player" autocomplete="off"></label>
      </div>
      ${target ? `<div class="gm-target">Picking for <b>${esc(target.slot.label)}</b>${target.slot.hint ? ` <span class="muted">(${esc(target.slot.hint)})</span>` : ''} <button class="linkish" type="button" id="gmClearTarget">any open slot</button></div>` : ''}
      <div class="table-scroll"><table class="lines gm-table"><thead><tr><th>Player</th><th>Pos</th><th class="num"><button type="button" class="gm-sort ${gm.sortCol === null ? 'on' : ''}" data-col="ppg" title="Real fantasy points per game this season">PPG</button></th>${cols.map((c, i) => `<th class="${!group && i === 1 ? 'hide-sm' : ''}">${group ? `<button type="button" class="gm-sort ${gm.sortCol === i ? 'on' : ''}" data-col="${i}" title="Sort by ${esc(c)}">${esc(c)}</button>` : esc(c)}</th>`).join('')}<th></th></tr></thead>
        <tbody>${list.length ? list.map(row).join('') : `<tr><td colspan="${cols.length + 4}" class="muted" style="text-align:center;padding:24px">No players match.</td></tr>`}</tbody></table></div>
      <p class="muted gm-note">Pick one player from this roster. PPG is his real fantasy points per game with ${esc(pool.team.name)} in ${esc(pool.seasonLabel)}; hover it to see where the points came from. 🔗 marks a verified connection to someone you've drafted.</p>
    </section>`;
  }

  $('#gmStage').innerHTML = `<div class="gm-howto" role="note"><span aria-hidden="true">🎲</span><p>${esc(v.how || GM_HOW)} <a href="#/games/how">Scoring and chemistry rules →</a></p></div>
  <div class="layout gm-draft">
    ${rollPanel}
    <aside class="side gm-board">
      <section class="panel">
        <h3>Your squad <small>${filled} of ${at.total} drafted</small></h3>
        <div class="gm-total" aria-live="polite"><span>Combined fantasy PPG</span><b>${gmF(pv.combined ?? 0)}</b><small>${gmF(pv.base ?? 0)} from players + ${gmF(chem.total)} chemistry</small></div>
        <div class="gm-meter" role="progressbar" aria-valuemin="0" aria-valuemax="${at.total}" aria-valuenow="${filled}"><i style="width:${(filled / at.total) * 100}%"></i></div>
        <ul class="gm-slots">${slots.map(({ key, slot }) => {
          const p = pickOf(key);
          const bonus = p ? chem.players[p.playerId]?.bonus : 0;
          return `<li class="gm-slot ${p ? 'filled' : ''} ${gm.target === key ? 'target' : ''} ${p && gm.flash?.has(p.playerId) ? 'gm-flash' : ''}">
            <span class="gm-slot-pos">${esc(slot.label)}</span>
            ${p ? `<span class="gm-slot-name"><b>${linked.has(p.playerId) ? '<span class="gm-link" title="Has chemistry with a squad mate">🔗</span> ' : ''}${esc(p.player.name)}</b><small>${gmF(p.player.ppg)} PPG${bonus ? ` <span class="gm-bonus">+${gmF(bonus, 2)} chem</span>` : ''} · from ${esc(gmFrom(p))}</small></span><span class="gm-pickno" title="Pick ${p.n}">#${p.n}</span>`
              : `<button type="button" class="gm-slot-empty" data-target="${esc(key)}" ${pool ? '' : 'disabled'}>Pick ${slot.hint ? `a ${esc(slot.label.toLowerCase())} (${esc(slot.hint)})` : `a ${esc(slot.label)}`}</button>`}
          </li>`;
        }).join('')}</ul>
        ${gmChemList(chem.links, 4)}
        <p class="muted gm-note">Picks are final. Once the squad is full you'll review it and simulate.</p>
      </section>
      <section class="panel gm-rules"><h3>Rules</h3><p>${esc(rules.scheduleNote)}</p><p class="muted">${esc(rules.unitNote)}</p></section>
    </aside>
  </div>
  <div class="gm-mobilebar"><span><b>${filled}</b>/${at.total} · <b>${gmF(pv.combined ?? 0)}</b> PPG</span>${pool && !at.rerollUsed ? `<button class="btn ghost" type="button" id="gmReroll2" ${gm.busy ? 'disabled' : ''}>🎲 Reroll</button>` : '<span class="muted">Reroll used</span>'}</div>`;

  const stage = $('#gmStage');
  stage.onclick = (e) => {
    const t = e.target.closest('button'); if (!t || t.disabled) return;
    if (t.dataset.filter) { gm.filter = t.dataset.filter; gm.target = null; gm.sortCol = null; return paintDraft(); }
    if (t.dataset.col !== undefined && t.classList.contains('gm-sort')) { gm.sortCol = t.dataset.col === 'ppg' || gm.sortCol === +t.dataset.col ? null : +t.dataset.col; return paintDraft(); }
    if (t.dataset.target) { gm.target = gm.target === t.dataset.target ? null : t.dataset.target; gm.sortCol = null; paintDraft(); $('.gm-pool')?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' }); return; }
    if (t.id === 'gmClearTarget') { gm.target = null; return paintDraft(); }
    if (t.dataset.pick) return gmPick(t.dataset.pick, target?.key || null);
    if (t.id === 'gmReroll' || t.id === 'gmReroll2') return gmReroll();
    if (t.id === 'gmRetryRoll') return gmAct(`/games/attempts/${at.id}/roll`, {}, 'Rolling the next team…');
  };
  $('#gmSearch')?.addEventListener('input', (e) => { clearTimeout(gm.qT); gm.qT = setTimeout(() => { gm.q = e.target.value.trim(); const pos = e.target.selectionStart; paintDraft(); const s = $('#gmSearch'); s.focus(); s.setSelectionRange(pos, pos); }, 180); });
}

// Anything that changes the draft goes through here: one request at a time,
// the server answers with the new state (or says why not).
async function gmAct(path, body, working) {
  if (gm.busy) return null;
  gm.busy = true;
  const done = working ? gmWorking(working) : () => {};
  try {
    const v = await api(path, { method: 'POST', body });
    gm.view = v;
    return v;
  } catch (e) {
    toast(e.message, true);
    // A stale or refused action: show the server's current state.
    try { gm.view = await api(`/games/attempts/${gm.view.attempt.id}`); } catch { /* keep what we have */ }
    return null;
  } finally {
    gm.busy = false; done();
    if (gm.view.attempt.complete && gm.stage === 'draft') { gm.stage = 'review'; paintPlay(); window.scrollTo(0, 0); }
    else if (gm.stage === 'draft') paintPlay();
  }
}

async function gmPick(playerId, slot) {
  const v0 = gm.view, p = v0.pool?.players.find((x) => x.id === playerId);
  const hint = v0.preview?.hints?.[playerId];
  const v = await gmAct(`/games/attempts/${v0.attempt.id}/pick`, { playerId, roll: v0.attempt.roll.n, slot }, `Drafted ${p?.name || 'your pick'}. Rolling the next team…`);
  if (!v) return;
  gm.target = null; gm.q = ''; gm.sortCol = null; gm.filter = 'open';
  gm.flash = hint ? new Set([playerId, ...hint.with.map((w) => w.id)]) : new Set([playerId]);
  if (hint) toast(`🔗 ${p.name} + ${hint.with.map((w) => w.name).join(', ')}: +${gmF(hint.ppg)} chemistry PPG`);
  if (gm.stage === 'draft') paintPlay();
}

async function gmReroll() {
  const at = gm.view.attempt;
  if (!confirm('Use your one reroll for this draft on the ' + `${at.roll.seasonLabel} ${at.roll.team.name}?`)) return;
  const v = await gmAct(`/games/attempts/${at.id}/reroll`, { roll: at.roll.n }, 'Rerolling the team…');
  if (v) { gm.target = null; gm.q = ''; gm.filter = 'open'; toast(`New team: ${v.attempt.roll.seasonLabel} ${v.attempt.roll.team.name}. That was your one reroll.`); }
}

// Chemistry links, strongest first.
function gmChemList(links, max = 99, empty = '') {
  if (!links?.length) return empty ? `<p class="muted gm-note">${empty}</p>` : '';
  return `<div class="gm-chemlist"><h4>Chemistry</h4><ul>${links.slice(0, max).map((l) => `<li><span class="gm-kinds" aria-hidden="true">${(l.kinds || []).map((k) => GM_KIND[k.kind || k] || '').join('')}</span><span><b>${esc(l.aName || l.a)} + ${esc(l.bName || l.b)}</b><small>${esc((l.kinds || []).map((k) => k.text || '').filter(Boolean).join(' · ') || l.text || '')}</small></span><em>+${gmF(l.ppg, 2)}</em></li>`).join('')}</ul>${links.length > max ? `<p class="muted gm-note">and ${links.length - max} more</p>` : ''}</div>`;
}

// ---------- review ----------
function paintReview() {
  const v = gm.view, rules = v.rules, at = v.attempt, pv = v.preview || {};
  const slots = gmSlots(rules);
  const pickOf = (key) => at.picks.find((p) => p.key === key);
  const chem = pv.chem || { total: 0, players: {}, links: [] };
  $('#gmStage').innerHTML = `<div class="layout gm-review">
    <div>
      <section class="panel"><h3>Squad review <small>${at.locked ? 'locked in' : `${at.picks.length} picks from ${new Set(at.picks.map((p) => `${p.season}|${p.team?.abbr}`)).size} team-seasons`}</small></h3>
        <div class="table-scroll"><table class="lines gm-table gm-reviewtable"><thead><tr><th>Slot</th><th>Player</th><th class="hide-sm">Real season</th><th class="num">PPG</th><th class="num">Chem</th></tr></thead><tbody>
          ${slots.map(({ key, slot }) => {
            const p = pickOf(key);
            if (!p) return `<tr class="gm-missing"><td><span class="gm-pos">${esc(slot.label)}</span></td><td colspan="4">Empty</td></tr>`;
            const pl = p.player, bonus = chem.players[p.playerId]?.bonus;
            const small = pl.mppg !== pl.ppg;
            return `<tr><td><span class="gm-pos">${esc(slot.label)}</span></td><td><b>${esc(pl.name)}</b> <small class="muted">${esc(pl.pos)} · ${esc(gmFrom(p))}${pl.college ? ` · ${esc(pl.college)}` : ''}</small><div class="gm-sub show-sm">${esc(pl.line)}</div></td><td class="hide-sm gm-line">${esc(pl.line)}</td><td class="num gm-ppgcell"><b class="gm-ppg">${gmF(pl.ppg)}</b>${small ? `<small class="gm-adj" title="Only ${pl.gp} games: the sim counts ${pl.mppg}">≈${gmF(pl.mppg)}</small>` : ''}</td><td class="num">${bonus ? `<span class="gm-bonus">+${gmF(bonus, 2)}</span>` : '<span class="muted">—</span>'}</td></tr>`;
          }).join('')}
        </tbody><tfoot><tr class="gm-tot"><td colspan="3">Combined fantasy PPG <small class="muted">players ${gmF(pv.base)} + chemistry ${gmF(chem.total)}</small></td><td class="num" colspan="2"><b>${gmF(pv.combined)}</b></td></tr></tfoot></table></div>
        <p class="muted gm-note">Each player counts at his real PPG from the season he was drafted from. "≈" marks a player with only a handful of games: the sim tops his sample up with replacement-level games. Players from different eras are compared fairly: each is adjusted for his own league's scoring level.</p>
      </section>
      <section class="panel"><h3>Chemistry <small>${chem.links.length ? `+${gmF(chem.total)} PPG from ${chem.links.length} connection${chem.links.length === 1 ? '' : 's'}` : 'no connections'}</small></h3>
        ${gmChemList(chem.links, 12, 'None of your picks share a college, a franchise-season or a national team. That\'s fine: chemistry is a small bonus on top of real production.')}
      </section>
    </div>
    <aside class="side">
      <section class="panel gm-odds"><h3>Before you sim</h3>
        ${pv.complete && pv.odds ? `<div class="gm-oddsgrid">
            <div class="wide"><span>Combined fantasy PPG</span><b>${gmF(pv.combined)}</b><small>${gmF(pv.base)} from players + ${gmF(chem.total)} chemistry</small></div>
            <div class="wide"><span>Projected</span><b>${pv.odds.avgWins} wins</b><small>usually ${pv.odds.low} to ${pv.odds.high} of ${pv.odds.games}</small></div>
            <div><span>${rules.objective === 'undefeated' ? 'Unbeaten odds' : 'Perfect odds'}</span><b>${gmPct(pv.odds.chance)}</b></div>
            <div><span>Chemistry worth</span><b>${pv.odds.chemWins != null ? `${gmPlus(pv.odds.chemWins)}` : '0'}</b><small>wins a season</small></div>
          </div><p class="muted gm-note">From ${pv.odds.runs} quick test seasons of this exact squad against the real schedule above.</p>`
          : '<p>Your squad isn\'t complete yet.</p>'}
        <div class="gm-cta">
          ${at.locked
            ? `<button class="btn primary" type="button" id="gmSim">Simulate the season</button><button class="btn ghost" type="button" id="gmRebuild">Rebuild squad (new draft)</button>`
            : `<button class="btn primary" type="button" id="gmLock" ${pv.complete ? '' : 'disabled'}>Lock in &amp; simulate</button>`}
        </div>
        <p class="muted gm-note">${at.locked ? 'Locked squads can be re-simmed as often as you like. Rebuilding starts a fresh draft (with a fresh reroll); your past seasons keep their squads.' : 'Picks are final. Lock in to play the season.'}</p>
      </section>
      <section class="panel gm-rules"><h3>Rules</h3><p>${esc(rules.scheduleNote)}</p><p class="muted">${esc(rules.unitNote)}</p></section>
    </aside>
  </div>`;
  $('#gmLock')?.addEventListener('click', async (e) => {
    e.target.disabled = true; e.target.textContent = 'Locking in…';
    try { gm.view = await api(`/games/attempts/${at.id}/lock`, { method: 'POST', body: {} }); gmSimulate(); }
    catch (err) { toast(err.message, true); e.target.disabled = false; e.target.textContent = 'Lock in & simulate'; }
  });
  $('#gmSim')?.addEventListener('click', gmSimulate);
  $('#gmRebuild')?.addEventListener('click', gmRebuild);
}

async function gmRebuild() {
  const at = gm.view.attempt;
  if (!confirm('Start a fresh draft for this challenge? Your past seasons keep their squads.')) return;
  const done = gmWorking('Rolling your first team…');
  try {
    gm.view = await api(`/games/attempts/${at.id}/rebuild`, { method: 'POST', body: {} });
    gm.stage = 'draft'; gm.filter = 'open'; gm.target = null; gm.flash = null;
    history.replaceState(null, '', `#/games/play/${at.id}`);
    paintPlay(); window.scrollTo(0, 0);
    toast('New draft. New teams, new reroll.');
  } catch (e) { toast(e.message, true); } finally { done(); }
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
  const r = v.result, rules = v.rules, sport = v.attempt.sport, season = r.home?.season || 9999;
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
  const v = gm.view, r = v.result, rules = v.rules, at = v.attempt, sport = at.sport;
  if (!r) { gm.stage = at.locked ? 'review' : 'draft'; return paintPlay(); }
  const home = r.home, season = home.season;
  const recTxt = gmRecord(r.record, sport, season);
  const blem = r.firstBlemish ? r.games[r.firstBlemish - 1] : null;
  const head = r.tier.id === 'perfect' ? `Perfect season. ${recTxt}.`
    : r.tier.id === 'unbeaten' ? `Invincible. ${recTxt}, unbeaten.`
      : r.tier.id === 'close' ? `${recTxt}. One game from immortality.`
        : `${recTxt}. ${r.tier.label}.`;
  const diff = r.pf - r.pa;
  const unit = { nfl: 'pts', nba: 'pts', mlb: 'runs', nhl: 'goals', epl: 'goals' }[sport];
  const realRec = home.record, realPct = ((realRec.w + 0.5 * realRec.t) / (realRec.gp || 1)) * 100;
  const teams = new Set((r.picks || []).map((p) => `${p.season}|${p.team?.abbr}`)).size;
  const gameRow = (g) => `<tr class="gm-g-${gmRes(g.res)}"><td>${g.n}</td><td>${g.home ? 'vs' : '@'} ${esc(g.opp.abbr)}</td><td><span class="gm-badge ${gmRes(g.res) === 'w' ? 'win' : gmRes(g.res) === 't' ? 'tie' : 'loss'}">${g.res}</span> ${g.us}-${g.them}${g.extra ? ` <small class="muted">${esc(g.extra)}</small>` : ''}</td><td class="hide-sm muted">${g.real ? `${g.real.us}-${g.real.them}` : ''}</td><td class="num hide-sm">${gmF(g.fp)}</td><td class="gm-line">${g.star ? `${esc(g.star.name)}: ${esc(g.star.line)}` : ''}</td></tr>`;
  const many = r.games.length > 40;
  const vorTxt = (p) => `${gmPlus(p.vor)} PPG vs. a replacement ${esc(p.slotLabel)}`;
  $('#gmStage').innerHTML = `
    <section class="gm-verdict ${r.success ? 'win' : ''}">
      <div class="gm-kicker">Run ${r.n} of ${r.of} · simulated by GMmode${r.drift ? ' · re-simulated with a newer engine; the stored record is the original' : ''}</div>
      <h2>${esc(head)}</h2>
      <p>${blem ? `The ${rules.objective === 'undefeated' ? 'unbeaten run' : 'perfect season'} ended in game ${blem.n}: ${blem.res} ${blem.us}-${blem.them} ${blem.home ? 'vs' : 'at'} ${esc(blem.opp.name)}.` : rules.objective === 'undefeated' && r.record.t ? `Not a single loss. ${r.record.t} draw${r.record.t === 1 ? '' : 's'} kept it from being perfect.` : 'Not a single slip all season.'}
        On the same schedule, the real ${esc(home.seasonLabel)} ${esc(home.team.name)} went ${esc(gmRecord(realRec, sport, season))}.${r.beatReal ? ' <b>You beat history.</b>' : ''}</p>
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
        <button class="btn" type="button" id="gmNew">New ${esc(rules.league)} draft</button>
        <button class="btn ghost" type="button" id="gmShare">Share</button>
      </div>` : '<div class="gm-actions"><a class="btn primary" href="#/games">Start your own challenge</a></div>'}
    </section>
    <div class="layout gm-results">
      <div>
        <section class="panel"><h3>Game by game <small>real result in grey</small></h3>
          <ol class="gm-chips static">${r.games.map((g) => `<li class="${gmRes(g.res)}" title="${esc(`Game ${g.n}: ${g.res} ${g.us}-${g.them} ${g.home ? 'vs' : 'at'} ${g.opp.abbr}`)}">${esc(g.opp.abbr)}</li>`).join('')}</ol>
          ${many ? `<div class="chips gm-logfilter" role="group" aria-label="Show games"><button class="chip" data-log="miss" aria-pressed="true">Losses &amp; draws</button><button class="chip" data-log="all" aria-pressed="false">All ${r.games.length}</button></div>` : ''}
          <div class="table-scroll"><table class="lines gm-log"><thead><tr><th>#</th><th>Opp</th><th>Result</th><th class="hide-sm">Real</th><th class="num hide-sm" title="Your squad's fantasy points that game">FPTS</th><th>Star</th></tr></thead><tbody id="gmLog">${(many ? r.games.filter((g) => g.res !== 'W') : r.games).map(gameRow).join('') || '<tr><td colspan="6" class="muted" style="text-align:center;padding:16px">No losses. None.</td></tr>'}</tbody></table></div>
        </section>
        <section class="panel"><h3>Fantasy production <small>simulated season vs. real one</small></h3>
          <div class="table-scroll"><table class="lines gm-table gm-break"><thead><tr><th>Player</th><th class="num" title="Real fantasy PPG in the season he was drafted from">Real PPG</th><th class="num" title="Chemistry bonus PPG">Chem</th><th class="num" title="Fantasy PPG in the simulated season">Sim PPG</th><th>Simulated season</th><th class="hide-sm">Real season</th></tr></thead><tbody>
            ${[...r.players].sort((a, b) => b.simFp - a.simFp).map((p) => `<tr><td><b>${esc(p.name)}</b> <small class="muted">${esc(p.slotLabel)}${p.from ? ` · ${esc(p.from)}` : ''}</small></td><td class="num">${gmF(p.ppg)}</td><td class="num">${p.bonus ? `<span class="gm-bonus">+${gmF(p.bonus, 2)}</span>` : '<span class="muted">—</span>'}</td><td class="num"><b>${gmF(p.simPpg)}</b></td><td class="gm-line">${esc(p.sim)}</td><td class="hide-sm gm-line muted">${esc(p.real)}</td></tr>`).join('')}
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
          <li><span>Same schedule, the real ${esc(home.seasonLabel)} ${esc(home.team.abbr || '')}</span><b>${esc(gmRecord(realRec, sport, season))}</b><small>${gmF(realPct)}% · you ${r.beatReal ? 'beat' : 'didn\'t beat'} them</small></li>
          ${teams ? `<li><span>Your squad</span><small>${r.picks.length} players from ${teams} different team-seasons</small></li>` : ''}
          ${rules.benchmark?.text ? `<li><span>All-time</span><small>${esc(rules.benchmark.text)}</small></li>` : ''}
        </ul></section>
        ${at.runs.length > 1 ? `<section class="panel"><h3>This challenge's runs</h3><ul class="gm-runlist">${[...at.runs].reverse().map((x) => `<li class="${x.n === r.n ? 'on' : ''}"><a href="#/games/play/${esc(at.id)}?run=${x.n}">Run ${x.n}</a><b>${esc(gmRecord(x.record, sport, 9999))}</b>${x.success ? '<span class="gm-badge win">Perfect</span>' : `<small class="muted">${esc(x.tier?.label || '')}${x.draft > 1 ? ` · draft ${x.draft}` : ''}</small>`}</li>`).join('')}</ul></section>` : ''}
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
  $('#gmNew').onclick = (e) => gmStart(sport, e.target);
  $('#gmShare').onclick = () => {
    const url = `${location.origin}/#/games/play/${at.id}?run=${r.n}`;
    const text = `I went ${recTxt} in ${rules.title} on GMmode with a squad drafted from ${teams || 'random'} historical teams.${r.success ? ' PERFECT.' : ''} Can you beat it?`;
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
  const setName = { all: '', dst: 'D/ST', bat: 'Hitters', pitch: 'Pitchers', skater: 'Skaters', goalie: 'Goalies', GK: 'Goalkeepers', DEF: 'Defenders', MID: 'Midfielders', FWD: 'Forwards' };
  const ch = cfg.chemistry;
  app.innerHTML = `<a class="back" href="#/games">← All challenges</a>
    <div class="page-head"><h1 class="hero-title">How the sim works</h1><p class="hero-sub">Real rosters, real stats, real fantasy points, real schedules. Simulated games.</p></div>
    <div class="gm-how">
      <section class="panel"><h3>1. The draft</h3>
        <p>${esc(cfg.how || GM_HOW)}</p>
        <p>Each roll is a random team-season from history with complete box-score data, never one you've already seen in this draft, and always with at least one player who fits a slot you still need. The server keeps the whole draft, so you can refresh or come back later and pick up where you left off. Picks are final. The reroll is used only when you press it: the first roll and the automatic rolls after each pick don't count, and a roll that fails because ESPN is slow doesn't count either.</p>
        <p>Your squad plays the real schedule of the team-season you made your first pick from, against those real opponents in that real order.</p></section>
      <section class="panel"><h3>2. The data is real</h3>
        <p>Each roster is every player who appeared for that team in that season's regular-season box scores on ESPN's public feed. Stats are summed from those games only, so a player traded mid-season counts only his games with that team.</p>
        <table class="lines"><thead><tr><th>Challenge</th><th>Seasons with real box scores</th></tr></thead><tbody>${cfg.sports.map((s) => `<tr><td>${s.emoji} ${esc(s.title)}</td><td>${esc(s.seasons.labelFrom)} to ${esc(s.seasons.labelTo)} (${s.seasons.count})</td></tr>`).join('')}</tbody></table>
        <p class="muted">Older seasons exist on ESPN without player box scores, so they're left out rather than filled in. Nothing is invented: if a season's data is too thin, or a download fails, that team is skipped and another is rolled.</p></section>
      <section class="panel"><h3>3. Every player has a real fantasy PPG</h3>
        <p>Each sport has one fixed scoring formula, applied to every player's stats from the season he's drafted from (never career numbers). PPG is his fantasy points divided by the games he actually played. If he only played a handful of games, the sim tops his sample up with replacement-level games, and the draft board shows both numbers.</p>
        ${cfg.sports.map((s) => { const f = cfg.scoring[s.key]; return `<details class="gm-formula"><summary>${s.emoji} ${esc(s.label)}: ${esc(f.name)}</summary>
          <div class="gm-formula-sets">${f.sets.map((set) => `<table class="lines"><thead><tr><th>${esc(setName[set.set] ?? set.set) || 'Stat'}</th><th class="num">Pts</th></tr></thead><tbody>${set.rows.map((x) => `<tr><td>${esc(x.label)}</td><td class="num">${x.pts > 0 ? '+' : ''}${x.pts}</td></tr>`).join('')}</tbody></table>`).join('')}</div>
          <p class="muted">${esc(f.omitted)}</p></details>`; }).join('')}
      </section>
      <section class="panel"><h3>4. Combined PPG and chemistry</h3>
        <p>Your squad's strength starts as the sum of your players' fantasy PPG, each in the slot he fills. Then chemistry: players with a verified history together get a small bonus, paid in fantasy points per game.</p>
        <ul class="gm-list">
          <li>🎓 <b>Same college</b> (from ESPN athlete records): +${esc(ch.college)} of each player's PPG.</li>
          <li>🤝 <b>Former teammates</b>: they played for the same franchise in the same season (up to the seasons you drafted them from), from ESPN's season-by-season logs. +${esc(ch.season)} per shared season, up to ${ch.maxSeasons} seasons. The same franchise in different years doesn't count.</li>
          <li>🏳️ <b>National team</b> (soccer): they played for the same national team in the same international competition season, on a team ESPN marks as a national team. +${esc(ch.national)}.</li>
        </ul>
        <p>Connections stack for a pair up to +${esc(ch.pairCap)}, and a player's total chemistry is capped at +${esc(ch.playerCap)} of his PPG. Every pair and every shared season counts once.</p></section>
      <section class="panel"><h3>5. Fair across sports and eras</h3>
        <p>Fantasy points mean different things in different sports and eras. Each player's PPG is adjusted for the scoring level of the season he was drafted from, and the squad's total is placed among thousands of comparable rosters from the same sport's history. Where it lands drives the simulation. Those internal numbers aren't shown: you find out how good a squad is by building it.</p></section>
      <section class="panel"><h3>6. Each game is simulated</h3>
        <p>For every game on the schedule, expected scores come from that season's real league scoring level, your squad's strength, and that opponent's real points for and against, plus home field. A score is drawn from a distribution shaped like the sport, and ties follow that season's real rules. Player lines are drawn from each player's real per-game numbers, kept consistent with the score, and scored with the same fantasy formula. Better production means better odds, but upsets happen, and perfect seasons are rare.</p></section>
      <section class="panel"><h3>7. What isn't modeled</h3>
        <p>Injuries, rest and trades during your season (your squad plays every game). Offensive linemen and baseball defense, which box scores don't credit. Coaching and playoffs. Some stat categories aren't scored because ESPN didn't record them in every season; each sport's list is under its formula above.</p></section>
    </div>
    <p class="gm-disclaimer">${esc(cfg.disclaimer)}</p>`;
}

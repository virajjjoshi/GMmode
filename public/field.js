/* Live field renderers: one SVG per sport, built once and updated in place so
   the ball, chains and markers can animate between updates.
   Loaded before app.js; uses its helpers ($, esc, sideColors...) at call time. */
'use strict';

const FIELD = { kind: null, sel: null };
const SVGNS = 'http://www.w3.org/2000/svg';

function svgEl(tag, attrs = {}, parent) {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (parent) parent.appendChild(el);
  return el;
}
const teamColor = (g, side) => (side === 'home' ? sideColors(g).h : side === 'away' ? sideColors(g).a : '#ffffff');

// Entry point: (re)build the field for this sport if needed, then paint state.
function paintField(host, g) {
  const d = g.detail;
  const kind = d?.kind || g.sport;
  if (!host) return;
  if (host.dataset.kind !== kind || !host.firstChild) {
    host.dataset.kind = kind; host.innerHTML = '';
    FIELD.sel = null;
    (BUILD[kind] || BUILD.none)(host, g);
  }
  (PAINT[kind] || (() => {}))(host, g, d);
}

// Highlight one play from the play-by-play on the field.
function highlightPlay(host, g, play) {
  FIELD.sel = play?.id || null;
  (HILITE[g.detail?.kind] || (() => {}))(host, g, play);
}

// ================= FOOTBALL =================
// viewBox: 120 x 53.3 yards. x = 10 + yards from the away goal line.
const BUILD = {
  none(host) { host.innerHTML = '<div class="field-none">Live tracker coming online…</div>'; },

  football(host, g) {
    const svg = svgEl('svg', { viewBox: '0 0 120 53.3', class: 'fsvg football', role: 'img', 'aria-label': 'Football field with ball position' }, host);
    for (let i = 0; i < 10; i++) svgEl('rect', { x: 10 + i * 10, y: 0, width: 10, height: 53.3, fill: i % 2 ? '#2f7d3a' : '#348a40' }, svg);
    svgEl('rect', { x: 0, y: 0, width: 10, height: 53.3, fill: teamColor(g, 'away'), class: 'ez' }, svg);
    svgEl('rect', { x: 110, y: 0, width: 10, height: 53.3, fill: teamColor(g, 'home'), class: 'ez' }, svg);
    const ezText = (x, t, rot) => { const e = svgEl('text', { x, y: 26.65, class: 'ez-t', transform: `rotate(${rot} ${x} 26.65)` }, svg); e.textContent = t; };
    ezText(5, g.away?.abbr || 'AWAY', -90); ezText(115, g.home?.abbr || 'HOME', 90);
    for (let x = 10; x <= 110; x += 5) svgEl('line', { x1: x, x2: x, y1: 0, y2: 53.3, class: x % 10 ? 'yl thin' : 'yl' }, svg);
    let hash = '';
    for (let x = 11; x < 110; x++) { if (x % 5) hash += `M${x} 1v1.2M${x} 22.4v1M${x} 29.9v1M${x} 51.1v1.2`; }
    svgEl('path', { d: hash, class: 'hash' }, svg);
    for (let n = 10; n <= 90; n += 10) {
      const lbl = n <= 50 ? n : 100 - n;
      for (const y of [9.5, 46.5]) { const t = svgEl('text', { x: 10 + n, y, class: 'yn' }, svg); t.textContent = lbl; }
    }
    svgEl('rect', { id: 'fDrive', x: 10, y: 0, width: 0, height: 53.3, class: 'drive' }, svg);
    // Chains along the top sideline: the rod crew + chain between LOS and the line to gain.
    svgEl('rect', { id: 'fChain', x: 10, y: 0.4, width: 0, height: 0.5, class: 'chain' }, svg);
    const los = svgEl('g', { id: 'fLos', class: 'mover' }, svg);
    svgEl('rect', { x: -0.25, y: 0, width: 0.5, height: 53.3, class: 'los' }, los);
    svgEl('circle', { cx: 0, cy: 0.65, r: 0.9, class: 'rod' }, los);
    const first = svgEl('g', { id: 'fFirst', class: 'mover' }, svg);
    svgEl('rect', { x: -0.3, y: 0, width: 0.6, height: 53.3, class: 'first' }, first);
    svgEl('circle', { cx: 0, cy: 0.65, r: 0.9, class: 'rod first-rod' }, first);
    const play = svgEl('g', { id: 'fPlay', class: 'fplay', opacity: 0 }, svg);
    svgEl('line', { id: 'fPlayLine', x1: 0, x2: 0, y1: 40, y2: 40, class: 'play-line', 'marker-end': 'url(#arrow)' }, play);
    svgEl('circle', { id: 'fPlayDot', cx: 0, cy: 40, r: 1, class: 'play-dot' }, play);
    const defs = svgEl('defs', {}, svg);
    const mk = svgEl('marker', { id: 'arrow', viewBox: '0 0 10 10', refX: 6, refY: 5, markerWidth: 4, markerHeight: 4, orient: 'auto-start-reverse' }, defs);
    svgEl('path', { d: 'M0 0L10 5L0 10z', fill: '#ffd23f' }, mk);
    const ball = svgEl('g', { id: 'fBall', class: 'mover' }, svg);
    svgEl('ellipse', { cx: 0, cy: 26.65, rx: 1.9, ry: 1.15, class: 'ball' }, ball);
    svgEl('path', { d: 'M-0.9 26.65h1.8M-0.5 26.2v0.9M0 26.2v0.9M0.5 26.2v0.9', class: 'laces' }, ball);
    const tag = svgEl('g', { class: 'ball-tag' }, ball);
    svgEl('rect', { id: 'fTagBg', x: -4.5, y: 20.2, width: 9, height: 3.6, rx: 1.2 }, tag);
    svgEl('text', { id: 'fTag', x: 0, y: 22.8, class: 'tag-t' }, tag);
    svgEl('text', { id: 'fDir', x: 0, y: 32.6, class: 'dir-t' }, ball);
    host.insertAdjacentHTML('beforeend', '<div class="field-info" id="fieldInfo"></div>');
  },

  basketball(host, g) {
    const svg = svgEl('svg', { viewBox: '-1 -1 52 49', class: 'fsvg court', role: 'img', 'aria-label': 'Shot chart' }, host);
    svgEl('rect', { x: 0, y: 0, width: 50, height: 47, class: 'floor' }, svg);
    svgEl('rect', { x: 17, y: 0, width: 16, height: 19, class: 'paint' }, svg);
    svgEl('circle', { cx: 25, cy: 19, r: 6, class: 'cl' }, svg);
    svgEl('path', { d: 'M3 0V14A23.75 23.75 0 0 0 47 14V0', class: 'cl' }, svg);
    svgEl('path', { d: 'M21 5.25A4 4 0 0 0 29 5.25', class: 'cl' }, svg);
    svgEl('line', { x1: 22, x2: 28, y1: 4, y2: 4, class: 'cl board' }, svg);
    svgEl('circle', { cx: 25, cy: 5.25, r: 0.75, class: 'rim' }, svg);
    svgEl('path', { d: 'M19 47A6 6 0 0 1 31 47', class: 'cl' }, svg);
    svgEl('rect', { x: 0, y: 0, width: 50, height: 47, class: 'cl', fill: 'none' }, svg);
    const logoText = svgEl('text', { x: 25, y: 37, class: 'court-logo' }, svg); logoText.textContent = g.home?.abbr || '';
    svgEl('g', { id: 'shots' }, svg);
    host.insertAdjacentHTML('beforeend', '<div class="field-info" id="fieldInfo"></div>');
  },

  hockey(host, g) {
    const svg = svgEl('svg', { viewBox: '-101 -43.5 202 87', class: 'fsvg rink', role: 'img', 'aria-label': 'Shot map' }, host);
    svgEl('rect', { x: -100, y: -42.5, width: 200, height: 85, rx: 28, class: 'ice' }, svg);
    svgEl('line', { x1: 0, x2: 0, y1: -42.5, y2: 42.5, class: 'red-l' }, svg);
    for (const x of [-25, 25]) svgEl('line', { x1: x, x2: x, y1: -42.5, y2: 42.5, class: 'blue-l' }, svg);
    for (const x of [-89, 89]) svgEl('line', { x1: x, x2: x, y1: -38, y2: 38, class: 'goal-l' }, svg);
    for (const x of [-89, 89]) svgEl('path', { d: `M${x} -4A6 6 0 0 ${x < 0 ? 1 : 0} ${x} 4`, class: 'crease' }, svg);
    svgEl('circle', { cx: 0, cy: 0, r: 15, class: 'rl' }, svg);
    for (const x of [-69, 69]) for (const y of [-22, 22]) { svgEl('circle', { cx: x, cy: y, r: 15, class: 'rl' }, svg); svgEl('circle', { cx: x, cy: y, r: 1, class: 'dot-red' }, svg); }
    svgEl('rect', { x: -100, y: -42.5, width: 200, height: 85, rx: 28, class: 'boards' }, svg);
    const lt = svgEl('text', { x: 0, y: 4, class: 'rink-logo' }, svg); lt.textContent = g.home?.abbr || '';
    svgEl('g', { id: 'shots' }, svg);
    host.insertAdjacentHTML('beforeend', '<div class="field-info" id="fieldInfo"></div>');
  },

  baseball(host) {
    host.insertAdjacentHTML('beforeend', `<div class="bb-wrap">
      <svg viewBox="0 0 200 170" class="fsvg diamond" role="img" aria-label="Baseball diamond with runners">
        <path d="M100 168 L2 70 A138 138 0 0 1 198 70 Z" class="outfield"/>
        <path d="M100 160 L40 100 L100 40 L160 100 Z" class="infield"/>
        <path d="M100 150 L52 102 L100 54 L148 102 Z" class="grass-in"/>
        <circle cx="100" cy="104" r="7" class="mound"/>
        <rect id="b2" x="93" y="33" width="14" height="14" transform="rotate(45 100 40)" class="base"/>
        <rect id="b1" x="153" y="93" width="14" height="14" transform="rotate(45 160 100)" class="base"/>
        <rect id="b3" x="33" y="93" width="14" height="14" transform="rotate(45 40 100)" class="base"/>
        <path d="M93 156 h14 v6 l-7 6 l-7 -6z" class="plate"/>
        <text id="r1" x="160" y="86" class="runner">🏃</text><text id="r2" x="100" y="26" class="runner">🏃</text><text id="r3" x="40" y="86" class="runner">🏃</text>
      </svg>
      <div class="bb-side" id="bbSide"></div>
    </div><div class="field-info" id="fieldInfo"></div>`);
  },

  soccer(host) {
    host.insertAdjacentHTML('beforeend', `
      <svg viewBox="-1 -1 107 70" class="fsvg pitch" role="img" aria-label="Soccer pitch">
        <rect x="0" y="0" width="105" height="68" class="turf"/>
        ${Array.from({ length: 7 }, (_, i) => `<rect x="${i * 15}" y="0" width="7.5" height="68" class="stripe"/>`).join('')}
        <rect x="0" y="0" width="105" height="68" class="pl"/>
        <line x1="52.5" y1="0" x2="52.5" y2="68" class="pl"/><circle cx="52.5" cy="34" r="9.15" class="pl"/><circle cx="52.5" cy="34" r=".5" class="spot"/>
        <rect x="0" y="13.85" width="16.5" height="40.3" class="pl"/><rect x="88.5" y="13.85" width="16.5" height="40.3" class="pl"/>
        <rect x="0" y="24.85" width="5.5" height="18.3" class="pl"/><rect x="99.5" y="24.85" width="5.5" height="18.3" class="pl"/>
        <path d="M16.5 26.7A9.15 9.15 0 0 1 16.5 41.3M88.5 26.7A9.15 9.15 0 0 0 88.5 41.3" class="pl"/>
        <g id="possG"><rect id="possA" x="0" y="64" height="4" class="poss-a"/><rect id="possH" y="64" height="4" class="poss-h"/></g>
      </svg>
      <div class="timeline-track" id="tl"><div class="tl-line"></div><span class="tl-ht">HT</span></div>
      <div class="field-info" id="fieldInfo"></div>`);
  },
};

const PAINT = {
  football(host, g, d) {
    if (!d) return;
    const X = (v) => 10 + v;
    const svg = $('svg', host);
    const ballOn = d.ballX != null;
    const pos = d.possession;
    const move = (id, x) => { const el = $(`#${id}`, svg); if (el) { el.style.transform = `translateX(${x}px)`; el.style.opacity = x == null ? 0 : 1; } };
    if (ballOn) move('fBall', X(d.ballX)); else $('#fBall', svg).style.opacity = 0;
    if (ballOn && g.status.state === 'in') move('fLos', X(d.ballX)); else $('#fLos', svg).style.opacity = 0;
    if (d.firstX != null && g.status.state === 'in') move('fFirst', X(d.firstX)); else $('#fFirst', svg).style.opacity = 0;
    const chain = $('#fChain', svg);
    if (ballOn && d.firstX != null && g.status.state === 'in') {
      chain.setAttribute('x', X(Math.min(d.ballX, d.firstX))); chain.setAttribute('width', Math.abs(d.firstX - d.ballX)); chain.style.opacity = 1;
    } else chain.style.opacity = 0;
    const drive = $('#fDrive', svg);
    if (d.drive?.startX != null && ballOn && g.status.state === 'in') {
      drive.setAttribute('x', X(Math.min(d.drive.startX, d.ballX))); drive.setAttribute('width', Math.abs(d.ballX - d.drive.startX));
      drive.style.fill = teamColor(g, d.drive.side); drive.style.opacity = 0.28;
    } else drive.style.opacity = 0;
    const tagBg = $('#fTagBg', svg), tag = $('#fTag', svg), dir = $('#fDir', svg);
    tag.textContent = pos ? g[pos]?.abbr || '' : '';
    tagBg.style.fill = pos ? teamColor(g, pos) : 'transparent';
    dir.textContent = d.dir > 0 ? '▶' : d.dir < 0 ? '◀' : '';
    svg.classList.toggle('redzone', !!d.redZone && g.status.state === 'in');

    const tos = (n) => (n == null ? '' : '●'.repeat(n) + '○'.repeat(Math.max(0, 3 - n)));
    $('#fieldInfo', host).innerHTML = g.status.state === 'in' ? `
      ${d.downText ? `<span class="fi-down">${esc(d.downText)}</span>` : ''}
      ${pos && d.spotText ? `<span>${esc(g[pos]?.abbr)} ball at <b>${esc(d.spotText)}</b></span>` : ''}
      ${d.redZone ? '<span class="fi-red">🚨 RED ZONE</span>' : ''}
      ${d.drive?.text ? `<span class="fi-muted">Drive: ${esc(d.drive.text)}</span>` : ''}
      <span class="fi-muted">TO ${esc(g.away?.abbr)} <i class="tos">${tos(d.timeouts?.away)}</i> · ${esc(g.home?.abbr)} <i class="tos">${tos(d.timeouts?.home)}</i></span>` : '';
    if (FIELD.sel) HILITE.football(host, g, d.plays.find((p) => p.id === FIELD.sel));
  },

  basketball(host, g, d) {
    if (!d) return;
    const layer = $('#shots', host); layer.innerHTML = '';
    const latest = d.shots[d.shots.length - 1]?.id;
    for (const s of d.shots) {
      const c = teamColor(g, s.side);
      const el = s.made
        ? svgEl('circle', { cx: s.x, cy: s.y, r: s.value === 3 ? 0.95 : 0.8, fill: c, class: 'shot made' }, layer)
        : svgEl('g', { class: 'shot miss' }, layer);
      if (!s.made) svgEl('path', { d: `M${s.x - 0.6} ${s.y - 0.6}l1.2 1.2M${s.x + 0.6} ${s.y - 0.6}l-1.2 1.2`, stroke: c }, el);
      el.dataset.id = s.id;
      if (s.id === latest || s.id === FIELD.sel) svgEl('circle', { cx: s.x, cy: s.y, r: 1.6, class: `ping ${s.id === FIELD.sel ? 'sel' : ''}`, stroke: c }, layer);
    }
    const tally = (side) => { const xs = d.shots.filter((s) => s.side === side); return `${xs.filter((s) => s.made).length}/${xs.length}`; };
    $('#fieldInfo', host).innerHTML = g.status.state === 'pre' ? ''
      : `<span><i class="swatch" style="background:${teamColor(g, 'away')}"></i>${esc(g.away?.abbr)} ${tally('away')}</span>
         <span><i class="swatch" style="background:${teamColor(g, 'home')}"></i>${esc(g.home?.abbr)} ${tally('home')}</span>
         <span class="fi-muted">● made · ✕ missed · last ${d.shots.length} shots</span>`;
  },

  hockey(host, g, d) {
    if (!d) return;
    const layer = $('#shots', host); layer.innerHTML = '';
    for (const s of d.shots) {
      const c = teamColor(g, s.side);
      let el;
      if (s.k === 'goal') { el = svgEl('text', { x: s.x, y: s.y + 2.4, class: 'goal-star', fill: c }, layer); el.textContent = '★'; }
      else if (s.k === 'sog') el = svgEl('circle', { cx: s.x, cy: s.y, r: 1.9, fill: c, class: 'shot made' }, layer);
      else el = svgEl('circle', { cx: s.x, cy: s.y, r: 1.6, stroke: c, class: 'shot miss' }, layer);
      el.dataset.id = s.id;
      if (s.id === FIELD.sel) svgEl('circle', { cx: s.x, cy: s.y, r: 4, class: 'ping sel', stroke: c }, layer);
    }
    $('#fieldInfo', host).innerHTML = g.status.state === 'pre' ? '' : `
      <span><i class="swatch" style="background:${teamColor(g, 'away')}"></i>${esc(g.away?.abbr)} <b>${d.sog.away}</b> SOG</span>
      <span><i class="swatch" style="background:${teamColor(g, 'home')}"></i>${esc(g.home?.abbr)} <b>${d.sog.home}</b> SOG</span>
      <span class="fi-muted">★ goal · ● on goal · ○ missed/blocked</span>`;
  },

  baseball(host, g, d) {
    if (!d) return;
    for (const i of [1, 2, 3]) {
      const on = !!d.bases[i - 1];
      $(`#b${i}`, host).classList.toggle('on', on);
      $(`#r${i}`, host).style.opacity = on ? 1 : 0;
    }
    const dots = (n, max, cls) => Array.from({ length: max }, (_, i) => `<i class="${i < (n || 0) ? cls : ''}"></i>`).join('');
    const inning = g.status.period || '';
    const half = d.half === 'top' ? '▲' : d.half === 'bottom' ? '▼' : d.half === 'mid' ? 'MID' : d.half === 'end' ? 'END' : '';
    const person = (p, role) => p ? `<div class="bb-p">${p.headshot ? `<img src="${esc(p.headshot)}" alt="">` : '<span class="ph">👤</span>'}<div><small>${role}</small><b>${esc(p.name)}</b><span>${esc(p.line)}</span></div></div>` : '';
    const pitchCls = (t) => (/strike|foul/.test(t) ? 's' : /ball/.test(t) ? 'b' : 'x');
    $('#bbSide', host).innerHTML = `
      <div class="bb-inning"><span class="half">${half}</span><b>${esc(inning)}</b></div>
      <div class="bb-count"><div><span>B</span>${dots(d.balls, 4, 'b')}</div><div><span>S</span>${dots(d.strikes, 3, 's')}</div><div><span>O</span>${dots(d.outs, 3, 'o')}</div></div>
      ${person(d.batter, 'AT BAT')}${person(d.pitcher, 'PITCHING')}
      ${d.pitches.length ? `<div class="pitches">${d.pitches.map((p, i) => `<span class="pc ${pitchCls(p.type)}" title="${esc(p.text)}">${i + 1}</span>`).join('')}</div>` : ''}`;
    $('#fieldInfo', host).innerHTML = d.bases.every(Boolean) ? '<span class="fi-red">🔥 BASES LOADED</span>' : d.balls === 3 && d.strikes === 2 ? '<span class="fi-down">FULL COUNT</span>' : '';
  },

  soccer(host, g, d) {
    if (!d) return;
    const ph = d.possession.home, pa = d.possession.away;
    if (ph != null && pa != null) {
      const w = (pa / (ph + pa)) * 105;
      const A = $('#possA', host), H = $('#possH', host);
      A.setAttribute('width', w); A.style.fill = teamColor(g, 'away');
      H.setAttribute('x', w); H.setAttribute('width', 105 - w); H.style.fill = teamColor(g, 'home');
    }
    const tl = $('#tl', host);
    $$('.tl-ev', tl).forEach((e) => e.remove());
    const icon = { goal: '⚽', yellow: '🟨', red: '🟥', sub: '🔁', penalty: '🎯' };
    for (const e of d.events) {
      if (e.k === 'sub') continue;
      tl.insertAdjacentHTML('beforeend', `<span class="tl-ev ${e.side === 'home' ? 'h' : 'a'}" style="left:${Math.min(100, (e.min / 95) * 100)}%" title="${esc(e.clock)} ${esc(e.text)}">${icon[e.k] || '•'}</span>`);
    }
    $('#fieldInfo', host).innerHTML = `
      ${ph != null ? `<span>Possession <b>${esc(g.away?.abbr)} ${Math.round(pa)}%</b> · <b>${esc(g.home?.abbr)} ${Math.round(ph)}%</b></span>` : ''}
      ${d.shots.home != null ? `<span class="fi-muted">Shots ${d.shots.away} (${d.onTarget.away ?? 0} on target) – ${d.shots.home} (${d.onTarget.home ?? 0})</span>` : ''}`;
  },
};

const HILITE = {
  football(host, g, play) {
    const grp = $('#fPlay', host); if (!grp) return;
    if (!play || play.fromX == null) { grp.setAttribute('opacity', 0); return; }
    const to = play.toX ?? play.fromX;
    const line = $('#fPlayLine', host), dot = $('#fPlayDot', host);
    const still = Math.abs(to - play.fromX) < 0.5; // no gain: a dot, not a lone arrowhead
    line.style.display = still ? 'none' : '';
    dot.style.display = still ? '' : 'none';
    line.setAttribute('x1', 10 + play.fromX); line.setAttribute('x2', 10 + to);
    dot.setAttribute('cx', 10 + play.fromX);
    line.style.stroke = dot.style.fill = teamColor(g, play.side);
    grp.setAttribute('opacity', 1);
  },
  basketball(host, g) { PAINT.basketball(host, g, g.detail); },
  hockey(host, g) { PAINT.hockey(host, g, g.detail); },
};

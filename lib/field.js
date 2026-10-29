// Turns raw ESPN feeds into a compact, sport-specific "field state" for the
// live stage (where the ball is, who's on base, recent shots...) plus a
// play-by-play feed. Coordinates are normalized so the client just draws.

const sideOf = (teamId, homeId, awayId) => (teamId == null ? null : String(teamId) === String(homeId) ? 'home' : String(teamId) === String(awayId) ? 'away' : null);
const txt = (s, n = 160) => (s ? String(s).replace(/\s+/g, ' ').trim().slice(0, n) : '');

function teamsOf(sum) {
  const comps = sum?.header?.competitions?.[0]?.competitors || [];
  const home = comps.find((c) => c.homeAway === 'home'), away = comps.find((c) => c.homeAway === 'away');
  return { homeId: home?.team?.id, awayId: away?.team?.id, homeAbbr: home?.team?.abbreviation, awayAbbr: away?.team?.abbreviation };
}

// ---------------- football ----------------
// x is yards from the AWAY end zone's goal line (0) to the HOME goal line (100).
// The away team's end zone is drawn on the left.
function spotX(text, t) {
  if (!text) return null;
  const s = String(text).trim();
  if (/^50$/.test(s) || /\b50$/.test(s)) return 50;
  const m = s.match(/^([A-Za-z&.]{2,5})\s+(\d{1,2})$/);
  if (!m) return null;
  const n = Number(m[2]);
  if (m[1] === t.homeAbbr) return 100 - n;
  if (m[1] === t.awayAbbr) return n;
  return null;
}

function football(sum, event, t) {
  const sit = event?.competitions?.[0]?.situation || {};
  const drives = sum?.drives || {};
  const cur = drives.current || null;
  const possession = sideOf(sit.possession ?? cur?.team?.id, t.homeId, t.awayId);
  const ballX = spotX(sit.possessionText, t);
  const dir = possession === 'away' ? 1 : possession === 'home' ? -1 : 0; // away attacks right
  const goal = /goal/i.test(sit.shortDownDistanceText || sit.downDistanceText || '');
  let firstX = null;
  if (ballX != null && dir && sit.distance != null) firstX = goal ? (dir > 0 ? 100 : 0) : Math.max(0, Math.min(100, ballX + dir * sit.distance));

  const flat = [];
  for (const d of [...(drives.previous || []).slice(-3), ...(cur ? [cur] : [])]) {
    const side = sideOf(d.team?.id, t.homeId, t.awayId);
    for (const p of d.plays || []) flat.push({ p, side });
  }
  const plays = flat.slice(-25).map(({ p, side }) => ({
    id: String(p.id),
    text: txt(p.text, 200),
    period: p.period?.number ?? null,
    clock: p.clock?.displayValue || '',
    side,
    kind: p.scoringPlay ? 'score' : p.isTurnover ? 'turnover' : p.isPenalty ? 'penalty' : /timeout/i.test(p.type?.text || '') ? 'stop' : 'play',
    label: p.type?.text || '',
    yards: p.statYardage ?? null,
    fromX: spotX(p.start?.possessionText, t),
    toX: spotX(p.end?.possessionText, t),
    down: p.start?.shortDownDistanceText || '',
  })).reverse();

  // Between plays (after a score, during a kickoff) ESPN drops the spot: fall back to the last play.
  const spot = ballX ?? plays.find((p) => p.toX != null || p.fromX != null)?.toX ?? plays.find((p) => p.fromX != null)?.fromX ?? null;
  return {
    kind: 'football',
    possession, ballX: spot, firstX: ballX == null ? null : firstX, dir,
    down: sit.down ?? null, distance: sit.distance ?? null,
    downText: sit.shortDownDistanceText || '', spotText: sit.possessionText || '',
    redZone: !!sit.isRedZone,
    timeouts: { home: sit.homeTimeouts ?? null, away: sit.awayTimeouts ?? null },
    drive: cur ? {
      side: sideOf(cur.team?.id, t.homeId, t.awayId),
      startX: spotX(cur.start?.text, t),
      text: cur.description || '',
    } : null,
    plays,
  };
}

// ---------------- basketball ----------------
// Half-court coords from ESPN: x 0..50 (sideline to sideline), y 0..47 from the baseline.
function basketball(sum, t) {
  const all = Array.isArray(sum?.plays) ? sum.plays : [];
  const valid = (c) => c && c.x >= 0 && c.x <= 50 && c.y >= 0 && c.y <= 50;
  const shots = all.filter((p) => p.shootingPlay && valid(p.coordinate) && !/free throw/i.test(p.text || '')).slice(-60).map((p) => ({
    id: String(p.id), x: p.coordinate.x, y: p.coordinate.y, made: !!p.scoringPlay, value: p.scoreValue || 0,
    side: sideOf(p.team?.id, t.homeId, t.awayId), text: txt(p.text, 120),
  }));
  const first = all[0];
  const plays = all.slice(-25).map((p) => ({
    id: String(p.id), text: txt(p.text, 200), period: p.period?.number ?? null, clock: p.clock?.displayValue || '',
    side: sideOf(p.team?.id, t.homeId, t.awayId),
    kind: p.scoringPlay ? (p.scoreValue === 3 ? 'three' : 'score') : p.shootingPlay ? 'miss' : /foul/i.test(p.type?.text || '') ? 'foul' : /timeout/i.test(p.type?.text || '') ? 'stop' : 'play',
    label: p.type?.text || '',
    shot: p.shootingPlay && valid(p.coordinate) ? String(p.id) : null,
  })).reverse();
  return {
    kind: 'basketball', shots, plays,
    jumpBall: first && /jump ?ball/i.test(first.type?.text || first.text || '') ? txt(first.text, 140) : null,
    lastThree: [...all].reverse().find((p) => p.scoringPlay && p.scoreValue === 3)?.id || null,
  };
}

// ---------------- baseball ----------------
function baseball(sum, event, t) {
  const sit = event?.competitions?.[0]?.situation || {};
  const detail = event?.status?.type?.shortDetail || '';
  const half = /^top/i.test(detail) ? 'top' : /^bot/i.test(detail) ? 'bottom' : /^mid/i.test(detail) ? 'mid' : /^end/i.test(detail) ? 'end' : null;
  const person = (x) => x?.athlete ? { name: x.athlete.displayName || x.athlete.fullName, short: x.athlete.shortName, headshot: x.athlete.headshot || null, line: x.summary || '', side: sideOf(x.athlete.team?.id, t.homeId, t.awayId) } : null;
  const all = Array.isArray(sum?.plays) ? sum.plays : [];
  const atBatId = sit.lastPlay?.atBatId;
  const pitches = atBatId ? all.filter((p) => p.atBatId === atBatId && p.summaryType === 'P').slice(-12).map((p) => ({
    type: p.type?.type || '', text: txt(p.text, 60),
  })) : [];
  const plays = all.filter((p) => p.summaryType !== 'P' && p.text).slice(-25).map((p) => ({
    id: String(p.id), text: txt(p.text, 200), period: p.period?.number ?? null, clock: p.period?.displayValue || '',
    side: sideOf(p.team?.id, t.homeId, t.awayId),
    kind: p.scoringPlay ? (/homer|home run/i.test(p.text) ? 'homer' : 'score') : /strikes? out|struck out/i.test(p.text) ? 'k' : 'play',
    label: p.type?.text || '',
  })).reverse();
  return {
    kind: 'baseball', half,
    balls: sit.balls ?? null, strikes: sit.strikes ?? null, outs: sit.outs ?? null,
    bases: [!!sit.onFirst, !!sit.onSecond, !!sit.onThird],
    batter: person(sit.batter), pitcher: person(sit.pitcher),
    pitches, plays,
    lastPlay: txt(sit.lastPlay?.text, 140),
  };
}

// ---------------- hockey ----------------
// Rink coords: x -100..100 (end boards), y -42.5..42.5.
function hockey(sum, t) {
  const all = Array.isArray(sum?.plays) ? sum.plays : [];
  const kindOf = (p) => {
    const a = p.type?.abbreviation || '';
    if (p.scoringPlay || a === 'goal') return 'goal';
    if (a === 'shot-on-goal') return 'sog';
    if (a === 'shot-missed') return 'miss';
    if (a === 'blocked-shot') return 'block';
    if (/penalty/i.test(p.type?.text || '')) return 'penalty';
    if (/hit/i.test(p.type?.text || '')) return 'hit';
    if (/faceoff/i.test(p.type?.text || '')) return 'faceoff';
    return 'play';
  };
  const shots = all.filter((p) => p.coordinate && ['goal', 'sog', 'miss', 'block'].includes(kindOf(p))).slice(-60).map((p) => ({
    id: String(p.id), x: p.coordinate.x, y: p.coordinate.y, k: kindOf(p), side: sideOf(p.team?.id, t.homeId, t.awayId), text: txt(p.text, 120),
  }));
  const sog = { home: 0, away: 0 };
  for (const p of all) { const k = kindOf(p); if (k === 'sog' || k === 'goal') { const s = sideOf(p.team?.id, t.homeId, t.awayId); if (s) sog[s]++; } }
  const plays = all.slice(-25).map((p) => ({
    id: String(p.id), text: txt(p.text, 200), period: p.period?.number ?? null, clock: p.clock?.displayValue || '',
    side: sideOf(p.team?.id, t.homeId, t.awayId), kind: kindOf(p), label: p.type?.text || '',
    shot: p.coordinate && ['goal', 'sog', 'miss', 'block'].includes(kindOf(p)) ? String(p.id) : null,
  })).reverse();
  const lastPenalty = [...all].reverse().find((p) => kindOf(p) === 'penalty');
  return { kind: 'hockey', shots, sog, plays, lastPenalty: lastPenalty ? { id: String(lastPenalty.id), side: sideOf(lastPenalty.team?.id, t.homeId, t.awayId), text: txt(lastPenalty.text, 140) } : null };
}

// ---------------- soccer ----------------
function soccer(sum, t) {
  const minute = (s) => { const m = String(s || '').match(/(\d+)(?:'\+(\d+))?/); return m ? Number(m[1]) + (m[2] ? Number(m[2]) / 10 : 0) : null; };
  const kindOf = (e) => {
    const s = `${e.type?.type || ''} ${e.type?.text || ''}`.toLowerCase();
    if (s.includes('goal') && !s.includes('kick')) return 'goal';
    if (s.includes('red')) return 'red';
    if (s.includes('yellow')) return 'yellow';
    if (s.includes('substitution')) return 'sub';
    if (s.includes('penalty')) return 'penalty';
    return 'other';
  };
  const events = (sum?.keyEvents || []).filter((e) => e.clock?.displayValue).map((e) => ({
    id: String(e.id), min: minute(e.clock.displayValue), clock: e.clock.displayValue, k: kindOf(e),
    side: sideOf(e.team?.id, t.homeId, t.awayId), text: txt(e.text || e.type?.text, 160),
  })).filter((e) => e.min != null && e.k !== 'other');
  const stat = (side, name) => {
    const bt = (sum?.boxscore?.teams || []).find((x) => x.homeAway === side);
    const s = (bt?.statistics || []).find((x) => x.name === name);
    return s ? Number(s.displayValue) : null;
  };
  const commentary = (sum?.commentary || []).filter((c) => c.text).slice(-25).map((c, i) => ({
    id: `c${c.sequence ?? i}`, text: txt(c.text, 200), clock: c.time?.displayValue || '', period: null, side: null,
    kind: /goal!/i.test(c.text) ? 'score' : /yellow|red card/i.test(c.text) ? 'card' : 'play',
  }));
  const plays = (commentary.length ? commentary : events.map((e) => ({ id: e.id, text: e.text, clock: e.clock, side: e.side, kind: e.k === 'goal' ? 'score' : 'card' }))).reverse();
  return {
    kind: 'soccer', events, plays,
    possession: { home: stat('home', 'possessionPct'), away: stat('away', 'possessionPct') },
    shots: { home: stat('home', 'totalShots'), away: stat('away', 'totalShots') },
    onTarget: { home: stat('home', 'shotsOnTarget'), away: stat('away', 'shotsOnTarget') },
  };
}

// ESPN sometimes repeats a play under a new id (e.g. a TD and its PAT row).
function dedupe(plays) {
  return plays.filter((p, i) => !i || p.text !== plays[i - 1].text);
}

function build({ sum, event, sport }) {
  const t = teamsOf(sum);
  let out = null;
  try {
    if (sport === 'football') out = football(sum, event, t);
    else if (sport === 'basketball') out = basketball(sum, t);
    else if (sport === 'baseball') out = baseball(sum, event, t);
    else if (sport === 'hockey') out = hockey(sum, t);
    else if (sport === 'soccer') out = soccer(sum, t);
  } catch (e) {
    console.error('field build', sport, e.message);
  }
  if (out?.plays) out.plays = dedupe(out.plays);
  return out;
}

module.exports = { build, spotX };

// Games: turn ESPN game summaries into one team's season, player by player.
// Pure functions, no network. Each sport's box score has its own shape; every
// parser adds one game to an accumulator, keeping only players who appeared
// for the rolled team (team id match), so the pool is exactly that roster.

const { paTier } = require('./fantasy');
const num = (v) => { const n = parseFloat(String(v ?? '').replace(/[^\d.-]/g, '')); return Number.isFinite(n) ? n : 0; };
const pair = (v) => { const m = String(v ?? '').match(/(\d+)\s*[-/]\s*(\d+)/); return m ? [Number(m[1]), Number(m[2])] : [0, 0]; };
const ip = (v) => { const [w, f] = String(v ?? '0').split('.'); return num(w) + (num(f) || 0) / 3; }; // "6.2" = 6 2/3 innings
const toi = (v) => { const [m, s] = String(v ?? '').split(':'); return num(m) + num(s) / 60; };

function newAcc() { return { players: {}, team: { sacked: 0, sackYds: 0, rushAtt: 0, rushYds: 0 }, boxes: 0, info: null }; }

function player(acc, a, eventId) {
  const ath = a.athlete || {};
  if (!ath.id) return null;
  const p = (acc.players[ath.id] ||= { id: String(ath.id), name: ath.displayName || ath.fullName || 'Unknown', short: ath.shortName || null, pos: {}, games: new Set(), t: {} });
  p.games.add(eventId);
  acc.lines = (acc.lines || 0) + 1;
  return p;
}
const add = (p, k, v) => { p.t[k] = (p.t[k] || 0) + (Number.isFinite(v) ? v : 0); };
const posSeen = (p, pos, w = 1) => { if (pos) p.pos[pos] = (p.pos[pos] || 0) + w; };
// Map a stat row to { LABEL: value } using whatever labels that season's feed uses.
const row = (labels, stats) => Object.fromEntries((labels || []).map((l, i) => [l, stats?.[i]]));

function teamEntry(summary, teamId) {
  return (summary.boxscore?.players || []).find((x) => String(x.team?.id) === String(teamId)) || null;
}

// Name, colors and logo as of that season (e.g. "Seattle SuperSonics"), from the game itself.
function noteInfo(acc, summary, teamId) {
  if (acc.info) return;
  const comp = summary.header?.competitions?.[0];
  const c = comp?.competitors?.find((x) => String(x.team?.id ?? x.id) === String(teamId));
  const bt = (summary.boxscore?.teams || []).find((x) => String(x.team?.id) === String(teamId))?.team;
  const t = c?.team || bt;
  if (!t) return;
  acc.info = {
    id: String(teamId), name: t.displayName || bt?.displayName, short: t.shortDisplayName || t.name || bt?.shortDisplayName || null,
    abbr: t.abbreviation || bt?.abbreviation, location: t.location || bt?.location || null,
    logo: bt?.logo || t.logos?.[0]?.href || t.logo || null,
    color: (t.color || bt?.color) ? `#${t.color || bt.color}` : null,
  };
}

// ---------- football ----------
function football(acc, summary, teamId, eventId, game) {
  const entry = teamEntry(summary, teamId);
  if (!entry) return false;
  for (const cat of entry.statistics || []) {
    for (const a of cat.athletes || []) {
      const p = player(acc, a, eventId); if (!p) continue;
      const r = row(cat.labels, a.stats);
      switch (cat.name) {
        case 'passing': {
          const [c, att] = pair(r['C/ATT']); const [sk, sy] = pair(r.SACKS);
          add(p, 'cmp', c); add(p, 'att', att); add(p, 'passYds', num(r.YDS)); add(p, 'passTD', num(r.TD)); add(p, 'int', num(r.INT));
          add(p, 'sacked', sk); add(p, 'sackYds', sy); add(p, 'passGames', 1);
          acc.team.sacked += sk; acc.team.sackYds += sy;
          break;
        }
        case 'rushing':
          add(p, 'car', num(r.CAR)); add(p, 'rushYds', num(r.YDS)); add(p, 'rushTD', num(r.TD));
          acc.team.rushAtt += num(r.CAR); acc.team.rushYds += num(r.YDS);
          break;
        case 'receiving':
          add(p, 'rec', num(r.REC)); add(p, 'recYds', num(r.YDS)); add(p, 'recTD', num(r.TD)); add(p, 'tgt', num(r.TGTS));
          break;
        case 'fumbles': add(p, 'fumLost', num(r.LOST)); break;
        case 'defensive':
          // TD here already includes interception and fumble returns (checked
          // against the interceptions block), so it's the only source of defTD.
          add(p, 'tkl', num(r.TOT)); add(p, 'solo', r.SOLO !== undefined ? num(r.SOLO) : num(r.TOT)); add(p, 'sacks', num(r.SACKS)); add(p, 'tfl', num(r.TFL)); add(p, 'pd', num(r.PD)); add(p, 'qbh', num(r['QB HTS'])); add(p, 'defTD', num(r.TD)); add(p, 'defGames', 1);
          break;
        case 'interceptions':
          add(p, 'defInt', num(r.INT));
          break;
        case 'kicking': {
          const [fgm, fga] = pair(r.FG); const [xpm, xpa] = pair(r.XP);
          add(p, 'fgm', fgm); add(p, 'fga', fga); add(p, 'xpm', xpm); add(p, 'xpa', xpa); add(p, 'kGames', 1);
          break;
        }
        case 'punting': add(p, 'punts', num(r.NO)); break;
        case 'kickReturns': case 'puntReturns': add(p, 'retTD', num(r.TD)); break;
        default: break;
      }
    }
  }
  // Team D/ST for this game, from the same box score: our sacks, picks,
  // defensive and return TDs, the opponent's lost fumbles (our recoveries) and
  // the real points allowed. Needs the real final score.
  if (Number.isFinite(game?.real?.them)) {
    const sum = (e, cat, label) => { const c = (e?.statistics || []).find((x) => x.name === cat); return (c?.athletes || []).reduce((a, x) => a + num(row(c.labels, x.stats)[label]), 0); };
    const opp = (summary.boxscore?.players || []).find((x) => String(x.team?.id) !== String(teamId));
    const d = (acc.team.dst ||= { dstGames: 0, dstSack: 0, dstInt: 0, dstFr: 0, dstTd: 0, paPts: 0, pa: 0 });
    d.dstGames++;
    d.dstSack += sum(entry, 'defensive', 'SACKS');
    d.dstInt += sum(entry, 'interceptions', 'INT');
    d.dstTd += sum(entry, 'defensive', 'TD') + sum(entry, 'kickReturns', 'TD') + sum(entry, 'puntReturns', 'TD');
    d.dstFr += sum(opp, 'fumbles', 'LOST');
    d.pa += game.real.them;
    d.paPts += paTier(game.real.them);
  }
  return true;
}

// ---------- basketball ----------
function basketball(acc, summary, teamId, eventId) {
  const entry = teamEntry(summary, teamId);
  if (!entry) return false;
  const block = entry.statistics?.[0];
  if (!block) return true;
  const keys = block.keys || [];
  for (const a of block.athletes || []) {
    if (a.didNotPlay || !a.stats?.length) continue;
    const r = keys.length ? Object.fromEntries(keys.map((k, i) => [k, a.stats[i]])) : {};
    const min = num(r.minutes);
    if (!min) continue;
    const p = player(acc, a, eventId); if (!p) continue;
    const [fgm, fga] = pair(r['fieldGoalsMade-fieldGoalsAttempted']);
    const [tpm, tpa] = pair(r['threePointFieldGoalsMade-threePointFieldGoalsAttempted']);
    const [ftm, fta] = pair(r['freeThrowsMade-freeThrowsAttempted']);
    add(p, 'min', min); add(p, 'pts', num(r.points)); add(p, 'fgm', fgm); add(p, 'fga', fga); add(p, 'tpm', tpm); add(p, 'tpa', tpa);
    add(p, 'ftm', ftm); add(p, 'fta', fta); add(p, 'reb', num(r.rebounds)); add(p, 'ast', num(r.assists)); add(p, 'tov', num(r.turnovers));
    add(p, 'stl', num(r.steals)); add(p, 'blk', num(r.blocks)); add(p, 'oreb', num(r.offensiveRebounds)); add(p, 'dreb', num(r.defensiveRebounds));
    add(p, 'pf', num(r.fouls)); add(p, 'starts', a.starter ? 1 : 0);
    const tens = [num(r.points), num(r.rebounds), num(r.assists), num(r.steals), num(r.blocks)].filter((x) => x >= 10).length;
    add(p, 'dd', tens >= 2 ? 1 : 0); add(p, 'td3', tens >= 3 ? 1 : 0);
    posSeen(p, a.athlete?.position?.abbreviation);
  }
  return true;
}

// ---------- hockey ----------
function hockey(acc, summary, teamId, eventId, game) {
  const entry = teamEntry(summary, teamId);
  if (!entry) return false;
  const goalies = [];
  for (const grp of entry.statistics || []) {
    const kind = grp.name === 'goalies' ? 'G' : grp.name === 'defenses' ? 'D' : grp.name === 'forwards' ? 'F' : null;
    if (!kind) continue;
    for (const a of grp.athletes || []) {
      if (!a.stats?.length) continue;
      const r = row(grp.labels, a.stats);
      if (r.TOI !== undefined && r.TOI !== '' && toi(r.TOI) === 0 && kind === 'G') continue; // dressed, didn't play
      const p = player(acc, a, eventId); if (!p) continue;
      posSeen(p, kind);
      if (kind === 'G') {
        const ga = num(r.GA), sa = num(r.SA), sv = r.SV !== undefined ? num(r.SV) : Math.max(0, sa - ga);
        add(p, 'gGames', 1); add(p, 'ga', ga); add(p, 'sa', sa || sv + ga); add(p, 'sv', sv); add(p, 'gToi', toi(r.TOI));
        goalies.push({ p, toi: toi(r.TOI) });
      } else {
        // "S" is shots on goal. ESPN's "SOG" column is shootout goals (0 almost always).
        add(p, 'g', num(r.G)); add(p, 'a', num(r.A)); add(p, 'pm', num(r['+/-'])); add(p, 'sog', num(r.S));
        add(p, 'blk', num(r.BS)); add(p, 'hit', num(r.HT)); add(p, 'tk', num(r.TK)); add(p, 'gv', num(r.GV)); add(p, 'pim', num(r.PIM)); add(p, 'toi', toi(r.TOI));
      }
    }
  }
  // Box scores don't carry goalie decisions, so they come from the real final
  // score: the goalie with the most ice time on a winning night gets the win
  // (the official rule credits the goalie in net for the winning goal, which is
  // nearly always the same one). A shutout needs one goalie for the whole game.
  if (goalies.length && Number.isFinite(game?.real?.us) && Number.isFinite(game?.real?.them)) {
    const top = goalies.reduce((a, b) => (b.toi > a.toi ? b : a));
    if (game.real.us > game.real.them) add(top.p, 'w', 1);
    if (game.real.them === 0 && goalies.length === 1) add(top.p, 'so', 1);
  }
  return true;
}

// ---------- baseball ----------
// Doubles, triples and steals aren't box-score columns; they're in the batting
// notes as names ("D Jeter (1, 2nd base off ...)", "Betts 2 (5, ...)"). ESPN
// writes the shortest name that's unique in the game ("Ra Johnson"), so a name
// is matched to exactly one of our batters that day or not at all (unmatched
// ones are counted, never guessed).
const fold = (x) => String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\./g, '').replace(/\s+/g, ' ').trim().toLowerCase();
function splitTop(text) {
  const out = []; let depth = 0, cur = '';
  for (const ch of String(text || '')) {
    if (ch === '(') depth++; else if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ';' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
function matchBatter(name, cands) {
  const s = fold(name);
  const hits = cands.filter((c) => {
    if (s === c.last || s === c.short || s === c.full) return true;
    const sp = s.indexOf(' ');
    return sp > 0 && s.slice(sp + 1) === c.last && c.first.startsWith(s.slice(0, sp));
  });
  return hits.length === 1 ? hits[0].id : null;
}
function baseballNotes(acc, summary, teamId, cands) {
  const t = (summary.boxscore?.teams || []).find((x) => String(x.team?.id) === String(teamId));
  const KEY = { doubles: 'd2', triples: 'd3', stolenBases: 'sb' };
  for (const d of t?.details || []) {
    for (const st of d.stats || []) {
      const k = KEY[st.name]; if (!k) continue;
      for (const seg of splitTop(st.displayValue)) {
        const m = seg.match(/^(.+?)(?:\s+(\d+))?\s*\(/) || seg.match(/^(.+?)(?:\s+(\d+))?$/);
        if (!m) continue;
        const id = matchBatter(m[1], cands), n = Number(m[2] || 1);
        acc.team.notes = (acc.team.notes || 0) + n;
        if (id && acc.players[id]) add(acc.players[id], k, n);
        else acc.team.unmatched = (acc.team.unmatched || 0) + n;
      }
    }
  }
}
const MLB_POS = { C: 'C', '1B': '1B', '2B': '2B', '3B': '3B', SS: 'SS', LF: 'OF', CF: 'OF', RF: 'OF', OF: 'OF', DH: 'DH' };
function baseball(acc, summary, teamId, eventId) {
  const entry = teamEntry(summary, teamId);
  if (!entry) return false;
  const cands = [];
  for (const grp of entry.statistics || []) {
    const kind = grp.type || grp.name;
    for (const a of grp.athletes || []) {
      if (!a.stats?.length) continue;
      const r = row(grp.labels, a.stats);
      if (kind === 'batting') {
        const gp = a.position?.abbreviation || a.athlete?.position?.abbreviation || '';
        if (gp === 'P' || gp === 'SP' || gp === 'RP') continue; // pitchers hitting aren't batters here
        const p = player(acc, a, eventId); if (!p) continue;
        add(p, 'bGames', 1); add(p, 'ab', num(r.AB)); add(p, 'r', num(r.R)); add(p, 'h', num(r.H)); add(p, 'rbi', num(r.RBI));
        add(p, 'hr', num(r.HR)); add(p, 'bb', num(r.BB)); add(p, 'so', num(r.K));
        if (MLB_POS[gp]) posSeen(p, MLB_POS[gp]);
        const parts = fold(a.athlete?.displayName).split(' ');
        cands.push({ id: p.id, full: fold(a.athlete?.displayName), first: parts[0] || '', last: parts.slice(1).join(' '), short: fold(a.athlete?.shortName) });
      } else if (kind === 'pitching') {
        const p = player(acc, a, eventId); if (!p) continue;
        const inn = ip(r.IP);
        add(p, 'pGames', 1); add(p, 'ip', inn); add(p, 'ha', num(r.H)); add(p, 'er', num(r.ER)); add(p, 'pbb', num(r.BB)); add(p, 'pk', num(r.K)); add(p, 'hra', num(r.HR));
        // Pitchers are listed in order of appearance, so the first one started.
        // (ESPN's "starter" flag means "in the starting lineup", which also
        // marks position players who pitched a mop-up inning.)
        if (grp.athletes.indexOf(a) === 0) { add(p, 'gs', 1); add(p, 'gsIp', inn); } else add(p, 'relief', 1);
        // Decisions ride along as notes: "W, 7-3", "L,1-2", "S,43", "H, 4", "B,3" (blown save).
        const dec = (a.notes || []).find((x) => x.type === 'pitchingDecision')?.text?.trim()?.[0];
        if (dec === 'W') add(p, 'w', 1); else if (dec === 'L') add(p, 'l', 1); else if (dec === 'S') add(p, 'sv', 1); else if (dec === 'H') add(p, 'hd', 1);
      }
    }
  }
  baseballNotes(acc, summary, teamId, cands);
  return true;
}

// ---------- soccer ----------
function soccerGroup(code) {
  const c = String(code || '').toUpperCase().replace(/-[LRC]$/, '');
  if (!c || c === 'SUB') return null;
  if (c === 'G' || c === 'GK') return 'GK';
  if (['CD', 'CB', 'D', 'LB', 'RB', 'LWB', 'RWB', 'WB', 'SW', 'LD', 'RD'].includes(c)) return 'DEF';
  if (['DM', 'CM', 'AM', 'LM', 'RM', 'M', 'CDM', 'CAM', 'LAM', 'RAM'].includes(c)) return 'MID';
  if (['F', 'CF', 'ST', 'S', 'LW', 'RW', 'LF', 'RF', 'FW', 'SS'].includes(c)) return 'FWD';
  return null;
}
function soccer(acc, summary, teamId, eventId, game) {
  const ro = (summary.rosters || []).find((x) => String(x.team?.id) === String(teamId));
  if (!ro?.roster?.length) return false;
  // The per-player "GA" stat is unreliable in older feeds (0 in games the team
  // conceded), so goals against come from the real final score when we have it.
  const conceded = Number.isFinite(game?.real?.them) ? game.real.them : null;
  for (const a of ro.roster) {
    const s = Object.fromEntries((a.stats || []).map((x) => [x.abbreviation || x.name, num(x.value ?? x.displayValue)]));
    const played = a.starter || a.subbedIn === true || a.subbedIn?.didSub || s.APP > 0;
    if (!played) continue;
    const p = player(acc, a, eventId); if (!p) continue;
    add(p, 'app', 1); add(p, 'starts', a.starter ? 1 : 0); add(p, 'goals', s.G); add(p, 'ast', s.A); add(p, 'sog', s.SOG); add(p, 'shots', s.SHOT ?? s.SH);
    add(p, 'saves', s.SV); add(p, 'yc', s.YC); add(p, 'rc', s.RC); add(p, 'og', s.OG);
    const ga = conceded ?? s.GA ?? 0;
    if (a.starter) { add(p, 'gaStart', ga); add(p, 'cs', ga === 0 ? 1 : 0); posSeen(p, soccerGroup(a.position?.abbreviation)); }
    else posSeen(p, soccerGroup(a.position?.abbreviation), 0.25); // subs sometimes carry a position too
  }
  return true;
}

const PARSERS = { football, basketball, hockey, baseball, soccer };

// One game into the accumulator. Returns true if the box score had our team.
// `game` (optional) is the schedule entry, with the real final score.
function addGame(sport, acc, summary, teamId, eventId, game = null) {
  noteInfo(acc, summary, teamId);
  // A box score only counts if it actually credited players to this team.
  // ESPN's placeholder "finals" (0-0, no lines) parse cleanly but hold nothing.
  const before = acc.lines || 0;
  const ok = !!PARSERS[sport](acc, summary, teamId, String(eventId), game) && (acc.lines || 0) > before;
  if (ok) acc.boxes++;
  return ok;
}

module.exports = { newAcc, addGame, soccerGroup, _util: { num, pair, ip, toi, fold, splitTop, matchBatter } };

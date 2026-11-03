// Prediction Leagues: the sport-agnostic view of a game.
// Every competition the app already covers (lib/espn.js LEAGUES) is predictable.
// Sport differences (draws, postponements, shootouts) live here, not in the UI.

const espn = require('../espn');

// What a "game winner" pick means per sport. Soccer can end level, so it gets
// a Draw option. Other sports rarely tie (NFL); a tie there is a push.
const SPORT_RULES = {
  football: { drawPick: false },
  basketball: { drawPick: false },
  baseball: { drawPick: false },
  hockey: { drawPick: false }, // shootouts always produce a winner
  soccer: { drawPick: true },
};

function competitions() {
  return Object.entries(espn.LEAGUES).map(([key, l]) => ({
    key, label: l.label, emoji: l.emoji, sport: l.sport, drawPick: !!SPORT_RULES[l.sport]?.drawPick,
  }));
}
const isCompetition = (k) => Object.prototype.hasOwnProperty.call(espn.LEAGUES, k);
const drawPick = (leagueKey) => !!SPORT_RULES[espn.LEAGUES[leagueKey]?.sport]?.drawPick;

// ESPN status names -> one phase vocabulary. A game is only "final" when the
// provider says it's completed; a passed start time proves nothing.
function phase(g) {
  const n = g.statusName || '';
  if (/CANCEL|ABANDON/.test(n)) return 'canceled';
  if (/POSTPONE/.test(n)) return 'postponed';
  if (/SUSPEND/.test(n)) return 'suspended';
  if (g.state === 'post' && g.completed) return 'final';
  if (g.state === 'in' || g.state === 'post') return 'in'; // post-but-not-completed = awaiting official result
  if (/DELAY/.test(n)) return 'delayed';
  return 'scheduled';
}

// 'home' | 'away' | 'tie' once final, 'void' if canceled, null while unresolved.
function outcome(g) {
  const p = phase(g);
  if (p === 'canceled') return 'void';
  if (p !== 'final' || !g.home || !g.away) return null;
  if (g.home.winner && !g.away.winner) return 'home'; // trust the flag (penalties, forfeits)
  if (g.away.winner && !g.home.winner) return 'away';
  const hs = g.home.score, as = g.away.score;
  if (hs == null || as == null) return null;
  return hs === as ? 'tie' : hs > as ? 'home' : 'away';
}

const team = (t) => t && {
  id: t.id ? String(t.id) : null, abbr: t.abbr || null, name: t.name || null, full: t.full || null,
  logo: t.logo || null, color: t.color || null, alt: t.alt || null, record: t.record || null,
  score: t.score ?? null, winner: !!t.winner,
};

// Normalized ESPN event (lib/espn.js normEvent) -> stored game record.
function toRecord(ev, now) {
  return {
    key: `${ev.league}:${ev.id}`,
    league: ev.league, id: String(ev.id), sport: ev.sport, season: ev.season ?? null,
    start: Date.parse(ev.date) || null,
    state: ev.status?.state || 'pre', statusName: ev.status?.name || '', completed: !!ev.status?.completed,
    detail: ev.status?.short || ev.status?.detail || '',
    home: team(ev.home), away: team(ev.away),
    provider: 'espn', fetchedAt: now,
  };
}

module.exports = { SPORT_RULES, competitions, isCompetition, drawPick, phase, outcome, toRecord };

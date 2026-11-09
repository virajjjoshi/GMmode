// Games: the rules of each perfect-season challenge, one entry per sport.
// Everything sport-specific that isn't parsing or simulation lives here:
// which seasons have real box-score data, how ESPN numbers its seasons, what a
// legal squad looks like, and what counts as "perfect".
//
// Season coverage is where ESPN's public box scores include full player lines
// (checked Nov 2026). Older seasons exist on ESPN without player box scores,
// so they're left out rather than filled with guesses.

const SPORTS = {
  nfl: {
    key: 'nfl', label: 'NFL', emoji: '🏈', sport: 'football', espn: 'football/nfl',
    title: 'The 17-0 Challenge', short: '17-0',
    objective: 'perfect',
    blurb: 'Every pick comes from a new random NFL team and season. Build a fantasy lineup, D/ST included, and try to run the table.',
    // ESPN's NFL "season" is the year it kicks off: 2007 = the 2007 season.
    seasons: [2002, 2025],
    seasonLabel: (y) => String(y),
    scheduleNote: 'Your squad plays the real schedule of the team-season you made your first pick from: 17 games from 2021 on, 16 before that, so 16-0 is perfect for a 2007 schedule.',
    slots: [
      { id: 'QB', label: 'QB', n: 1, elig: ['QB'] },
      { id: 'RB', label: 'RB', n: 2, elig: ['RB'] },
      { id: 'WR', label: 'WR', n: 2, elig: ['WR'] },
      { id: 'TE', label: 'TE', n: 1, elig: ['TE'] },
      { id: 'FLEX', label: 'Flex', n: 1, elig: ['RB', 'WR', 'TE'], flex: true, hint: 'RB, WR or TE', plural: 'Flex spots' },
      { id: 'K', label: 'K', n: 1, elig: ['K'] },
      { id: 'DST', label: 'D/ST', n: 1, elig: ['DST'] },
    ],
    groups: ['QB', 'RB', 'WR', 'TE', 'K', 'DST'],
    unitNote: 'Full-PPR scoring, standard fantasy lineup. The D/ST is the team\'s real defense and special teams, scored from its real games: sacks, takeaways, touchdowns and points allowed. Offensive linemen aren\'t in box scores, so they aren\'t part of the game.',
    benchmark: { text: 'The 2007 Patriots are the only team to finish a regular season 16-0.', wins: null },
  },
  nba: {
    key: 'nba', label: 'NBA', emoji: '🏀', sport: 'basketball', espn: 'basketball/nba',
    title: 'The 82-0 Challenge', short: '82-0',
    objective: 'perfect',
    blurb: 'Every pick comes from a new random NBA team and season. Build a starting five and a three-man bench and go for 82-0.',
    // ESPN's NBA "season" is the year it ends: 1996 = 1995-96.
    seasons: [1996, 2026],
    seasonLabel: (y) => `${y - 1}-${String(y).slice(2)}`,
    scheduleNote: 'Your squad plays the real schedule of the team-season you made your first pick from: 82 games, or fewer in shortened seasons like 2011-12 (66) and 2019-20.',
    slots: [
      { id: 'G', label: 'Guard', n: 2, elig: ['G'] },
      { id: 'F', label: 'Forward', n: 2, elig: ['F'] },
      { id: 'C', label: 'Center', n: 1, elig: ['C'] },
      { id: 'BENCH', label: 'Bench', n: 3, elig: ['G', 'F', 'C'], flex: true, hint: 'anyone', plural: 'bench spots' },
    ],
    groups: ['G', 'F', 'C'],
    unitNote: 'Points-league scoring: points, threes, rebounds, assists, steals, blocks, turnovers, and double- and triple-doubles. Every pick\'s fantasy PPG counts, bench included.',
    benchmark: { text: 'The record is 73-9 (2015-16 Warriors).', wins: 73 },
  },
  mlb: {
    key: 'mlb', label: 'MLB', emoji: '⚾', sport: 'baseball', espn: 'baseball/mlb',
    title: 'The 162-0 Challenge', short: '162-0',
    objective: 'perfect',
    blurb: 'Every pick comes from a new random MLB team and season. Fill a lineup, a four-man rotation and a bullpen, then try to never lose.',
    seasons: [2005, 2025],
    seasonLabel: (y) => String(y),
    scheduleNote: 'Your squad plays the real schedule of the team-season you made your first pick from: 162 games (60 in 2020). Your four starters rotate every game.',
    slots: [
      { id: 'C', label: 'C', n: 1, elig: ['C'] },
      { id: '1B', label: '1B', n: 1, elig: ['1B'] },
      { id: '2B', label: '2B', n: 1, elig: ['2B'] },
      { id: '3B', label: '3B', n: 1, elig: ['3B'] },
      { id: 'SS', label: 'SS', n: 1, elig: ['SS'] },
      { id: 'OF', label: 'OF', n: 3, elig: ['OF'] },
      { id: 'DH', label: 'DH', n: 1, elig: ['C', '1B', '2B', '3B', 'SS', 'OF', 'DH'], flex: true, hint: 'any hitter' },
      { id: 'SP', label: 'SP', n: 4, elig: ['SP'] },
      { id: 'RP', label: 'RP', n: 2, elig: ['RP'] },
    ],
    groups: ['C', '1B', '2B', '3B', 'SS', 'OF', 'DH', 'SP', 'RP'],
    unitNote: 'Hitters score per game, pitchers per appearance. Your four starters rotate, so the day\'s starter changes how strong you are that game. Defense isn\'t modeled.',
    benchmark: { text: 'The record is 116 wins (1906 Cubs, 2001 Mariners). Nobody has come close to perfect.', wins: 116 },
  },
  nhl: {
    key: 'nhl', label: 'NHL', emoji: '🏒', sport: 'hockey', espn: 'hockey/nhl',
    title: 'The 82-0 Ice Challenge', short: '82-0',
    objective: 'perfect',
    blurb: 'Every pick comes from a new random NHL team and season. Ice two forward lines, two defense pairs and a goalie, then win every night.',
    seasons: [1996, 2026],
    skip: [2005], // 2004-05 was cancelled
    seasonLabel: (y) => `${y - 1}-${String(y).slice(2)}`,
    scheduleNote: 'Your squad plays the real schedule and rules of the team-season you made your first pick from: ties until 2003-04, shootouts from 2005-06, 3-on-3 overtime from 2015-16. Ties, OT and shootout losses all break a perfect season.',
    slots: [
      { id: 'F', label: 'Forward', n: 6, elig: ['F'] },
      { id: 'D', label: 'Defense', n: 4, elig: ['D'], plural: 'defensemen' },
      { id: 'G', label: 'Goalie', n: 1, elig: ['G'] },
    ],
    groups: ['F', 'D', 'G'],
    unitNote: 'Skaters score goals, assists, plus-minus and shots. Your goalie plays every game and scores wins, saves, goals against and shutouts.',
    benchmark: { text: 'The record is 65 wins (2022-23 Bruins).', wins: 65 },
  },
  epl: {
    key: 'epl', label: 'Soccer', emoji: '⚽', sport: 'soccer', espn: 'soccer/eng.1',
    title: 'The Invincibles Challenge', short: 'Unbeaten',
    league: 'Premier League',
    objective: 'undefeated',
    blurb: 'Every pick comes from a new random Premier League club and season. Build a 4-3-3 and go the whole league season without losing.',
    // ESPN's soccer "season" is the year it starts: 2003 = 2003-04.
    seasons: [2003, 2025],
    seasonLabel: (y) => `${y}-${String(y + 1).slice(2)}`,
    scheduleNote: '38 Premier League matches: the real fixture list of the club-season you made your first pick from. Draws are allowed: the goal is to finish unbeaten. Win every match for a perfect season.',
    slots: [
      { id: 'GK', label: 'GK', n: 1, elig: ['GK'] },
      { id: 'DEF', label: 'DEF', n: 4, elig: ['DEF'] },
      { id: 'MID', label: 'MID', n: 3, elig: ['MID'] },
      { id: 'FWD', label: 'FWD', n: 3, elig: ['FWD'] },
    ],
    groups: ['GK', 'DEF', 'MID', 'FWD'],
    unitNote: 'Players score by the position they fill (a defender\'s goal is worth more than a striker\'s), and can play any position they started a few times that season.',
    benchmark: { text: 'Arsenal went unbeaten in 2003-04 (26 W, 12 D). Nobody has won all 38.', wins: null },
  },
};

const ORDER = ['nfl', 'nba', 'mlb', 'nhl', 'epl'];

function seasonsFor(key) {
  const s = SPORTS[key], out = [];
  for (let y = s.seasons[0]; y <= s.seasons[1]; y++) if (!(s.skip || []).includes(y)) out.push(y);
  return out;
}

// Flatten slots into keys like "WR.0", "WR.1" in draft order.
function slotKeys(key) {
  return SPORTS[key].slots.flatMap((s) => Array.from({ length: s.n }, (_, i) => ({ key: `${s.id}.${i}`, slot: s })));
}

// The public shape of the rules, for the landing page and the draft board.
function publicSport(key) {
  const s = SPORTS[key];
  const picks = s.slots.reduce((a, x) => a + x.n, 0);
  return {
    key, label: s.label, emoji: s.emoji, sport: s.sport, title: s.title, short: s.short, league: s.league || s.label,
    objective: s.objective, blurb: s.blurb, scheduleNote: s.scheduleNote, unitNote: s.unitNote, benchmark: s.benchmark,
    seasons: { from: s.seasons[0], to: s.seasons[1], labelFrom: s.seasonLabel(s.seasons[0]), labelTo: s.seasonLabel(s.seasons[1]), count: seasonsFor(key).length },
    slots: s.slots.map((x) => ({ id: x.id, label: x.label, n: x.n, elig: x.elig, flex: !!x.flex, hint: x.hint || null })),
    groups: s.groups, picks,
  };
}

module.exports = { SPORTS, ORDER, seasonsFor, slotKeys, publicSport };

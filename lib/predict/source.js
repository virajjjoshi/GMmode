// Prediction Leagues data boundary. The service only talks to this interface,
// so swapping ESPN's unofficial feed for a licensed one (Sportradar, etc.)
// means writing one new adapter, and tests can pass in a fake.
//
//   day(leagueKey, 'YYYYMMDD')  -> normalized events for that (US Eastern) day
//   game(leagueKey, id)         -> { event, predictor } freshly fetched
//   probabilitySource           -> label shown next to win probabilities, or null if disabled

const espn = require('../espn');

const etFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
const etYmd = (t) => etFmt.format(new Date(t)).replaceAll('-', '');

function espnSource({ winProb = true } = {}) {
  return {
    name: 'ESPN public site API',
    probabilitySource: winProb ? 'ESPN Matchup Predictor' : null,
    async day(leagueKey, ymd) {
      const today = etYmd(Date.now());
      const ttl = ymd === today ? 30_000 : 5 * 60_000; // finished/future days change slowly
      return espn.scoreboard(leagueKey, ymd, ttl);
    },
    async game(leagueKey, id) {
      const s = await espn.summary(leagueKey, id, 10_000);
      return { event: s.game, predictor: winProb ? s.predictor : null };
    },
  };
}

module.exports = { espnSource, etYmd };

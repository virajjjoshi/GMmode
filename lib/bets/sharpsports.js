// SharpSports adapter: the real "connect DraftKings / FanDuel / ..." path.
// SharpSports works like Plaid for sportsbooks: the bettor logs in on
// SharpSports' own page (we never see their sportsbook password), then we
// read their bet slips with our private key.
//
//   SHARPSPORTS_PUBLIC_KEY   creates link sessions (POST /v1/context)
//   SHARPSPORTS_PRIVATE_KEY  reads bet slips (GET /v1/bettors/{internalId}/betSlips)
//
// Docs: https://docs.sharpsports.io  Our fan id is the SharpSports internalId.

const BASE = 'https://api.sharpsports.io/v1';
const PUB = process.env.SHARPSPORTS_PUBLIC_KEY || '';
const PRIV = process.env.SHARPSPORTS_PRIVATE_KEY || '';

const configured = () => !!(PUB && PRIV);

async function call(method, path, key, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { authorization: `Token ${key}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`SharpSports ${method} ${path} failed (${res.status})`);
  return res.json();
}

// Returns the URL to send the bettor to. They pick their state and book there.
async function linkUrl(uid, redirectUrl) {
  const ctx = await call('POST', '/context', PUB, { internalId: uid, redirectUrl, uiMode: 'dark' });
  const cid = ctx?.cid || ctx?.id;
  if (!cid) throw new Error('SharpSports did not return a link session.');
  return `https://ui.sharpsports.io/link/${encodeURIComponent(cid)}`;
}

async function betSlips(uid) {
  const list = await call('GET', `/bettors/${encodeURIComponent(uid)}/betSlips?limit=100`, PRIV);
  return Array.isArray(list) ? list : [];
}

// SharpSports league names/ids -> our ESPN league keys.
const LEAGUE = { nfl: 'nfl', ncaaf: 'cfb', cfb: 'cfb', nba: 'nba', wnba: 'wnba', ncaab: 'cbb', cbb: 'cbb', mlb: 'mlb', nhl: 'nhl', epl: 'epl', mls: 'mls', ucl: 'ucl' };
const leagueKey = (ev) => LEAGUE[String(ev?.league || '').toLowerCase()] || LEAGUE[String(ev?.leagueId || '').replace(/^LGUE_/i, '').toLowerCase()] || null;

const MARKET = (prop) => {
  const p = String(prop || '').toLowerCase().replace(/[^a-z]/g, '');
  return p === 'spread' ? 'spread' : p === 'total' ? 'total' : p === 'moneyline' ? 'ml' : 'other';
};

// Normalize a SharpSports BetSlip. Legs keep SharpSports' event so the service
// can match them to ESPN games; outcome comes from the book when it's settled.
function normalize(s) {
  const book = s.book || {};
  return {
    id: `SS_${s.id}`,
    book: { key: String(book.abbr || book.id || 'book').toLowerCase(), name: book.name || 'Sportsbook' },
    type: s.type === 'parlay' ? 'parlay' : 'single',
    odds: s.oddsAmerican,
    atRisk: s.adjusted?.atRisk ?? s.atRisk,
    toWin: s.toWin,
    placedAt: s.timePlaced ? Date.parse(s.timePlaced) : null,
    outcome: s.status === 'completed' ? (s.outcome || null) : null,
    netProfit: s.status === 'completed' ? s.netProfit ?? null : null,
    legs: (s.bets || []).map((b) => {
      const ev = b.event || {};
      const pos = String(b.position || '');
      return {
        league: leagueKey(ev),
        gameId: null, // filled in by the service once matched to ESPN
        market: MARKET(b.proposition),
        pick: /^over/i.test(pos) ? 'over' : /^under/i.test(pos) ? 'under' : pos,
        line: Number.isFinite(b.line) ? b.line : null,
        odds: b.oddsAmerican,
        outcome: b.status === 'completed' ? b.outcome : null,
        desc: b.bookDescription || pos,
        event: ev.name || null,
        start: ev.startTime || null,
        home: ev.contestantHome?.fullName || null,
        away: ev.contestantAway?.fullName || null,
      };
    }),
  };
}

module.exports = { configured, linkUrl, betSlips, normalize };

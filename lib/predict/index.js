// Prediction Leagues wiring: real storage + ESPN source + routes + results sync.
//   PL_DATA_FILE=path     where league data lives (default data/predictions.json)
//   ESPN_WIN_PROB=off     hide ESPN Matchup Predictor values entirely
//   PL_SYNC_MS=120000     how often results are refreshed for leagues in play

const path = require('node:path');
const { createStore } = require('./persist');
const { createService } = require('./service');
const { createRoutes } = require('./routes');
const { espnSource } = require('./source');

const file = process.env.PL_DATA_FILE || path.join(__dirname, '..', '..', 'data', 'predictions.json');
const store = createStore(file);
const service = createService({ store, source: espnSource({ winProb: process.env.ESPN_WIN_PROB !== 'off' }) });
const handle = createRoutes(service);

function start() {
  const every = Math.max(30_000, Number(process.env.PL_SYNC_MS) || 120_000);
  const run = () => service.sync().catch((e) => console.error(`[predict] sync failed: ${e.message}`));
  setTimeout(run, 5_000).unref();
  setInterval(run, every).unref();
  const flush = () => { try { store.flush(); } catch { /* best effort */ } };
  process.once('SIGINT', () => { flush(); process.exit(0); });
  process.once('SIGTERM', () => { flush(); process.exit(0); });
}

module.exports = { handle, start, service };

// Bet tracking rules: live status, sweat odds, settlement and bad beats.
const test = require('node:test');
const assert = require('node:assert/strict');
const { legState, slipState, progress } = require('../lib/bets/track');

const game = (league, hs, as, state = 'post', status = {}) => ({
  id: '1', league, date: '2026-11-03T00:00:00Z',
  home: { abbr: 'HOM', score: hs }, away: { abbr: 'AWY', score: as },
  status: { state, period: 0, clock: '', short: '', detail: '', ...status },
});
const leg = (market, pick, line, odds = -110) => ({ league: 'nba', gameId: '1', market, pick, line, odds });

test('spread covers, misses and pushes', () => {
  assert.equal(legState(leg('spread', 'home', -3.5), game('nba', 110, 100)).result, 'win');
  assert.equal(legState(leg('spread', 'home', -10.5), game('nba', 110, 100)).result, 'loss');
  assert.equal(legState(leg('spread', 'away', 10), game('nba', 110, 100)).result, 'push');
});

test('totals and moneylines settle', () => {
  assert.equal(legState(leg('total', 'over', 209.5), game('nba', 110, 100)).result, 'win');
  assert.equal(legState(leg('total', 'under', 209.5), game('nba', 110, 100)).result, 'loss');
  assert.equal(legState(leg('ml', 'away', null, 150), game('nba', 110, 100)).result, 'loss');
});

test('a soccer draw loses a moneyline', () => {
  const l = { ...leg('ml', 'home', null, 120), league: 'epl' };
  assert.equal(legState(l, game('epl', 1, 1)).result, 'loss');
});

test('progress follows the clock', () => {
  assert.equal(progress(game('nba', 0, 0, 'pre')), 0);
  assert.equal(progress(game('nba', 50, 50, 'in', { period: 3, clock: '12:00' })), 0.5);
  assert.equal(progress(game('nba', 1, 1, 'post')), 1);
});

test('sweat odds rise with the lead and the clock', () => {
  const early = legState(leg('ml', 'home'), game('nba', 10, 5, 'in', { period: 1, clock: '6:00' })).p;
  const late = legState(leg('ml', 'home'), game('nba', 100, 95, 'in', { period: 4, clock: '0:30' })).p;
  const behind = legState(leg('ml', 'home'), game('nba', 95, 100, 'in', { period: 4, clock: '0:30' })).p;
  assert.ok(early > 0.5 && early < late, `${early} < ${late}`);
  assert.ok(behind < 0.2);
});

test('a parlay with one open leg left is ONE LEG AWAY', () => {
  const games = { 'nba:1': game('nba', 110, 100), 'nba:2': { ...game('nba', 50, 50, 'in', { period: 3, clock: '5:00' }), id: '2' } };
  const s = slipState({ type: 'parlay', legs: [leg('ml', 'home'), { ...leg('ml', 'home'), gameId: '2' }] }, games);
  assert.equal(s.oneLegAway, true);
  assert.equal(s.outcome, null);
});

test('a parlay is dead as soon as one leg loses', () => {
  const games = { 'nba:1': game('nba', 100, 110), 'nba:2': { ...game('nba', 50, 50, 'in', { period: 3, clock: '5:00' }), id: '2' } };
  const s = slipState({ type: 'parlay', legs: [leg('ml', 'home'), { ...leg('ml', 'home'), gameId: '2' }] }, games);
  assert.equal(s.outcome, 'loss');
  assert.equal(s.oneLegAway, false);
});

test('bad beats: lost by the hook, or a parlay one leg short', () => {
  const g = { 'nba:1': game('nba', 105, 100) };
  const hook = slipState({ type: 'single', legs: [leg('spread', 'home', -5.5)] }, g);
  assert.equal(hook.badBeat.kind, 'hook');
  assert.equal(hook.badBeat.miss, 0.5);
  const blowout = slipState({ type: 'single', legs: [leg('spread', 'home', -15.5)] }, g);
  assert.equal(blowout.badBeat, null);

  const games = {};
  const legs = [1, 2, 3, 4].map((i) => { games[`nba:${i}`] = { ...game('nba', i === 4 ? 99 : 110, 100), id: String(i) }; return { ...leg('ml', 'home'), gameId: String(i) }; });
  const par = slipState({ type: 'parlay', legs }, games);
  assert.equal(par.badBeat.kind, 'one-leg');
  assert.equal(par.badBeat.legs, 4);
});

test('a synced bet the book already graded keeps the book\'s result', () => {
  const s = slipState({ type: 'single', outcome: 'win', legs: [{ league: 'nba', gameId: null, market: 'other', desc: 'Player points over 24.5', outcome: 'win' }] }, {});
  assert.equal(s.outcome, 'win');
  assert.equal(s.legs[0].label, 'Player points over 24.5');
});

// Takes hub feed + the retired League Trash Talk threads.
// Uses a throwaway DATA_DIR so it never touches real data.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ttl-takes-'));
// An old db with a fantasy league thread ("fl:") from before the feature was retired.
fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify({
  comments: {
    old1: { id: 'old1', gameKey: 'fl:123', parentId: null, uid: 'u-old', name: 'OldTimer', avatar: '🐐', text: 'league trash talk', heat: 'spicy', createdAt: 1, votes: { a: 'fire', b: 'fire', c: 'fire' } },
  },
  labels: { 'fl:123': 'My League (Fantasy)' },
}));
process.env.DATA_DIR = dir;
const store = require('../lib/store');

const U1 = 'fan-1111-1111-1111', U2 = 'fan-2222-2222-2222';

test('feed: takes from every game thread, filtered by sport, sorted', () => {
  const nfl = store.addComment('nfl:1', { uid: U1, name: 'Ann', avatar: '🦅', text: 'Defense wins it', heat: 'spicy' });
  store.addComment('nfl:1', { uid: U2, name: 'Bo', avatar: '🐻', text: 'no chance', heat: 'mild', parentId: nfl.id });
  const nba = store.addComment('nba:9', { uid: U2, name: 'Bo', avatar: '🐻', text: 'MVP race is over', heat: 'nuclear' });
  store.voteComment(nba.id, U1, 'fire');

  const all = store.feed({ uid: U1 });
  assert.equal(all.all, 2, 'root takes only, retired fantasy thread excluded');
  assert.deepEqual(all.counts, { nfl: 1, nba: 1 });
  assert.ok(all.takes.every((t) => !t.gameKey.startsWith('fl:')));
  assert.equal(all.takes.find((t) => t.id === nfl.id).replies, 1);
  assert.equal(all.takes.find((t) => t.id === nba.id).myVote, 'fire');

  const onlyNba = store.feed({ league: 'nba' });
  assert.deepEqual(onlyNba.takes.map((t) => t.id), [nba.id]);
  assert.equal(onlyNba.takes[0].league, 'nba');

  assert.equal(store.feed({ sort: 'top' }).takes[0].id, nba.id, 'top = most fire');
  assert.equal(store.feed({ receipts: true }).takes.length, 0, 'money filter needs a shared bet');
});

test('hall: retired fantasy threads are kept on disk but not shown', () => {
  const h = store.hall();
  assert.ok(h.topTakes.every((t) => !t.gameKey.startsWith('fl:')));
  assert.ok(!h.takeMasters.some((u) => u.name === 'OldTimer'));
  assert.equal(h.totals.takes, 3, 'two takes + one reply; the fantasy take is not counted');
  store.flush();
  const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'db.json'), 'utf8'));
  assert.ok(onDisk.comments.old1, 'old rows are preserved, not deleted');
});

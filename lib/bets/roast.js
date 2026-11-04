// The Bet Therapist and other betting jokes. Same rules as lib/humor.js:
// seeded so a page refresh doesn't reshuffle, and no verbs that have to agree
// with a team name.

const { seeded } = require('./demo');

const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
const money = (cents) => `$${(Math.abs(cents) / 100).toFixed(cents % 100 ? 2 : 0)}`;

// A few lines about your betting habits, from your settled + open slips.
function therapist(seed, stats) {
  const r = seeded(`${seed}:therapy:${new Date().toISOString().slice(0, 10)}`);
  const out = [];
  const { w, l, net, parlays, slips, longest, favTeam, favCount, open } = stats;
  if (!slips) return ['No bets yet. Honestly? Healthiest person in the building.'];
  if (net > 0) out.push(pick(r, [
    `Up ${money(net)}. Don't tell anyone. Especially the sportsbook.`,
    `Up ${money(net)}. This is exactly how it starts. Proceed with suspicion.`,
    `You're ${money(net)} in the green. Screenshot it. Frame it. It won't last.`,
  ]));
  else if (net < 0) out.push(pick(r, [
    `Down ${money(net)}. That's not a losing streak, that's a subscription.`,
    `Down ${money(net)}. You could've bought a nice dinner. Several, actually.`,
    `${money(net)} in the red. The sportsbook sent a thank-you card. Check your mail.`,
  ]));
  else out.push('Dead even. The most boring possible outcome. Respect.');
  if (w + l >= 3) out.push(w > l ? `${w}-${l} on settled bets. A winning record. Suspicious, but okay.` : `${w}-${l} on settled bets. A coin would be ${Math.max(0, Math.round((w + l) / 2) - w)} wins ahead of you.`);
  if (parlays >= 2) out.push(pick(r, [
    `${parlays} parlays. You don't want to win money, you want to tell a story.`,
    `${parlays} parlays on file. The sportsbook's favorite customer, by a mile.`,
  ]));
  if (longest >= 500) out.push(`Longest shot on the board: +${longest}. Optimism like that should be studied by science.`);
  if (favTeam && favCount >= 3) out.push(`${favCount} bets involving ${favTeam}. At some point this stops being analysis and starts being a relationship.`);
  if (open >= 4) out.push(`${open} bets still open. Your heart rate tonight is going to be a whole thing.`);
  return out.slice(0, 4);
}

function badBeatLine(seed, bb) {
  const r = seeded(`${seed}:bb`);
  if (bb.kind === 'one-leg') return pick(r, [
    `${bb.legs - 1} for ${bb.legs}. ${bb.leg} said "nah." Somewhere, a sportsbook executive smiled.`,
    `Hit ${bb.legs - 1} legs, then ${bb.leg} happened. Parlays are just heartbreak with extra steps.`,
    `One leg. ONE. ${bb.leg} owes this person an apology and a hug.`,
  ]);
  return pick(r, [
    `Lost by ${bb.miss}. The hook giveth, the hook mostly taketh.`,
    `${bb.leg}, lost by ${bb.miss}. Physically painful to read.`,
    `Missed by ${bb.miss}. That's not a loss, that's a crime against hope.`,
  ]);
}

function tailFadeLine(seed, tails, fades) {
  const r = seeded(`${seed}:tf`);
  if (tails + fades < 2) return 'The jury is still out.';
  if (fades > tails * 2) return pick(r, ['The crowd smells a disaster.', 'The fade is ON.', 'Everyone is betting against this. Brutal.']);
  if (tails > fades * 2) return pick(r, ['The people believe.', 'Bandwagon fully loaded.', 'Tailing like it\'s free money (it isn\'t).']);
  return pick(r, ['A genuinely divided crowd.', 'Half tailing, half fading, all sweating.']);
}

module.exports = { therapist, badBeatLine, tailFadeLine, money };

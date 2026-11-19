import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundled = await build({
  stdin: {
    contents: "export * from './shared/hearsay.ts'; export * from './shared/foley-scenes.ts';",
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { FOLEY_SCENES, planHearSayRound, matchupPoints, rankMatchup } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].contents).toString('base64')}`
);

assert.equal(new Set(FOLEY_SCENES.map((scene) => scene.id)).size, FOLEY_SCENES.length);
for (const scene of FOLEY_SCENES) {
  assert.equal(scene.slots.length, scene.appearance === 'LATE' ? 3 : 1);
  for (const slot of scene.slots) assert.ok(slot.prompt && slot.action && slot.durationMs > 0);
}

for (let playerCount = 2; playerCount <= 20; playerCount++) {
  const playerIds = Array.from({ length: playerCount }, (_, index) => `player-${index}`);
  const used = new Set();
  for (const roundNumber of [1, 2, 3]) {
    const plan = planHearSayRound(playerIds, roundNumber, used, () => 0.42);
    assert.equal(plan.scenes.length, roundNumber === 3 ? 1 : 2);
    for (const planned of plan.scenes) {
      assert.ok(!used.has(planned.scene.videoId));
      used.add(planned.scene.videoId);
      assert.equal(planned.matchups.length, planned.scene.slots.length);
      for (const matchup of planned.matchups) assert.ok(matchup.playerIds.length >= 2);
    }
    assert.deepEqual(
      new Set(plan.assignments.map((assignment) => assignment.playerId)),
      new Set(playerIds),
    );
    for (const assignment of plan.assignments) {
      assert.equal(
        assignment.durationMs,
        plan.scenes.find((item) => item.scene.id === assignment.sceneId).scene.slots[
          assignment.slot
        ].durationMs,
      );
    }
  }
}

assert.deepEqual(matchupPoints([3, 1]), [1100, 400]);
assert.deepEqual(matchupPoints([0, 0]), [0, 0]);
const ranked = rankMatchup([
  { playerId: 'a', votes: 2, likes: 1, priorVideoAppearances: 2 },
  { playerId: 'b', votes: 2, likes: 0, priorVideoAppearances: 1 },
  { playerId: 'c', votes: 0, likes: 2, priorVideoAppearances: 0 },
]);
assert.equal(ranked.winner.playerId, 'b');
assert.equal(ranked.runnerUp.playerId, 'a');
assert.equal(ranked.points.get('a'), 820);
assert.equal(ranked.points.get('b'), 800);
assert.equal(ranked.points.get('c'), 40);
console.log('Hear Say content, assignments, and point allocation passed for 2–20 players');

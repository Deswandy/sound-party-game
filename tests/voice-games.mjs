import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundled = await build({
  entryPoints: ['shared/voice-games.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { createVoiceGame, stepVoiceGame } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].contents).toString('base64')}`
);

function run(kind, input, seconds = 15) {
  let state = createVoiceGame(kind);
  for (let time = 0; time < seconds * 1000; time += 16) {
    state = stepVoiceGame(state, input(state, time), 16);
  }
  return state;
}

assert.equal(run('bop', () => 0).tally, 0);
assert.ok(run('bop', (_state, time) => (Math.floor(time / 1000) % 2 ? 0 : 0.24)).tally >= 4);
assert.equal(run('dots', () => 0).tally, 0);
assert.ok(run('dots', (state) => ((80 - state.targetY) / 65) * 0.24).tally >= 3);
assert.equal(run('jump', () => 0).tally, 0);
assert.ok(
  run('jump', (state) => (state.obstacleX < 33 && state.obstacleX > 30 ? 0.24 : 0)).tally >= 2,
);

console.log('Voice games score completed ball trips, dots, and obstacle jumps');

import assert from 'node:assert/strict';

const base = 'http://127.0.0.1:8787/api/rooms';
async function call(path, method = 'GET', token, body) {
  const response = await fetch(base + path, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, data: await response.json() };
}
async function upload(code, token) {
  const response = await fetch(`${base}/${code}/clips`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'audio/webm',
      'x-clip-duration-ms': '1000',
    },
    body: new Uint8Array([1, 2, 3]),
  });
  return response.status;
}
const room = (await call('', 'POST')).data;
const path = `/${room.code}`;
const alice = (await call(`${path}/join`, 'POST', undefined, { name: 'Alice' })).data;
const bob = (await call(`${path}/join`, 'POST', undefined, { name: 'Bob' })).data;
assert.equal((await call(`${path}/ready`, 'POST', alice.playerToken, { ready: true })).status, 200);
assert.equal(
  (await call(`${path}/state`, 'GET', room.hostToken)).data.players.find((p) => p.name === 'Alice')
    .ready,
  true,
);
assert.equal(
  (await call(`${path}/rounds`, 'POST', room.hostToken, { prompt: 'Make a surprising sound' }))
    .status,
  201,
);
assert.equal(await upload(room.code, alice.playerToken), 201);
assert.equal(await upload(room.code, bob.playerToken), 201);
assert.equal((await call(`${path}/close-recording`, 'POST', room.hostToken)).status, 200);
const state = (await call(`${path}/state`, 'GET', room.hostToken)).data;
assert.equal(state.clips.length, 2);
assert.equal(state.results.length, 0);
assert.equal((await call(`${path}/open-voting`, 'POST', room.hostToken)).status, 409);
const [first, second] = state.clips;
assert.equal(
  (await call(`${path}/playback/select`, 'POST', room.hostToken, { clipId: second.id })).status,
  409,
);
assert.equal(
  (await call(`${path}/playback/select`, 'POST', room.hostToken, { clipId: first.id })).status,
  200,
);
assert.equal(
  (
    await fetch(`${base}${path}/clips/${first.id}/audio`, {
      headers: { authorization: `Bearer ${alice.playerToken}` },
    })
  ).status,
  403,
);
assert.equal(
  (
    await fetch(`${base}${path}/clips/${first.id}/audio`, {
      headers: { authorization: `Bearer ${room.hostToken}` },
    })
  ).status,
  200,
);
assert.equal(
  (await call(`${path}/playback/select`, 'POST', room.hostToken, { clipId: second.id })).status,
  200,
);
assert.equal((await call(`${path}/open-voting`, 'POST', room.hostToken)).status, 200);
const aliceState = (await call(`${path}/state`, 'GET', alice.playerToken)).data;
const bobState = (await call(`${path}/state`, 'GET', bob.playerToken)).data;
assert.equal(
  (await call(`${path}/votes`, 'POST', alice.playerToken, { clipId: aliceState.myClipId })).status,
  409,
);
assert.equal(
  (await call(`${path}/votes`, 'POST', alice.playerToken, { clipId: bobState.myClipId })).status,
  201,
);
assert.equal(
  (await call(`${path}/votes`, 'POST', alice.playerToken, { clipId: bobState.myClipId })).status,
  409,
);
assert.equal(
  (await call(`${path}/votes`, 'POST', bob.playerToken, { clipId: aliceState.myClipId })).status,
  201,
);
assert.equal((await call(`${path}/state`, 'GET', room.hostToken)).data.results.length, 0);
assert.equal((await call(`${path}/reveal`, 'POST', bob.playerToken)).status, 403);
assert.equal((await call(`${path}/reveal`, 'POST', room.hostToken)).status, 200);
const results = (await call(`${path}/state`, 'GET', room.hostToken)).data;
assert.equal(results.results.length, 2);
assert.equal(results.results[0].votes, 1);
assert.equal(results.results[1].votes, 1);
assert.equal(
  results.scores.reduce((total, score) => total + score.votes, 0),
  2,
);
assert.equal((await call(`${path}/next-round`, 'POST', room.hostToken)).status, 200);
assert.equal((await call(`${path}/state`, 'GET', room.hostToken)).data.phase, 'lobby');
for (const roundNumber of [2, 3]) {
  assert.equal(
    (await call(`${path}/rounds`, 'POST', room.hostToken, { prompt: `Round ${roundNumber} sound` }))
      .status,
    201,
  );
  assert.equal(await upload(room.code, alice.playerToken), 201);
  assert.equal((await call(`${path}/close-recording`, 'POST', room.hostToken)).status, 200);
  const roundState = (await call(`${path}/state`, 'GET', room.hostToken)).data;
  assert.equal(roundState.roundNumber, roundNumber);
  assert.equal(
    (
      await call(`${path}/playback/select`, 'POST', room.hostToken, {
        clipId: roundState.clips[0].id,
      })
    ).status,
    200,
  );
  assert.equal((await call(`${path}/open-voting`, 'POST', room.hostToken)).status, 200);
  assert.equal((await call(`${path}/reveal`, 'POST', room.hostToken)).status, 200);
  if (roundNumber === 2)
    assert.equal((await call(`${path}/next-round`, 'POST', room.hostToken)).status, 200);
}
assert.equal((await call(`${path}/next-round`, 'POST', room.hostToken)).status, 409);
assert.equal((await call(`${path}/restart`, 'POST', bob.playerToken)).status, 403);
assert.equal((await call(`${path}/restart`, 'POST', room.hostToken)).status, 200);
const restarted = (await call(`${path}/state`, 'GET', room.hostToken)).data;
assert.equal(restarted.phase, 'lobby');
assert.equal(restarted.roundNumber, 0);
assert.equal(restarted.players.length, 2);
console.log(
  'Full game loop passed: ready, playback, private audio, vote, tie, scores, three rounds, replay.',
);

import assert from 'node:assert/strict';

const base = 'http://127.0.0.1:8787/api/rooms';
async function json(path, method, token, body) {
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
async function upload(code, token, duration, type = 'audio/webm') {
  const response = await fetch(`${base}/${code}/clips`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': type,
      'x-clip-duration-ms': String(duration),
    },
    body: new Uint8Array([1, 2, 3]),
  });
  return { status: response.status, data: await response.json() };
}
const room = (await json('', 'POST')).data;
const path = `/${room.code}`;
assert.equal(
  (await json(`${path}/rounds`, 'POST', room.hostToken, { prompt: 'Make a spaceship sound' }))
    .status,
  409,
);
const player = (await json(`${path}/join`, 'POST', undefined, { name: 'Tester' })).data;
assert.equal(
  (await json(`${path}/rounds`, 'POST', player.playerToken, { prompt: 'Make a spaceship sound' }))
    .status,
  403,
);
assert.equal((await json(`${path}/rounds`, 'POST', room.hostToken, { prompt: '  ' })).status, 400);
assert.equal((await json(`${path}/close-recording`, 'POST', room.hostToken)).status, 409);
const started = await json(`${path}/rounds`, 'POST', room.hostToken, {
  prompt: 'Make a spaceship sound',
});
assert.equal(started.status, 201, JSON.stringify(started.data));
assert.equal((await json(`${path}/close-recording`, 'POST', room.hostToken)).status, 409);
assert.equal((await upload(room.code, player.playerToken, 30001)).status, 400);
assert.equal(
  (await upload(room.code, player.playerToken, 1000, 'application/octet-stream')).status,
  400,
);
assert.equal((await upload(room.code, room.hostToken, 1000)).status, 401);
assert.equal((await upload(room.code, player.playerToken, 30000)).status, 201);
assert.equal((await upload(room.code, player.playerToken, 12000)).status, 201);
const state = await json(`${path}/state`, 'GET', player.playerToken);
assert.equal(state.data.phase, 'recording');
assert.equal(state.data.prompt, 'Make a spaceship sound');
assert.equal(state.data.submissionCount, 1);
assert.equal(state.data.mySubmitted, true);
assert.equal((await json(`${path}/close-recording`, 'POST', player.playerToken)).status, 403);
assert.equal((await json(`${path}/close-recording`, 'POST', room.hostToken)).status, 200);
assert.equal((await upload(room.code, player.playerToken, 1000)).status, 409);
console.log('Recording API passed: prompt, 30-second limit, replacement, close, late rejection.');

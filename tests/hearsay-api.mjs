import assert from 'node:assert/strict';

const root = 'http://127.0.0.1:8787/api/rooms';
async function request(path, method = 'GET', token, body) {
  const response = await fetch(root + path, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json() };
}
async function upload(path, token, durationMs) {
  const response = await fetch(root + path, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'audio/webm',
      'x-clip-duration-ms': String(durationMs),
    },
    body: new Uint8Array([1, 2, 3]),
  });
  return { status: response.status, body: await response.json() };
}

const room = (await request('', 'POST')).body;
const path = `/${room.code}`;
const alice = (await request(`${path}/join`, 'POST', undefined, { name: 'Alice' })).body;
const bob = (await request(`${path}/join`, 'POST', undefined, { name: 'Bob' })).body;
assert.equal((await request(`${path}/hearsay/state`, 'GET', 'a'.repeat(64))).status, 401);
assert.equal((await upload(`${path}/hearsay/avatar`, alice.playerToken, 2501)).status, 400);
assert.equal((await upload(`${path}/hearsay/avatar`, alice.playerToken, 2000)).status, 201);
assert.equal((await upload(`${path}/hearsay/avatar`, bob.playerToken, 1800)).status, 201);
for (const token of [alice.playerToken, bob.playerToken]) {
  assert.equal((await request(`${path}/ready`, 'POST', token, { ready: true })).status, 200);
}
assert.equal((await request(`${path}/hearsay/rounds`, 'POST', alice.playerToken)).status, 403);
const started = await request(`${path}/hearsay/rounds`, 'POST', room.hostToken);
assert.equal(started.status, 201);
assert.equal(started.body.roundNumber, 1);
assert.equal(started.body.minigame, 'bop');
assert.equal((await request(`${path}/hearsay/rounds`, 'POST', room.hostToken)).status, 409);
const hostState = (await request(`${path}/hearsay/state`, 'GET', room.hostToken)).body;
const aliceState = (await request(`${path}/hearsay/state`, 'GET', alice.playerToken)).body;
assert.equal(hostState.assignments.length, 4);
assert.equal(aliceState.assignments.length, 2);
assert.equal(aliceState.plan, undefined);
assert.equal(hostState.stage, 'intermission');
assert.equal(hostState.players.find((player) => player.id === alice.playerId).hasAvatar, true);
assert.equal(
  (await request(`${path}/hearsay/intermission/tally`, 'POST', alice.playerToken)).status,
  200,
);
assert.equal(
  (await request(`${path}/hearsay/intermission/finish`, 'POST', room.hostToken)).status,
  200,
);
assert.equal(
  (await request(`${path}/hearsay/intermission/tally`, 'POST', alice.playerToken)).status,
  409,
);
const recording = (await request(`${path}/hearsay/state`, 'GET', alice.playerToken)).body;
assert.equal(recording.stage, 'recording');
assert.equal(recording.players.find((player) => player.id === alice.playerId).score, 110);
const assignment = recording.assignments[0];
assert.equal(
  (await upload(`${path}/hearsay/assignments/${assignment.id}/audio`, bob.playerToken, 1000))
    .status,
  404,
);
assert.equal(
  (
    await upload(
      `${path}/hearsay/assignments/${assignment.id}/audio`,
      alice.playerToken,
      assignment.durationMs + 600,
    )
  ).status,
  400,
);
assert.equal(
  (
    await upload(
      `${path}/hearsay/assignments/${assignment.id}/audio`,
      alice.playerToken,
      assignment.durationMs,
    )
  ).status,
  201,
);
assert.equal(
  (await request(`${path}/hearsay/state`, 'GET', alice.playerToken)).body.assignments[0].submitted,
  true,
);
assert.equal(
  (await request(`${path}/hearsay/close-recording`, 'POST', room.hostToken)).status,
  200,
);
for (let matchupNumber = 0; matchupNumber < 2; matchupNumber++) {
  const playback = (await request(`${path}/hearsay/state`, 'GET', room.hostToken)).body;
  assert.equal(playback.stage, 'playback');
  assert.equal(playback.matchup.choices.length, 2);
  const [first, second] = playback.matchup.choices;
  assert.equal(
    (
      await fetch(`${root}${path}/hearsay/assignments/${first.assignmentId}/audio`, {
        headers: { authorization: `Bearer ${alice.playerToken}` },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await fetch(`${root}${path}/hearsay/assignments/${first.assignmentId}/audio`, {
        headers: { authorization: `Bearer ${room.hostToken}` },
      })
    ).status,
    200,
  );
  assert.equal((await request(`${path}/hearsay/open-voting`, 'POST', room.hostToken)).status, 200);
  assert.equal(
    (
      await request(`${path}/hearsay/votes`, 'POST', alice.playerToken, {
        assignmentId: second.assignmentId,
      })
    ).status,
    201,
  );
  assert.equal(
    (
      await request(`${path}/hearsay/votes`, 'POST', bob.playerToken, {
        assignmentId: first.assignmentId,
      })
    ).status,
    201,
  );
  assert.equal(
    (
      await request(`${path}/hearsay/likes`, 'POST', alice.playerToken, {
        assignmentId: second.assignmentId,
      })
    ).status,
    201,
  );
  assert.equal((await request(`${path}/hearsay/reveal`, 'POST', room.hostToken)).status, 200);
  assert.equal((await request(`${path}/hearsay/reveal`, 'POST', room.hostToken)).status, 409);
  const video = await request(`${path}/hearsay/advance`, 'POST', room.hostToken);
  assert.equal(video.body.stage, 'video');
  const next = await request(`${path}/hearsay/advance`, 'POST', room.hostToken);
  assert.equal(next.body.stage, matchupNumber === 0 ? 'playback' : 'results');
}
const finished = (await request(`${path}/hearsay/state`, 'GET', room.hostToken)).body;
assert.equal(finished.phase, 'hearsay-results');
assert.equal(
  finished.players.reduce((sum, player) => sum + player.score, 0),
  3350,
);
for (const roundNumber of [2, 3]) {
  const nextRound = await request(`${path}/hearsay/rounds`, 'POST', room.hostToken);
  assert.equal(nextRound.status, 201);
  assert.equal(nextRound.body.roundNumber, roundNumber);
  assert.equal(
    (await request(`${path}/hearsay/intermission/finish`, 'POST', room.hostToken)).status,
    200,
  );
  assert.equal(
    (await request(`${path}/hearsay/close-recording`, 'POST', room.hostToken)).status,
    200,
  );
  let transitions = 0;
  while (true) {
    const state = (await request(`${path}/hearsay/state`, 'GET', room.hostToken)).body;
    if (state.stage === 'results') break;
    assert.ok(++transitions < 20);
    if (state.stage === 'playback') {
      assert.equal(
        (await request(`${path}/hearsay/open-voting`, 'POST', room.hostToken)).status,
        200,
      );
      assert.equal((await request(`${path}/hearsay/reveal`, 'POST', room.hostToken)).status, 200);
    } else {
      assert.ok(['reveal', 'video'].includes(state.stage));
      assert.equal((await request(`${path}/hearsay/advance`, 'POST', room.hostToken)).status, 200);
    }
  }
  assert.equal(
    (await request(`${path}/hearsay/state`, 'GET', room.hostToken)).body.roundNumber,
    roundNumber,
  );
}
assert.equal((await request(`${path}/hearsay/rounds`, 'POST', room.hostToken)).status, 409);
const finalState = (await request(`${path}/hearsay/state`, 'GET', room.hostToken)).body;
assert.equal(finalState.roundNumber, 3);
assert.ok(finalState.soundboard.length >= 10);
assert.ok(finalState.soundboard.some((sound) => sound.blooper));
const replay = await fetch(
  `${root}${path}/hearsay/assignments/${finalState.soundboard[0].assignmentId}/audio`,
  { headers: { authorization: `Bearer ${room.hostToken}` } },
);
assert.equal(replay.status, 200);
assert.equal(
  (await request(`${path}/hearsay/state`, 'GET', alice.playerToken)).body.soundboard.length,
  finalState.soundboard.length,
);
assert.equal((await request(`${path}/hearsay/restart`, 'POST', room.hostToken)).status, 200);
const restarted = (await request(`${path}/hearsay/state`, 'GET', room.hostToken)).body;
assert.equal(restarted.stage, 'lobby');
assert.equal(restarted.roundNumber, 0);
assert.ok(
  restarted.players.every((player) => player.hasAvatar && !player.ready && player.score === 0),
);
assert.equal((await request(`${path}/hearsay`, 'DELETE', room.hostToken)).status, 200);
assert.equal((await request(`${path}/hearsay/state`, 'GET', room.hostToken)).status, 401);
const bigRoom = (await request('', 'POST')).body;
const bigPath = `/${bigRoom.code}`;
const bigPlayers = [];
for (let index = 0; index < 20; index++) {
  const player = (
    await request(`${bigPath}/join`, 'POST', undefined, { name: `Player ${index + 1}` })
  ).body;
  bigPlayers.push(player);
  assert.equal((await upload(`${bigPath}/hearsay/avatar`, player.playerToken, 1200)).status, 201);
  assert.equal(
    (await request(`${bigPath}/ready`, 'POST', player.playerToken, { ready: true })).status,
    200,
  );
}
assert.equal((await request(`${bigPath}/join`, 'POST', undefined, { name: 'Extra' })).status, 409);
assert.equal((await request(`${bigPath}/hearsay/rounds`, 'POST', bigRoom.hostToken)).status, 201);
assert.equal(
  (await request(`${bigPath}/hearsay/intermission/finish`, 'POST', bigRoom.hostToken)).status,
  200,
);
const bigState = (await request(`${bigPath}/hearsay/state`, 'GET', bigRoom.hostToken)).body;
assert.equal(bigState.assignments.length, 20);
assert.deepEqual(
  bigState.plan.scenes.map((scene) => scene.matchups[0].playerIds.length),
  [10, 10],
);
assert.equal(
  (await request(`${bigPath}/hearsay/close-recording`, 'POST', bigRoom.hostToken)).status,
  200,
);
assert.equal(
  (await request(`${bigPath}/hearsay/open-voting`, 'POST', bigRoom.hostToken)).status,
  200,
);
const bigPlayerState = (await request(`${bigPath}/hearsay/state`, 'GET', bigPlayers[0].playerToken))
  .body;
assert.equal(bigPlayerState.matchup.choices.length, 9);
assert.ok(
  bigPlayerState.matchup.choices.every((choice) => choice.playerId !== bigPlayers[0].playerId),
);
console.log('Hear Say three-round API passed from lobby through final results');

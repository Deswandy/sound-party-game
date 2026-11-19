import { Hono, type Context } from 'hono';
import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import { planHearSayRound, rankMatchup, type RoundPlan } from '../shared/hearsay';

type Bindings = { DB: D1Database; BUCKET: R2Bucket };
type AppContext = Context<{ Bindings: Bindings }>;
type Room = {
  id: string;
  code: string;
  phase: string;
  current_round_id: string | null;
  host_secret_hash: string;
  expires_at: number;
};
type Session = { room: Room; host: boolean; playerId: string | null };
type HearSayRound = {
  id: string;
  round_number: number;
  plan_json: string;
  stage: string;
  deadline_at: number;
  current_matchup: number;
};
type Matchup = {
  id: string;
  scene_id: string;
  slot: number;
  sequence: number;
  winner_assignment_id: string | null;
  runner_up_assignment_id: string | null;
};
type Choice = {
  id: string;
  player_id: string;
  display_name: string;
  storage_key: string | null;
  avatar_key: string | null;
};

const api = new Hono<{ Bindings: Bindings }>();
const audioTypes = new Set(['audio/webm', 'audio/mp4', 'audio/ogg']);
const maxAudioBytes = 1024 * 1024;

async function hash(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (part) => part.toString(16).padStart(2, '0')).join('');
}

async function session(c: AppContext): Promise<Session | null> {
  if (!c.env.DB) return null;
  const code = c.req.param('code') ?? '';
  if (!/^[A-Z2-9]{6}$/.test(code)) return null;
  const room = await c.env.DB.prepare(
    'SELECT id, code, phase, current_round_id, host_secret_hash, expires_at FROM rooms WHERE code = ?',
  )
    .bind(code)
    .first<Room>();
  if (!room || room.expires_at <= Date.now() || room.phase === 'ended') return null;
  const token = /^Bearer ([a-f0-9]{64})$/.exec(c.req.header('authorization') ?? '')?.[1];
  if (!token) return null;
  const secretHash = await hash(token);
  if (secretHash === room.host_secret_hash) return { room, host: true, playerId: null };
  const player = await c.env.DB.prepare(
    'SELECT id FROM players WHERE room_id = ? AND session_secret_hash = ? AND active = 1',
  )
    .bind(room.id, secretHash)
    .first<{ id: string }>();
  return player ? { room, host: false, playerId: player.id } : null;
}

async function currentRound(db: D1Database, room: Room) {
  if (!room.current_round_id) return null;
  return db
    .prepare(
      'SELECT id, round_number, plan_json, stage, deadline_at, current_matchup FROM hearsay_rounds WHERE id = ? AND room_id = ?',
    )
    .bind(room.current_round_id, room.id)
    .first<HearSayRound>();
}

async function activeMatchup(db: D1Database, round: HearSayRound) {
  if (round.current_matchup < 0) return null;
  return db
    .prepare(
      `SELECT id, scene_id, slot, sequence, winner_assignment_id, runner_up_assignment_id
     FROM hearsay_matchups WHERE round_id = ? ORDER BY sequence LIMIT 1 OFFSET ?`,
    )
    .bind(round.id, round.current_matchup)
    .first<Matchup>();
}

async function choicesFor(db: D1Database, roundId: string, matchup: Matchup) {
  const rows = await db
    .prepare(
      `SELECT assignments.id, assignments.player_id, players.display_name,
       assignments.storage_key, avatars.storage_key AS avatar_key
     FROM hearsay_assignments AS assignments
       JOIN players ON players.id = assignments.player_id
       LEFT JOIN hearsay_avatars AS avatars ON avatars.player_id = players.id
     WHERE assignments.round_id = ? AND assignments.scene_id = ? AND assignments.slot = ?
     ORDER BY players.joined_at, players.id`,
    )
    .bind(roundId, matchup.scene_id, matchup.slot)
    .all<Choice>();
  return rows.results.filter((row) => row.storage_key || row.avatar_key);
}

function eligibleChoices(choices: Choice[], playerId: string, totalPlayers: number) {
  if (
    choices.length === 2 &&
    totalPlayers > 2 &&
    choices.some((choice) => choice.player_id === playerId)
  ) {
    return [];
  }
  const others = choices.filter((choice) => choice.player_id !== playerId);
  return others.length >= 2 ? others : choices;
}

function recordingTimeMs(plan: RoundPlan) {
  const counts = new Map<string, number>();
  for (const assignment of plan.assignments) {
    counts.set(assignment.playerId, (counts.get(assignment.playerId) ?? 0) + 1);
  }
  const max = Math.max(...counts.values());
  return Math.min(210, 90 + (max - 1) * 30) * 1000;
}

async function readAudio(c: AppContext, maxDurationMs: number) {
  const mimeType = c.req.header('content-type')?.split(';')[0]?.toLowerCase() ?? '';
  const durationMs = Number(c.req.header('x-clip-duration-ms'));
  if (
    !audioTypes.has(mimeType) ||
    !Number.isInteger(durationMs) ||
    durationMs < 1 ||
    durationMs > maxDurationMs + 500
  ) {
    return null;
  }
  const declaredSize = Number(c.req.header('content-length'));
  if (declaredSize > maxAudioBytes) return null;
  const bytes = await c.req.arrayBuffer();
  if (!bytes.byteLength || bytes.byteLength > maxAudioBytes) return null;
  return { mimeType, durationMs, bytes };
}

api.post('/:code/hearsay/avatar', async (c) => {
  const access = await session(c);
  if (!access) return c.json({ error: 'Player access required' }, 401);
  if (access.host || !access.playerId) return c.json({ error: 'Player access required' }, 403);
  if (access.room.phase !== 'lobby') return c.json({ error: 'Lobby sound is closed' }, 409);
  const audio = await readAudio(c, 2000);
  if (!audio) return c.json({ error: 'Record a sound of up to 2 seconds, under 1 MB' }, 400);
  const key = `hearsay/avatar/${access.room.id}/${access.playerId}/${crypto.randomUUID()}`;
  await c.env.BUCKET.put(key, audio.bytes, { httpMetadata: { contentType: audio.mimeType } });
  const previous = await c.env.DB.prepare(
    'SELECT storage_key FROM hearsay_avatars WHERE player_id = ?',
  )
    .bind(access.playerId)
    .first<{ storage_key: string }>();
  await c.env.DB.prepare(
    `INSERT INTO hearsay_avatars (player_id, storage_key, mime_type, submitted_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(player_id) DO UPDATE SET storage_key = excluded.storage_key,
       mime_type = excluded.mime_type, submitted_at = excluded.submitted_at`,
  )
    .bind(access.playerId, key, audio.mimeType, Date.now())
    .run();
  if (previous) await c.env.BUCKET.delete(previous.storage_key);
  return c.json({ ok: true }, 201);
});

api.post('/:code/hearsay/rounds', async (c) => {
  const access = await session(c);
  if (!access) return c.json({ error: 'Room access required' }, 401);
  if (!access.host) return c.json({ error: 'Host access required' }, 403);
  if (!['lobby', 'hearsay-results'].includes(access.room.phase)) {
    return c.json({ error: 'A round is already active' }, 409);
  }
  const players = await c.env.DB.prepare(
    'SELECT id, ready FROM players WHERE room_id = ? AND active = 1 ORDER BY joined_at, id',
  )
    .bind(access.room.id)
    .all<{ id: string; ready: number }>();
  if (players.results.length < 2) return c.json({ error: 'Wait for at least two players' }, 409);
  if (access.room.phase === 'lobby' && players.results.some((player) => !player.ready)) {
    return c.json({ error: 'Wait for every player to be ready' }, 409);
  }
  if (access.room.phase === 'lobby') {
    const avatars = await c.env.DB.prepare(
      `SELECT COUNT(*) AS count FROM hearsay_avatars JOIN players ON players.id = hearsay_avatars.player_id
       WHERE players.room_id = ? AND players.active = 1`,
    )
      .bind(access.room.id)
      .first<{ count: number }>();
    if (avatars?.count !== players.results.length) {
      return c.json({ error: 'Wait for every player to record a lobby sound' }, 409);
    }
  }
  const past = await c.env.DB.prepare(
    'SELECT round_number, plan_json FROM hearsay_rounds WHERE room_id = ? ORDER BY round_number',
  )
    .bind(access.room.id)
    .all<{ round_number: number; plan_json: string }>();
  const roundNumber = past.results.length + 1;
  if (roundNumber > 3) return c.json({ error: 'This game has finished' }, 409);
  const usedVideoIds = new Set<string>();
  for (const item of past.results) {
    const previousPlan = JSON.parse(item.plan_json) as RoundPlan;
    for (const planned of previousPlan.scenes) usedVideoIds.add(planned.scene.videoId);
  }
  const plan = planHearSayRound(
    players.results.map((player) => player.id),
    roundNumber as 1 | 2 | 3,
    usedVideoIds,
  );
  const roundId = crypto.randomUUID();
  const now = Date.now();
  const statements = [
    c.env.DB.prepare(
      `INSERT INTO hearsay_rounds (id, room_id, round_number, plan_json, stage, deadline_at, created_at)
       VALUES (?, ?, ?, ?, 'intermission', ?, ?)`,
    ).bind(roundId, access.room.id, roundNumber, JSON.stringify(plan), now + 15_000, now),
    ...plan.assignments.map((assignment) =>
      c.env.DB.prepare(
        `INSERT INTO hearsay_assignments (id, round_id, player_id, scene_id, slot, duration_ms)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).bind(
        crypto.randomUUID(),
        roundId,
        assignment.playerId,
        assignment.sceneId,
        assignment.slot,
        assignment.durationMs,
      ),
    ),
    ...plan.scenes.flatMap((planned, sceneIndex) =>
      planned.matchups.map((matchup) =>
        c.env.DB.prepare(
          `INSERT INTO hearsay_matchups (id, round_id, scene_id, slot, sequence)
           VALUES (?, ?, ?, ?, ?)`,
        ).bind(
          crypto.randomUUID(),
          roundId,
          planned.scene.id,
          matchup.slot,
          sceneIndex * 3 + matchup.slot,
        ),
      ),
    ),
    ...players.results.map((player) =>
      c.env.DB.prepare(
        'INSERT OR IGNORE INTO hearsay_scores (player_id, score, video_appearances) VALUES (?, 0, 0)',
      ).bind(player.id),
    ),
    c.env.DB.prepare(
      "UPDATE rooms SET phase = 'hearsay', current_round_id = ?, last_active_at = ? WHERE id = ? AND phase IN ('lobby', 'hearsay-results')",
    ).bind(roundId, now, access.room.id),
  ];
  try {
    const result = await c.env.DB.batch(statements);
    if (result.at(-1)?.meta.changes !== 1)
      return c.json({ error: 'A round is already active' }, 409);
  } catch (error) {
    if (String(error).includes('UNIQUE constraint failed')) {
      return c.json({ error: 'A round is already active' }, 409);
    }
    throw error;
  }
  return c.json({ roundId, roundNumber, minigame: ['bop', 'dots', 'jump'][roundNumber - 1] }, 201);
});

api.get('/:code/hearsay/state', async (c) => {
  const access = await session(c);
  if (!access) return c.json({ error: 'Room access required' }, 401);
  const round = await currentRound(c.env.DB, access.room);
  const players = await c.env.DB.prepare(
    `SELECT players.id, players.display_name, players.ready,
       CASE WHEN hearsay_avatars.player_id IS NULL THEN 0 ELSE 1 END AS has_avatar,
       COALESCE(hearsay_scores.score, 0) AS score
     FROM players LEFT JOIN hearsay_avatars ON hearsay_avatars.player_id = players.id
       LEFT JOIN hearsay_scores ON hearsay_scores.player_id = players.id
     WHERE players.room_id = ? AND players.active = 1 ORDER BY players.joined_at, players.id`,
  )
    .bind(access.room.id)
    .all<{ id: string; display_name: string; ready: number; has_avatar: number; score: number }>();
  const assignments = round
    ? await c.env.DB.prepare(
        `SELECT id, player_id, scene_id, slot, duration_ms, submitted_at
         FROM hearsay_assignments WHERE round_id = ? ORDER BY rowid`,
      )
        .bind(round.id)
        .all<{
          id: string;
          player_id: string;
          scene_id: string;
          slot: number;
          duration_ms: number;
          submitted_at: number | null;
        }>()
    : null;
  const plan = round ? (JSON.parse(round.plan_json) as RoundPlan) : null;
  const minigameTallies =
    round && ['intermission', 'intermission-results'].includes(round.stage)
      ? await c.env.DB.prepare(
          'SELECT player_id, tally FROM hearsay_minigame_tallies WHERE round_id = ?',
        )
          .bind(round.id)
          .all<{ player_id: string; tally: number }>()
      : null;
  const matchup = round ? await activeMatchup(c.env.DB, round) : null;
  const choices = round && matchup ? await choicesFor(c.env.DB, round.id, matchup) : [];
  const sceneWinners =
    round && matchup && ['video', 'results'].includes(round.stage)
      ? await c.env.DB.prepare(
          `SELECT slot, winner_assignment_id FROM hearsay_matchups
           WHERE round_id = ? AND scene_id = ? ORDER BY slot`,
        )
          .bind(round.id, matchup.scene_id)
          .all<{ slot: number; winner_assignment_id: string | null }>()
      : null;
  const eligible =
    access.host || !access.playerId
      ? choices
      : eligibleChoices(choices, access.playerId, players.results.length);
  const myVote =
    matchup && access.playerId
      ? await c.env.DB.prepare(
          'SELECT assignment_id FROM hearsay_votes WHERE matchup_id = ? AND player_id = ?',
        )
          .bind(matchup.id, access.playerId)
          .first<{ assignment_id: string }>()
      : null;
  const myLikes =
    matchup && access.playerId
      ? await c.env.DB.prepare(
          'SELECT assignment_id FROM hearsay_likes WHERE matchup_id = ? AND player_id = ?',
        )
          .bind(matchup.id, access.playerId)
          .all<{ assignment_id: string }>()
      : null;
  const visibleAssignments = access.host
    ? (assignments?.results ?? [])
    : (assignments?.results ?? []).filter((assignment) => assignment.player_id === access.playerId);
  const byScene = new Map(plan?.scenes.map(({ scene }) => [scene.id, scene]));
  const soundboard =
    round?.stage === 'results' && round.round_number === 3
      ? await c.env.DB.prepare(
          `SELECT assignments.id, assignments.scene_id, assignments.slot, rounds.round_number,
           players.display_name, CASE WHEN matchups.runner_up_assignment_id = assignments.id
             THEN 1 ELSE 0 END AS blooper, rounds.plan_json
         FROM hearsay_assignments AS assignments
           JOIN hearsay_rounds AS rounds ON rounds.id = assignments.round_id
           JOIN players ON players.id = assignments.player_id
           LEFT JOIN hearsay_matchups AS matchups ON matchups.round_id = rounds.id
             AND matchups.scene_id = assignments.scene_id AND matchups.slot = assignments.slot
         WHERE rounds.room_id = ? ORDER BY rounds.round_number, assignments.rowid`,
        )
          .bind(access.room.id)
          .all<{
            id: string;
            scene_id: string;
            slot: number;
            round_number: number;
            display_name: string;
            blooper: number;
            plan_json: string;
          }>()
      : null;
  return c.json({
    code: access.room.code,
    phase: access.room.phase,
    roundNumber: round?.round_number ?? 0,
    stage: round?.stage ?? 'lobby',
    deadlineAt: round?.deadline_at ?? null,
    minigame: round ? ['bop', 'dots', 'jump'][round.round_number - 1] : null,
    minigameTallies:
      minigameTallies?.results.map((entry) => ({
        playerId: entry.player_id,
        tally: entry.tally,
      })) ?? [],
    currentMatchup: round?.current_matchup ?? -1,
    players: players.results.map((player) => ({
      id: player.id,
      name: player.display_name,
      ready: player.ready === 1,
      hasAvatar: player.has_avatar === 1,
      score: player.score,
    })),
    assignments: visibleAssignments.map((assignment) => {
      const sound = byScene.get(assignment.scene_id)?.slots[assignment.slot];
      return {
        id: assignment.id,
        playerId: assignment.player_id,
        sceneId: assignment.scene_id,
        slot: assignment.slot,
        prompt: sound?.prompt ?? '',
        direction: sound?.direction ?? null,
        durationMs: assignment.duration_ms,
        submitted: assignment.submitted_at !== null,
      };
    }),
    sceneCount: plan?.scenes.length ?? 0,
    plan: access.host ? plan : undefined,
    matchup: matchup
      ? {
          id: matchup.id,
          sceneId: matchup.scene_id,
          slot: matchup.slot,
          prompt: byScene.get(matchup.scene_id)?.slots[matchup.slot]?.prompt ?? '',
          scene: byScene.get(matchup.scene_id) ?? null,
          choices: eligible.map((choice) => ({
            assignmentId: choice.id,
            playerId: choice.player_id,
            name: choice.display_name,
            submitted: Boolean(choice.storage_key),
          })),
          winnerAssignmentId: matchup.winner_assignment_id,
          runnerUpAssignmentId: matchup.runner_up_assignment_id,
          myVoteAssignmentId: myVote?.assignment_id ?? null,
          myLikedAssignmentIds: myLikes?.results.map((like) => like.assignment_id) ?? [],
        }
      : null,
    sceneWinners:
      sceneWinners?.results.map((entry) => ({
        slot: entry.slot,
        assignmentId: entry.winner_assignment_id,
      })) ?? [],
    soundboard:
      soundboard?.results.map((entry) => {
        const recordedPlan = JSON.parse(entry.plan_json) as RoundPlan;
        return {
          assignmentId: entry.id,
          playerName: entry.display_name,
          roundNumber: entry.round_number,
          prompt:
            recordedPlan.scenes.find(({ scene }) => scene.id === entry.scene_id)?.scene.slots[
              entry.slot
            ]?.prompt ?? '',
          blooper: entry.blooper === 1,
          slot: entry.slot,
          scene:
            entry.blooper === 1
              ? (recordedPlan.scenes.find(({ scene }) => scene.id === entry.scene_id)?.scene ??
                null)
              : null,
        };
      }) ?? [],
  });
});

api.post('/:code/hearsay/intermission/tally', async (c) => {
  const access = await session(c);
  if (!access?.playerId || !access.room.current_round_id) {
    return c.json({ error: 'Player access required' }, 401);
  }
  const round = await currentRound(c.env.DB, access.room);
  if (round?.stage !== 'intermission' || round.deadline_at < Date.now()) {
    return c.json({ error: 'Intermission is closed' }, 409);
  }
  const result = await c.env.DB.prepare(
    `INSERT INTO hearsay_minigame_tallies (round_id, player_id, tally, last_tally_at)
     SELECT ?, ?, 1, ? FROM hearsay_rounds WHERE id = ? AND stage = 'intermission' AND deadline_at > ?
     ON CONFLICT(round_id, player_id) DO UPDATE SET
       tally = MIN(tally + 1, 100), last_tally_at = excluded.last_tally_at
     WHERE excluded.last_tally_at - last_tally_at >= 150`,
  )
    .bind(round.id, access.playerId, Date.now(), round.id, Date.now())
    .run();
  if (result.meta.changes !== 1)
    return c.json({ error: 'Tally was too soon or intermission closed' }, 429);
  return c.json({ ok: true });
});

api.post('/:code/hearsay/intermission/finish', async (c) => {
  const access = await session(c);
  if (!access) return c.json({ error: 'Room access required' }, 401);
  if (!access.host) return c.json({ error: 'Host access required' }, 403);
  const round = await currentRound(c.env.DB, access.room);
  if (round?.stage !== 'intermission') return c.json({ error: 'Intermission is not active' }, 409);
  const tallies = await c.env.DB.prepare(
    'SELECT player_id, tally FROM hearsay_minigame_tallies WHERE round_id = ?',
  )
    .bind(round.id)
    .all<{ player_id: string; tally: number }>();
  const maxTally = Math.max(0, ...tallies.results.map((entry) => entry.tally));
  const statements = [
    ...tallies.results.map((entry) =>
      c.env.DB.prepare(
        `UPDATE hearsay_scores SET score = score + ? WHERE player_id = ?
         AND EXISTS (SELECT 1 FROM hearsay_rounds WHERE id = ? AND stage = 'intermission')`,
      ).bind(
        entry.tally * 10 + (maxTally > 0 && entry.tally === maxTally ? 100 : 0),
        entry.player_id,
        round.id,
      ),
    ),
    c.env.DB.prepare(
      "UPDATE hearsay_rounds SET stage = 'intermission-results', deadline_at = 0 WHERE id = ? AND stage = 'intermission'",
    ).bind(round.id),
  ];
  const results = await c.env.DB.batch(statements);
  if (results.at(-1)?.meta.changes !== 1) return c.json({ error: 'Intermission has ended' }, 409);
  return c.json({ ok: true });
});

api.post('/:code/hearsay/intermission/advance', async (c) => {
  const access = await session(c);
  if (!access) return c.json({ error: 'Room access required' }, 401);
  if (!access.host) return c.json({ error: 'Host access required' }, 403);
  const round = await currentRound(c.env.DB, access.room);
  if (round?.stage !== 'intermission-results') {
    return c.json({ error: 'Intermission results are not ready' }, 409);
  }
  const plan = JSON.parse(round.plan_json) as RoundPlan;
  const deadlineAt = Date.now() + recordingTimeMs(plan);
  const result = await c.env.DB.prepare(
    "UPDATE hearsay_rounds SET stage = 'recording', deadline_at = ? WHERE id = ? AND stage = 'intermission-results'",
  )
    .bind(deadlineAt, round.id)
    .run();
  if (result.meta.changes !== 1) return c.json({ error: 'Recording already started' }, 409);
  return c.json({ ok: true, recordingDeadlineAt: deadlineAt });
});

api.post('/:code/hearsay/assignments/:id/audio', async (c) => {
  const access = await session(c);
  if (!access?.playerId) return c.json({ error: 'Player access required' }, 401);
  const round = await currentRound(c.env.DB, access.room);
  if (round?.stage !== 'recording' || round.deadline_at + 5000 < Date.now()) {
    return c.json({ error: 'Recording is closed' }, 409);
  }
  const assignment = await c.env.DB.prepare(
    `SELECT id, duration_ms, storage_key FROM hearsay_assignments
     WHERE id = ? AND round_id = ? AND player_id = ?`,
  )
    .bind(c.req.param('id'), round.id, access.playerId)
    .first<{ id: string; duration_ms: number; storage_key: string | null }>();
  if (!assignment) return c.json({ error: 'Sound slot not found' }, 404);
  const audio = await readAudio(c, assignment.duration_ms);
  if (!audio) return c.json({ error: 'Clip is too long, unsupported, or over 1 MB' }, 400);
  const key = `hearsay/clips/${access.room.id}/${round.id}/${crypto.randomUUID()}`;
  await c.env.BUCKET.put(key, audio.bytes, { httpMetadata: { contentType: audio.mimeType } });
  const result = await c.env.DB.prepare(
    `UPDATE hearsay_assignments SET storage_key = ?, mime_type = ?, submitted_at = ?
     WHERE id = ? AND round_id = ? AND player_id = ?
       AND EXISTS (SELECT 1 FROM hearsay_rounds WHERE id = ? AND stage = 'recording' AND deadline_at + 5000 > ?)`,
  )
    .bind(
      key,
      audio.mimeType,
      Date.now(),
      assignment.id,
      round.id,
      access.playerId,
      round.id,
      Date.now(),
    )
    .run();
  if (result.meta.changes !== 1) {
    await c.env.BUCKET.delete(key);
    return c.json({ error: 'Recording is closed' }, 409);
  }
  if (assignment.storage_key) await c.env.BUCKET.delete(assignment.storage_key);
  return c.json({ ok: true }, 201);
});

api.get('/:code/hearsay/assignments/:id/audio', async (c) => {
  const access = await session(c);
  if (!access) return c.json({ error: 'Room access required' }, 401);
  if (!access.host) return c.json({ error: 'Host access required' }, 403);
  const round = await currentRound(c.env.DB, access.room);
  if (!round || !['playback', 'voting', 'reveal', 'video', 'results'].includes(round.stage)) {
    return c.json({ error: 'Sound is not ready' }, 409);
  }
  const finalSoundboard = round.stage === 'results' && round.round_number === 3;
  const assignment = await c.env.DB.prepare(
    `SELECT COALESCE(assignments.storage_key, avatars.storage_key) AS storage_key,
       COALESCE(assignments.mime_type, avatars.mime_type) AS mime_type
     FROM hearsay_assignments AS assignments
       LEFT JOIN hearsay_avatars AS avatars ON avatars.player_id = assignments.player_id
       JOIN hearsay_rounds AS rounds ON rounds.id = assignments.round_id
     WHERE assignments.id = ? AND rounds.room_id = ? AND (? = 1 OR assignments.round_id = ?)`,
  )
    .bind(c.req.param('id'), access.room.id, finalSoundboard ? 1 : 0, round.id)
    .first<{ storage_key: string | null; mime_type: string | null }>();
  if (!assignment?.storage_key) return c.json({ error: 'Sound not found' }, 404);
  const object = await c.env.BUCKET.get(assignment.storage_key);
  if (!object) return c.json({ error: 'Sound not found' }, 404);
  return new Response(object.body as ReadableStream, {
    headers: { 'Content-Type': assignment.mime_type ?? 'audio/webm', 'Cache-Control': 'no-store' },
  });
});

api.post('/:code/hearsay/close-recording', async (c) => {
  const access = await session(c);
  if (!access) return c.json({ error: 'Room access required' }, 401);
  if (!access.host) return c.json({ error: 'Host access required' }, 403);
  const round = await currentRound(c.env.DB, access.room);
  if (round?.stage !== 'recording') return c.json({ error: 'Recording is not active' }, 409);
  const result = await c.env.DB.prepare(
    "UPDATE hearsay_rounds SET stage = 'playback', current_matchup = 0, deadline_at = 0 WHERE id = ? AND stage = 'recording'",
  )
    .bind(round.id)
    .run();
  if (result.meta.changes !== 1) return c.json({ error: 'Recording is already closed' }, 409);
  return c.json({ ok: true });
});

api.post('/:code/hearsay/open-voting', async (c) => {
  const access = await session(c);
  if (!access) return c.json({ error: 'Room access required' }, 401);
  if (!access.host) return c.json({ error: 'Host access required' }, 403);
  const round = await currentRound(c.env.DB, access.room);
  if (round?.stage !== 'playback') return c.json({ error: 'Playback is not active' }, 409);
  const matchup = await activeMatchup(c.env.DB, round);
  if (!matchup) return c.json({ error: 'Matchup not found' }, 404);
  const choices = await choicesFor(c.env.DB, round.id, matchup);
  if (!choices.length) return c.json({ error: 'No sounds in this matchup' }, 409);
  const seconds =
    choices.length <= 2 ? 15 : choices.length <= 4 ? 25 : choices.length <= 8 ? 45 : 60;
  const deadlineAt = Date.now() + seconds * 1000;
  const result = await c.env.DB.prepare(
    "UPDATE hearsay_rounds SET stage = 'voting', deadline_at = ? WHERE id = ? AND stage = 'playback'",
  )
    .bind(deadlineAt, round.id)
    .run();
  if (result.meta.changes !== 1) return c.json({ error: 'Playback is not active' }, 409);
  return c.json({ ok: true, deadlineAt });
});

api.post('/:code/hearsay/votes', async (c) => {
  const access = await session(c);
  if (!access?.playerId) return c.json({ error: 'Player access required' }, 401);
  const round = await currentRound(c.env.DB, access.room);
  if (round?.stage !== 'voting' || round.deadline_at < Date.now()) {
    return c.json({ error: 'Voting is closed' }, 409);
  }
  const matchup = await activeMatchup(c.env.DB, round);
  if (!matchup) return c.json({ error: 'Matchup not found' }, 404);
  const body = await c.req.json<{ assignmentId?: unknown }>().catch(() => null);
  const players = await c.env.DB.prepare(
    'SELECT COUNT(*) AS count FROM players WHERE room_id = ? AND active = 1',
  )
    .bind(access.room.id)
    .first<{ count: number }>();
  const choices = eligibleChoices(
    await choicesFor(c.env.DB, round.id, matchup),
    access.playerId,
    players?.count ?? 0,
  );
  if (!choices.some((choice) => choice.id === body?.assignmentId)) {
    return c.json({ error: 'This sound is not a voting choice' }, 409);
  }
  try {
    const result = await c.env.DB.prepare(
      `INSERT INTO hearsay_votes (matchup_id, player_id, assignment_id, created_at)
       SELECT ?, ?, ?, ? FROM hearsay_rounds WHERE id = ? AND stage = 'voting' AND deadline_at > ?`,
    )
      .bind(matchup.id, access.playerId, body!.assignmentId, Date.now(), round.id, Date.now())
      .run();
    if (result.meta.changes !== 1) return c.json({ error: 'Voting is closed' }, 409);
  } catch (error) {
    if (String(error).includes('UNIQUE constraint failed'))
      return c.json({ error: 'You already voted' }, 409);
    throw error;
  }
  return c.json({ ok: true }, 201);
});

api.post('/:code/hearsay/likes', async (c) => {
  const access = await session(c);
  if (!access?.playerId) return c.json({ error: 'Player access required' }, 401);
  const round = await currentRound(c.env.DB, access.room);
  if (round?.stage !== 'voting' || round.deadline_at < Date.now()) {
    return c.json({ error: 'Likes are closed' }, 409);
  }
  const matchup = await activeMatchup(c.env.DB, round);
  if (!matchup) return c.json({ error: 'Matchup not found' }, 404);
  const body = await c.req.json<{ assignmentId?: unknown }>().catch(() => null);
  const players = await c.env.DB.prepare(
    'SELECT COUNT(*) AS count FROM players WHERE room_id = ? AND active = 1',
  )
    .bind(access.room.id)
    .first<{ count: number }>();
  const choices = eligibleChoices(
    await choicesFor(c.env.DB, round.id, matchup),
    access.playerId,
    players?.count ?? 0,
  );
  if (!choices.some((choice) => choice.id === body?.assignmentId)) {
    return c.json({ error: 'This sound is not a like choice' }, 409);
  }
  const canLike =
    choices.length === 0 ||
    (await c.env.DB.prepare(
      'SELECT player_id FROM hearsay_votes WHERE matchup_id = ? AND player_id = ?',
    )
      .bind(matchup.id, access.playerId)
      .first());
  if (!canLike) return c.json({ error: 'Vote before liking sounds' }, 409);
  try {
    const result = await c.env.DB.prepare(
      `INSERT INTO hearsay_likes (matchup_id, player_id, assignment_id, created_at)
       SELECT ?, ?, ?, ? FROM hearsay_rounds WHERE id = ? AND stage = 'voting' AND deadline_at > ?`,
    )
      .bind(matchup.id, access.playerId, body!.assignmentId, Date.now(), round.id, Date.now())
      .run();
    if (result.meta.changes !== 1) return c.json({ error: 'Likes are closed' }, 409);
  } catch (error) {
    if (String(error).includes('UNIQUE constraint failed'))
      return c.json({ error: 'Sound already liked' }, 409);
    throw error;
  }
  return c.json({ ok: true }, 201);
});

api.post('/:code/hearsay/reveal', async (c) => {
  const access = await session(c);
  if (!access) return c.json({ error: 'Room access required' }, 401);
  if (!access.host) return c.json({ error: 'Host access required' }, 403);
  const round = await currentRound(c.env.DB, access.room);
  if (round?.stage !== 'voting') return c.json({ error: 'Voting is not active' }, 409);
  const matchup = await activeMatchup(c.env.DB, round);
  if (!matchup) return c.json({ error: 'Matchup not found' }, 404);
  const choices = await choicesFor(c.env.DB, round.id, matchup);
  if (!choices.length) return c.json({ error: 'No sounds in this matchup' }, 409);
  const votes = await c.env.DB.prepare(
    'SELECT assignment_id, COUNT(*) AS count FROM hearsay_votes WHERE matchup_id = ? GROUP BY assignment_id',
  )
    .bind(matchup.id)
    .all<{ assignment_id: string; count: number }>();
  const likes = await c.env.DB.prepare(
    'SELECT assignment_id, COUNT(*) AS count FROM hearsay_likes WHERE matchup_id = ? GROUP BY assignment_id',
  )
    .bind(matchup.id)
    .all<{ assignment_id: string; count: number }>();
  const scores = await c.env.DB.prepare(
    'SELECT player_id, video_appearances FROM hearsay_scores WHERE player_id IN (' +
      choices.map(() => '?').join(',') +
      ')',
  )
    .bind(...choices.map((choice) => choice.player_id))
    .all<{ player_id: string; video_appearances: number }>();
  const voteCounts = new Map(votes.results.map((row) => [row.assignment_id, row.count]));
  const likeCounts = new Map(likes.results.map((row) => [row.assignment_id, row.count]));
  const appearances = new Map(scores.results.map((row) => [row.player_id, row.video_appearances]));
  const ranked = rankMatchup(
    choices.map((choice) => ({
      playerId: choice.player_id,
      votes: voteCounts.get(choice.id) ?? 0,
      likes: likeCounts.get(choice.id) ?? 0,
      priorVideoAppearances: appearances.get(choice.player_id) ?? 0,
    })),
  );
  const winner = choices.find((choice) => choice.player_id === ranked.winner.playerId)!;
  const runnerUp = choices.find(
    (choice) =>
      choice.player_id === ranked.runnerUp?.playerId &&
      (voteCounts.get(choice.id) ?? 0) + (likeCounts.get(choice.id) ?? 0) > 0,
  );
  const statements = [
    c.env.DB.prepare(
      "UPDATE hearsay_rounds SET stage = 'reveal', deadline_at = 0 WHERE id = ? AND stage = 'voting'",
    ).bind(round.id),
    ...choices.map((choice) =>
      c.env.DB.prepare(
        `UPDATE hearsay_scores SET score = score + ?, video_appearances = video_appearances + ?
         WHERE player_id = ? AND EXISTS
           (SELECT 1 FROM hearsay_matchups WHERE id = ? AND winner_assignment_id IS NULL)`,
      ).bind(
        ranked.points.get(choice.player_id) ?? 0,
        choice.id === winner.id ? 1 : 0,
        choice.player_id,
        matchup.id,
      ),
    ),
    c.env.DB.prepare(
      'UPDATE hearsay_matchups SET winner_assignment_id = ?, runner_up_assignment_id = ? WHERE id = ? AND winner_assignment_id IS NULL',
    ).bind(winner.id, runnerUp?.id ?? null, matchup.id),
  ];
  const results = await c.env.DB.batch(statements);
  if (results[0].meta.changes !== 1 || results.at(-1)?.meta.changes !== 1) {
    return c.json({ error: 'Matchup has already been revealed' }, 409);
  }
  return c.json({ winnerAssignmentId: winner.id, runnerUpAssignmentId: runnerUp?.id ?? null });
});

api.post('/:code/hearsay/advance', async (c) => {
  const access = await session(c);
  if (!access) return c.json({ error: 'Room access required' }, 401);
  if (!access.host) return c.json({ error: 'Host access required' }, 403);
  const round = await currentRound(c.env.DB, access.room);
  if (!round || !['reveal', 'video'].includes(round.stage)) {
    return c.json({ error: 'Cannot advance yet' }, 409);
  }
  const matchup = await activeMatchup(c.env.DB, round);
  if (!matchup) return c.json({ error: 'Matchup not found' }, 404);
  const next = await c.env.DB.prepare(
    'SELECT scene_id FROM hearsay_matchups WHERE round_id = ? ORDER BY sequence LIMIT 1 OFFSET ?',
  )
    .bind(round.id, round.current_matchup + 1)
    .first<{ scene_id: string }>();
  if (round.stage === 'reveal') {
    const stage = next?.scene_id === matchup.scene_id ? 'playback' : 'video';
    await c.env.DB.prepare(
      "UPDATE hearsay_rounds SET stage = ?, current_matchup = current_matchup + ? WHERE id = ? AND stage = 'reveal'",
    )
      .bind(stage, stage === 'playback' ? 1 : 0, round.id)
      .run();
    return c.json({ stage });
  }
  if (next) {
    await c.env.DB.prepare(
      "UPDATE hearsay_rounds SET stage = 'playback', current_matchup = current_matchup + 1 WHERE id = ? AND stage = 'video'",
    )
      .bind(round.id)
      .run();
    return c.json({ stage: 'playback' });
  }
  await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE hearsay_rounds SET stage = 'results' WHERE id = ? AND stage = 'video'",
    ).bind(round.id),
    c.env.DB.prepare(
      "UPDATE rooms SET phase = 'hearsay-results' WHERE id = ? AND phase = 'hearsay'",
    ).bind(access.room.id),
  ]);
  return c.json({ stage: 'results' });
});

async function clearHearSayData(
  db: D1Database,
  bucket: R2Bucket,
  roomId: string,
  avatars: boolean,
) {
  const clips = await db
    .prepare(
      `SELECT assignments.storage_key FROM hearsay_assignments AS assignments
     JOIN hearsay_rounds AS rounds ON rounds.id = assignments.round_id
     WHERE rounds.room_id = ? AND assignments.storage_key IS NOT NULL`,
    )
    .bind(roomId)
    .all<{ storage_key: string }>();
  const avatarClips = avatars
    ? await db
        .prepare(
          `SELECT avatars.storage_key FROM hearsay_avatars AS avatars
         JOIN players ON players.id = avatars.player_id WHERE players.room_id = ?`,
        )
        .bind(roomId)
        .all<{ storage_key: string }>()
    : null;
  const keys = [...clips.results, ...(avatarClips?.results ?? [])].map((row) => row.storage_key);
  const roundIds = 'SELECT id FROM hearsay_rounds WHERE room_id = ?';
  const matchupIds = `SELECT id FROM hearsay_matchups WHERE round_id IN (${roundIds})`;
  const statements = [
    db.prepare(`DELETE FROM hearsay_likes WHERE matchup_id IN (${matchupIds})`).bind(roomId),
    db.prepare(`DELETE FROM hearsay_votes WHERE matchup_id IN (${matchupIds})`).bind(roomId),
    db.prepare(`DELETE FROM hearsay_matchups WHERE round_id IN (${roundIds})`).bind(roomId),
    db.prepare(`DELETE FROM hearsay_assignments WHERE round_id IN (${roundIds})`).bind(roomId),
    db.prepare(`DELETE FROM hearsay_minigame_tallies WHERE round_id IN (${roundIds})`).bind(roomId),
    db.prepare('DELETE FROM hearsay_rounds WHERE room_id = ?').bind(roomId),
    db
      .prepare(
        'DELETE FROM hearsay_scores WHERE player_id IN (SELECT id FROM players WHERE room_id = ?)',
      )
      .bind(roomId),
  ];
  if (avatars) {
    statements.push(
      db
        .prepare(
          'DELETE FROM hearsay_avatars WHERE player_id IN (SELECT id FROM players WHERE room_id = ?)',
        )
        .bind(roomId),
    );
  }
  await db.batch(statements);
  if (keys.length) await bucket.delete(keys);
}

api.post('/:code/hearsay/restart', async (c) => {
  const access = await session(c);
  if (!access) return c.json({ error: 'Room access required' }, 401);
  if (!access.host) return c.json({ error: 'Host access required' }, 403);
  const round = await currentRound(c.env.DB, access.room);
  if (round?.stage !== 'results' || round.round_number !== 3) {
    return c.json({ error: 'Finish the game before restarting' }, 409);
  }
  await clearHearSayData(c.env.DB, c.env.BUCKET, access.room.id, false);
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE players SET ready = 0 WHERE room_id = ?').bind(access.room.id),
    c.env.DB.prepare(
      "UPDATE rooms SET phase = 'lobby', current_round_id = NULL, last_active_at = ? WHERE id = ?",
    ).bind(Date.now(), access.room.id),
  ]);
  return c.json({ ok: true });
});

api.delete('/:code/hearsay', async (c) => {
  const access = await session(c);
  if (!access) return c.json({ error: 'Room access required' }, 401);
  if (!access.host) return c.json({ error: 'Host access required' }, 403);
  await clearHearSayData(c.env.DB, c.env.BUCKET, access.room.id, true);
  await c.env.DB.prepare("UPDATE rooms SET phase = 'ended' WHERE id = ?")
    .bind(access.room.id)
    .run();
  return c.json({ ok: true });
});

export default api;

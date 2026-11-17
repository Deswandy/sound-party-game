import { Hono } from 'hono';
import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import type {
  CreateRoomResponse,
  HealthResponse,
  JoinRoomResponse,
  LobbyPlayer,
  LobbyState,
  GamePhase,
  RoundClip,
  RoundResult,
  ScoreEntry,
} from '../shared/game';

type Bindings = {
  DB: D1Database;
  BUCKET: R2Bucket;
};

const app = new Hono<{ Bindings: Bindings }>();
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const roomDurationMs = 2 * 60 * 60 * 1000;
const maxClipMs = 30_000;
const maxClipBytes = 4 * 1024 * 1024;
const audioTypes = new Set(['audio/webm', 'audio/mp4', 'audio/ogg']);

type Room = {
  id: string;
  code: string;
  host_secret_hash: string;
  phase: string;
  max_players: number;
  expires_at: number;
  current_round_id: string | null;
};

function token() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (n) =>
    n.toString(16).padStart(2, '0'),
  ).join('');
}

function roomCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (n) => alphabet[n % alphabet.length]).join('');
}

async function hash(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (n) => n.toString(16).padStart(2, '0')).join('');
}

function bearer(header: string | undefined) {
  const match = /^Bearer ([a-f0-9]{64})$/.exec(header ?? '');
  return match?.[1] ?? null;
}

async function getRoom(db: D1Database, code: string) {
  if (!/^[A-Z2-9]{6}$/.test(code)) return null;
  return db
    .prepare(
      'SELECT id, code, host_secret_hash, phase, max_players, expires_at, current_round_id FROM rooms WHERE code = ?',
    )
    .bind(code)
    .first<Room>();
}

function roomError(room: Room | null) {
  if (!room || room.expires_at <= Date.now() || room.phase === 'ended') {
    return 'Room not found or expired';
  }
  return null;
}

async function hostAuthorized(room: Room, header: string | undefined) {
  const secret = bearer(header);
  return secret ? (await hash(secret)) === room.host_secret_hash : false;
}

app.get('/api/health', (c) =>
  c.json<HealthResponse>({ status: 'ok', service: 'sound-party-game' }),
);

app.post('/api/rooms', async (c) => {
  if (!c.env.DB) return c.json({ error: 'Game storage is unavailable' }, 503);
  const hostToken = token();
  const now = Date.now();
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = roomCode();
    try {
      await c.env.DB.prepare(
        'INSERT INTO rooms (id, code, host_secret_hash, phase, max_players, created_at, last_active_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
        .bind(
          crypto.randomUUID(),
          code,
          await hash(hostToken),
          'lobby',
          20,
          now,
          now,
          now + roomDurationMs,
        )
        .run();
      return c.json<CreateRoomResponse>({ code, hostToken }, 201);
    } catch (error) {
      if (!String(error).includes('UNIQUE constraint failed: rooms.code')) throw error;
    }
  }
  return c.json({ error: 'Could not create a room. Try again.' }, 503);
});

app.post('/api/rooms/:code/join', async (c) => {
  if (!c.env.DB) return c.json({ error: 'Game storage is unavailable' }, 503);
  const room = await getRoom(c.env.DB, c.req.param('code'));
  const unavailable = roomError(room);
  if (unavailable) return c.json({ error: unavailable }, 404);
  if (room!.phase !== 'lobby') return c.json({ error: 'This game has already started' }, 409);

  const body = await c.req.json<{ name?: unknown; playerToken?: unknown }>().catch(() => null);
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (name.length < 1 || name.length > 24 || /[\x00-\x1f\x7f]/.test(name)) {
    return c.json({ error: 'Enter a name between 1 and 24 characters' }, 400);
  }

  const previousToken = typeof body?.playerToken === 'string' ? body.playerToken : '';
  if (/^[a-f0-9]{64}$/.test(previousToken)) {
    const previous = await c.env.DB.prepare(
      'SELECT id FROM players WHERE room_id = ? AND session_secret_hash = ? AND active = 1',
    )
      .bind(room!.id, await hash(previousToken))
      .first<{ id: string }>();
    if (previous) {
      await c.env.DB.prepare('UPDATE players SET display_name = ?, last_seen_at = ? WHERE id = ?')
        .bind(name, Date.now(), previous.id)
        .run();
      return c.json<JoinRoomResponse>({ playerId: previous.id, playerToken: previousToken });
    }
  }

  const playerToken = token();
  const playerId = crypto.randomUUID();
  const now = Date.now();
  const result = await c.env.DB.prepare(
    `INSERT INTO players (id, room_id, session_secret_hash, display_name, joined_at, last_seen_at, active)
     SELECT ?, id, ?, ?, ?, ?, 1 FROM rooms
     WHERE id = ? AND phase = 'lobby' AND expires_at > ?
       AND (SELECT COUNT(*) FROM players WHERE room_id = ? AND active = 1) < max_players`,
  )
    .bind(playerId, await hash(playerToken), name, now, now, room!.id, now, room!.id)
    .run();
  if (result.meta.changes !== 1) return c.json({ error: 'Room is full or unavailable' }, 409);
  return c.json<JoinRoomResponse>({ playerId, playerToken }, 201);
});

app.get('/api/rooms/:code/state', async (c) => {
  if (!c.env.DB) return c.json({ error: 'Game storage is unavailable' }, 503);
  const room = await getRoom(c.env.DB, c.req.param('code'));
  const unavailable = roomError(room);
  if (unavailable) return c.json({ error: unavailable }, 404);
  const secret = bearer(c.req.header('authorization'));
  if (!secret) return c.json({ error: 'Room access required' }, 401);
  const isHost = await hostAuthorized(room!, c.req.header('authorization'));
  let playerId: string | null = null;
  if (!isHost) {
    const player = await c.env.DB.prepare(
      'SELECT id FROM players WHERE room_id = ? AND session_secret_hash = ? AND active = 1',
    )
      .bind(room!.id, await hash(secret))
      .first<{ id: string }>();
    if (!player) return c.json({ error: 'Room access required' }, 401);
    playerId = player.id;
  }
  const rows = await c.env.DB.prepare(
    'SELECT id, display_name, ready FROM players WHERE room_id = ? AND active = 1 ORDER BY joined_at, id',
  )
    .bind(room!.id)
    .all<{ id: string; display_name: string; ready: number }>();
  const players: LobbyPlayer[] = rows.results.map((row) => ({
    id: row.id,
    name: row.display_name,
    ready: row.ready === 1,
  }));
  const round = room!.current_round_id
    ? await c.env.DB.prepare(
        'SELECT prompt, playback_index FROM rounds WHERE id = ? AND room_id = ?',
      )
        .bind(room!.current_round_id, room!.id)
        .first<{ prompt: string; playback_index: number }>()
    : null;
  const submitted = room!.current_round_id
    ? await c.env.DB.prepare(
        `SELECT COUNT(*) AS count FROM clips JOIN players ON players.id = clips.player_id
         WHERE clips.round_id = ? AND clips.status = 'submitted' AND players.active = 1`,
      )
        .bind(room!.current_round_id)
        .first<{ count: number }>()
    : null;
  const mine =
    room!.current_round_id && playerId
      ? await c.env.DB.prepare(
          "SELECT id FROM clips WHERE round_id = ? AND player_id = ? AND status = 'submitted'",
        )
          .bind(room!.current_round_id, playerId)
          .first<{ id: string }>()
      : null;
  const roundCount = await c.env.DB.prepare(
    'SELECT COUNT(*) AS count FROM rounds WHERE room_id = ?',
  )
    .bind(room!.id)
    .first<{ count: number }>();
  const clipRows =
    room!.current_round_id && ['playback', 'voting', 'results'].includes(room!.phase)
      ? await c.env.DB.prepare(
          "SELECT id, player_id, storage_key FROM clips WHERE round_id = ? AND status = 'submitted' ORDER BY submitted_at, id",
        )
          .bind(room!.current_round_id)
          .all<{ id: string; player_id: string; storage_key: string }>()
      : null;
  const clips: RoundClip[] = (clipRows?.results ?? []).map((clip, index) => ({
    id: clip.id,
    number: index + 1,
  }));
  const voteRows =
    room!.current_round_id && ['voting', 'results'].includes(room!.phase)
      ? await c.env.DB.prepare('SELECT player_id, clip_id FROM votes WHERE round_id = ?')
          .bind(room!.current_round_id)
          .all<{ player_id: string; clip_id: string }>()
      : null;
  const counts = new Map<string, number>();
  for (const vote of voteRows?.results ?? [])
    counts.set(vote.clip_id, (counts.get(vote.clip_id) ?? 0) + 1);
  const nameById = new Map(players.map((player) => [player.id, player.name]));
  const results: RoundResult[] =
    room!.phase === 'results'
      ? (clipRows?.results ?? [])
          .map((clip, index) => ({
            id: clip.id,
            number: index + 1,
            playerId: clip.player_id,
            name: nameById.get(clip.player_id) ?? 'Former player',
            votes: counts.get(clip.id) ?? 0,
          }))
          .sort((a, b) => b.votes - a.votes || a.number - b.number)
      : [];
  const scoreRows =
    room!.phase === 'results'
      ? await c.env.DB.prepare(
          `SELECT players.id, players.display_name, COUNT(votes.clip_id) AS votes
         FROM players LEFT JOIN clips ON clips.player_id = players.id
         LEFT JOIN votes ON votes.clip_id = clips.id
         WHERE players.room_id = ? GROUP BY players.id ORDER BY votes DESC, players.joined_at`,
        )
          .bind(room!.id)
          .all<{ id: string; display_name: string; votes: number }>()
      : null;
  const scores: ScoreEntry[] = (scoreRows?.results ?? []).map((row) => ({
    playerId: row.id,
    name: row.display_name,
    votes: row.votes,
  }));
  return c.json<LobbyState>({
    code: room!.code,
    phase: room!.phase as GamePhase,
    players,
    maxPlayers: room!.max_players,
    expiresAt: room!.expires_at,
    roundId: room!.current_round_id,
    prompt: round?.prompt ?? null,
    submissionCount: submitted?.count ?? 0,
    mySubmitted: Boolean(mine),
    roundNumber: roundCount?.count ?? 0,
    playbackIndex: round?.playback_index ?? -1,
    clips,
    myClipId: clipRows?.results.find((clip) => clip.player_id === playerId)?.id ?? null,
    myVoteClipId: voteRows?.results.find((vote) => vote.player_id === playerId)?.clip_id ?? null,
    voteCount: voteRows?.results.length ?? 0,
    results,
    scores,
  });
});

app.post('/api/rooms/:code/ready', async (c) => {
  if (!c.env.DB) return c.json({ error: 'Game storage is unavailable' }, 503);
  const room = await getRoom(c.env.DB, c.req.param('code'));
  if (roomError(room)) return c.json({ error: 'Room not found or expired' }, 404);
  if (room!.phase !== 'lobby') return c.json({ error: 'The round has started' }, 409);
  const secret = bearer(c.req.header('authorization'));
  if (!secret) return c.json({ error: 'Player access required' }, 401);
  const body = await c.req.json<{ ready?: unknown }>().catch(() => null);
  if (typeof body?.ready !== 'boolean')
    return c.json({ error: 'Ready must be true or false' }, 400);
  const result = await c.env.DB.prepare(
    'UPDATE players SET ready = ? WHERE room_id = ? AND session_secret_hash = ? AND active = 1',
  )
    .bind(body.ready ? 1 : 0, room!.id, await hash(secret))
    .run();
  if (result.meta.changes !== 1) return c.json({ error: 'Player access required' }, 401);
  return c.json({ ok: true });
});

app.post('/api/rooms/:code/rounds', async (c) => {
  if (!c.env.DB) return c.json({ error: 'Game storage is unavailable' }, 503);
  const room = await getRoom(c.env.DB, c.req.param('code'));
  if (roomError(room)) return c.json({ error: 'Room not found or expired' }, 404);
  if (!(await hostAuthorized(room!, c.req.header('authorization')))) {
    return c.json({ error: 'Host access required' }, 403);
  }
  if (!['lobby', 'results'].includes(room!.phase))
    return c.json({ error: 'Round already started' }, 409);
  const body = await c.req.json<{ prompt?: unknown }>().catch(() => null);
  const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';
  if (prompt.length < 3 || prompt.length > 160 || /[\x00-\x1f\x7f]/.test(prompt)) {
    return c.json({ error: 'Enter a prompt between 3 and 160 characters' }, 400);
  }
  const playerCount = await c.env.DB.prepare(
    'SELECT COUNT(*) AS count FROM players WHERE room_id = ? AND active = 1',
  )
    .bind(room!.id)
    .first<{ count: number }>();
  if (!playerCount?.count) return c.json({ error: 'Wait for a player to join' }, 409);
  const played = await c.env.DB.prepare('SELECT COUNT(*) AS count FROM rounds WHERE room_id = ?')
    .bind(room!.id)
    .first<{ count: number }>();
  if ((played?.count ?? 0) >= 3) return c.json({ error: 'This game has finished' }, 409);
  const roundId = crypto.randomUUID();
  const now = Date.now();
  const results = await c.env.DB.batch([
    c.env.DB.prepare(
      'INSERT INTO rounds (id, room_id, prompt, created_at) VALUES (?, ?, ?, ?)',
    ).bind(roundId, room!.id, prompt, now),
    c.env.DB.prepare(
      "UPDATE rooms SET phase = 'recording', current_round_id = ?, last_active_at = ? WHERE id = ? AND phase IN ('lobby', 'results')",
    ).bind(roundId, now, room!.id),
  ]);
  if (results[1].meta.changes !== 1) return c.json({ error: 'Round already started' }, 409);
  return c.json({ roundId, prompt }, 201);
});

app.post('/api/rooms/:code/clips', async (c) => {
  if (!c.env.DB || !c.env.BUCKET) return c.json({ error: 'Clip storage is unavailable' }, 503);
  const room = await getRoom(c.env.DB, c.req.param('code'));
  if (roomError(room)) return c.json({ error: 'Room not found or expired' }, 404);
  if (room!.phase !== 'recording' || !room!.current_round_id) {
    return c.json({ error: 'Recording is closed' }, 409);
  }
  const secret = bearer(c.req.header('authorization'));
  if (!secret) return c.json({ error: 'Player access required' }, 401);
  const player = await c.env.DB.prepare(
    'SELECT id FROM players WHERE room_id = ? AND session_secret_hash = ? AND active = 1',
  )
    .bind(room!.id, await hash(secret))
    .first<{ id: string }>();
  if (!player) return c.json({ error: 'Player access required' }, 401);
  const mime = c.req.header('content-type')?.split(';')[0]?.toLowerCase() ?? '';
  const duration = Number(c.req.header('x-clip-duration-ms'));
  if (
    !audioTypes.has(mime) ||
    !Number.isInteger(duration) ||
    duration < 1 ||
    duration > maxClipMs
  ) {
    return c.json({ error: 'Use a supported audio clip of up to 30 seconds' }, 400);
  }
  const length = Number(c.req.header('content-length'));
  if (length > maxClipBytes) return c.json({ error: 'Clip is too large' }, 413);
  const bytes = await c.req.arrayBuffer();
  if (!bytes.byteLength || bytes.byteLength > maxClipBytes) {
    return c.json({ error: 'Clip must be under 4 MB' }, 413);
  }
  const latestRoom = await getRoom(c.env.DB, room!.code);
  if (latestRoom?.phase !== 'recording' || latestRoom.current_round_id !== room!.current_round_id) {
    return c.json({ error: 'Recording is closed' }, 409);
  }
  const previous = await c.env.DB.prepare(
    'SELECT storage_key FROM clips WHERE round_id = ? AND player_id = ?',
  )
    .bind(room!.current_round_id, player.id)
    .first<{ storage_key: string }>();
  const key = `clips/${room!.id}/${room!.current_round_id}/${crypto.randomUUID()}`;
  await c.env.BUCKET.put(key, bytes, { httpMetadata: { contentType: mime } });
  const now = Date.now();
  let result;
  try {
    result = await c.env.DB.prepare(
      `INSERT INTO clips (id, round_id, player_id, storage_key, mime_type, duration_ms, submitted_at, status)
     SELECT ?, ?, ?, ?, ?, ?, ?, 'submitted' FROM rooms
     WHERE id = ? AND phase = 'recording' AND current_round_id = ?
     ON CONFLICT(round_id, player_id) DO UPDATE SET storage_key = excluded.storage_key,
       mime_type = excluded.mime_type,
       duration_ms = excluded.duration_ms, submitted_at = excluded.submitted_at, status = 'submitted'`,
    )
      .bind(
        crypto.randomUUID(),
        room!.current_round_id,
        player.id,
        key,
        mime,
        duration,
        now,
        room!.id,
        room!.current_round_id,
      )
      .run();
  } catch (error) {
    await c.env.BUCKET.delete(key);
    throw error;
  }
  if (result.meta.changes !== 1) {
    await c.env.BUCKET.delete(key);
    return c.json({ error: 'Recording is closed' }, 409);
  }
  if (previous?.storage_key) await c.env.BUCKET.delete(previous.storage_key);
  return c.json({ ok: true }, 201);
});

app.post('/api/rooms/:code/close-recording', async (c) => {
  if (!c.env.DB) return c.json({ error: 'Game storage is unavailable' }, 503);
  const room = await getRoom(c.env.DB, c.req.param('code'));
  if (roomError(room)) return c.json({ error: 'Room not found or expired' }, 404);
  if (!(await hostAuthorized(room!, c.req.header('authorization')))) {
    return c.json({ error: 'Host access required' }, 403);
  }
  if (room!.phase !== 'recording' || !room!.current_round_id) {
    return c.json({ error: 'Recording is already closed' }, 409);
  }
  const submitted = await c.env.DB.prepare(
    "SELECT COUNT(*) AS count FROM clips WHERE round_id = ? AND status = 'submitted'",
  )
    .bind(room!.current_round_id)
    .first<{ count: number }>();
  if (!submitted?.count) return c.json({ error: 'Wait for at least one clip' }, 409);
  const result = await c.env.DB.prepare(
    "UPDATE rooms SET phase = 'playback', last_active_at = ? WHERE id = ? AND phase = 'recording'",
  )
    .bind(Date.now(), room!.id)
    .run();
  if (result.meta.changes !== 1) return c.json({ error: 'Recording is already closed' }, 409);
  return c.json({ ok: true });
});

app.get('/api/rooms/:code/clips/:id/audio', async (c) => {
  if (!c.env.DB || !c.env.BUCKET) return c.json({ error: 'Clip storage is unavailable' }, 503);
  const room = await getRoom(c.env.DB, c.req.param('code'));
  if (roomError(room)) return c.json({ error: 'Room not found or expired' }, 404);
  if (!(await hostAuthorized(room!, c.req.header('authorization')))) {
    return c.json({ error: 'Host access required' }, 403);
  }
  if (!['playback', 'voting', 'results'].includes(room!.phase)) {
    return c.json({ error: 'Clips are not ready' }, 409);
  }
  const clip = await c.env.DB.prepare(
    "SELECT storage_key, mime_type FROM clips WHERE id = ? AND round_id = ? AND status = 'submitted'",
  )
    .bind(c.req.param('id'), room!.current_round_id)
    .first<{ storage_key: string; mime_type: string }>();
  if (!clip) return c.json({ error: 'Clip not found' }, 404);
  const object = await c.env.BUCKET.get(clip.storage_key);
  if (!object) return c.json({ error: 'Clip not found' }, 404);
  return new Response(object.body as ReadableStream, {
    headers: { 'Content-Type': clip.mime_type, 'Cache-Control': 'no-store' },
  });
});

app.post('/api/rooms/:code/playback/select', async (c) => {
  if (!c.env.DB) return c.json({ error: 'Game storage is unavailable' }, 503);
  const room = await getRoom(c.env.DB, c.req.param('code'));
  if (roomError(room)) return c.json({ error: 'Room not found or expired' }, 404);
  if (!(await hostAuthorized(room!, c.req.header('authorization')))) {
    return c.json({ error: 'Host access required' }, 403);
  }
  if (room!.phase !== 'playback' || !room!.current_round_id) {
    return c.json({ error: 'Playback is not active' }, 409);
  }
  const body = await c.req.json<{ clipId?: unknown }>().catch(() => null);
  const clips = await c.env.DB.prepare(
    "SELECT id FROM clips WHERE round_id = ? AND status = 'submitted' ORDER BY submitted_at, id",
  )
    .bind(room!.current_round_id)
    .all<{ id: string }>();
  const index = clips.results.findIndex((clip) => clip.id === body?.clipId);
  if (index < 0) return c.json({ error: 'Clip not found' }, 404);
  const round = await c.env.DB.prepare('SELECT playback_index FROM rounds WHERE id = ?')
    .bind(room!.current_round_id)
    .first<{ playback_index: number }>();
  if (index > (round?.playback_index ?? -1) + 1) {
    return c.json({ error: 'Play the clips in order' }, 409);
  }
  await c.env.DB.prepare('UPDATE rounds SET playback_index = ? WHERE id = ?')
    .bind(index, room!.current_round_id)
    .run();
  return c.json({ playbackIndex: index });
});

app.post('/api/rooms/:code/open-voting', async (c) => {
  if (!c.env.DB) return c.json({ error: 'Game storage is unavailable' }, 503);
  const room = await getRoom(c.env.DB, c.req.param('code'));
  if (roomError(room)) return c.json({ error: 'Room not found or expired' }, 404);
  if (!(await hostAuthorized(room!, c.req.header('authorization')))) {
    return c.json({ error: 'Host access required' }, 403);
  }
  if (room!.phase !== 'playback' || !room!.current_round_id) {
    return c.json({ error: 'Playback is not active' }, 409);
  }
  const count = await c.env.DB.prepare(
    "SELECT COUNT(*) AS count FROM clips WHERE round_id = ? AND status = 'submitted'",
  )
    .bind(room!.current_round_id)
    .first<{ count: number }>();
  const round = await c.env.DB.prepare('SELECT playback_index FROM rounds WHERE id = ?')
    .bind(room!.current_round_id)
    .first<{ playback_index: number }>();
  if (!count?.count || (round?.playback_index ?? -1) < count.count - 1) {
    return c.json({ error: 'Select every clip before voting' }, 409);
  }
  await c.env.DB.prepare("UPDATE rooms SET phase = 'voting' WHERE id = ? AND phase = 'playback'")
    .bind(room!.id)
    .run();
  return c.json({ ok: true });
});

app.post('/api/rooms/:code/votes', async (c) => {
  if (!c.env.DB) return c.json({ error: 'Game storage is unavailable' }, 503);
  const room = await getRoom(c.env.DB, c.req.param('code'));
  if (roomError(room)) return c.json({ error: 'Room not found or expired' }, 404);
  if (room!.phase !== 'voting' || !room!.current_round_id) {
    return c.json({ error: 'Voting is closed' }, 409);
  }
  const secret = bearer(c.req.header('authorization'));
  if (!secret) return c.json({ error: 'Player access required' }, 401);
  const player = await c.env.DB.prepare(
    'SELECT id FROM players WHERE room_id = ? AND session_secret_hash = ? AND active = 1',
  )
    .bind(room!.id, await hash(secret))
    .first<{ id: string }>();
  if (!player) return c.json({ error: 'Player access required' }, 401);
  const body = await c.req.json<{ clipId?: unknown }>().catch(() => null);
  const clip =
    typeof body?.clipId === 'string'
      ? await c.env.DB.prepare(
          "SELECT player_id FROM clips WHERE id = ? AND round_id = ? AND status = 'submitted'",
        )
          .bind(body.clipId, room!.current_round_id)
          .first<{ player_id: string }>()
      : null;
  if (!clip) return c.json({ error: 'Clip not found' }, 404);
  if (clip.player_id === player.id)
    return c.json({ error: 'You cannot vote for your own clip' }, 409);
  let result;
  try {
    result = await c.env.DB.prepare(
      `INSERT INTO votes (round_id, player_id, clip_id, created_at)
       SELECT ?, ?, ?, ? FROM rooms WHERE id = ? AND phase = 'voting' AND current_round_id = ?`,
    )
      .bind(
        room!.current_round_id,
        player.id,
        body!.clipId,
        Date.now(),
        room!.id,
        room!.current_round_id,
      )
      .run();
  } catch (error) {
    if (String(error).includes('UNIQUE constraint failed'))
      return c.json({ error: 'You already voted' }, 409);
    throw error;
  }
  if (result.meta.changes !== 1) return c.json({ error: 'Voting is closed' }, 409);
  return c.json({ ok: true }, 201);
});

app.post('/api/rooms/:code/reveal', async (c) => {
  if (!c.env.DB) return c.json({ error: 'Game storage is unavailable' }, 503);
  const room = await getRoom(c.env.DB, c.req.param('code'));
  if (roomError(room)) return c.json({ error: 'Room not found or expired' }, 404);
  if (!(await hostAuthorized(room!, c.req.header('authorization')))) {
    return c.json({ error: 'Host access required' }, 403);
  }
  if (room!.phase !== 'voting' || !room!.current_round_id) {
    return c.json({ error: 'Voting is not active' }, 409);
  }
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE rooms SET phase = 'results' WHERE id = ? AND phase = 'voting'").bind(
      room!.id,
    ),
    c.env.DB.prepare('UPDATE rounds SET ended_at = ? WHERE id = ?').bind(
      Date.now(),
      room!.current_round_id,
    ),
  ]);
  return c.json({ ok: true });
});

app.post('/api/rooms/:code/restart', async (c) => {
  if (!c.env.DB || !c.env.BUCKET) return c.json({ error: 'Game storage is unavailable' }, 503);
  const room = await getRoom(c.env.DB, c.req.param('code'));
  if (roomError(room)) return c.json({ error: 'Room not found or expired' }, 404);
  if (!(await hostAuthorized(room!, c.req.header('authorization')))) {
    return c.json({ error: 'Host access required' }, 403);
  }
  if (room!.phase !== 'results') return c.json({ error: 'Finish the round first' }, 409);
  const clipRows = await c.env.DB.prepare(
    'SELECT clips.storage_key FROM clips JOIN rounds ON rounds.id = clips.round_id WHERE rounds.room_id = ?',
  )
    .bind(room!.id)
    .all<{ storage_key: string }>();
  if (clipRows.results.length)
    await c.env.BUCKET.delete(clipRows.results.map((clip) => clip.storage_key));
  await c.env.DB.batch([
    c.env.DB.prepare(
      'DELETE FROM votes WHERE round_id IN (SELECT id FROM rounds WHERE room_id = ?)',
    ).bind(room!.id),
    c.env.DB.prepare(
      'DELETE FROM clips WHERE round_id IN (SELECT id FROM rounds WHERE room_id = ?)',
    ).bind(room!.id),
    c.env.DB.prepare('DELETE FROM rounds WHERE room_id = ?').bind(room!.id),
    c.env.DB.prepare('UPDATE players SET ready = 0 WHERE room_id = ?').bind(room!.id),
    c.env.DB.prepare(
      "UPDATE rooms SET phase = 'lobby', current_round_id = NULL, last_active_at = ? WHERE id = ?",
    ).bind(Date.now(), room!.id),
  ]);
  return c.json({ ok: true });
});

app.post('/api/rooms/:code/next-round', async (c) => {
  if (!c.env.DB) return c.json({ error: 'Game storage is unavailable' }, 503);
  const room = await getRoom(c.env.DB, c.req.param('code'));
  if (roomError(room)) return c.json({ error: 'Room not found or expired' }, 404);
  if (!(await hostAuthorized(room!, c.req.header('authorization')))) {
    return c.json({ error: 'Host access required' }, 403);
  }
  if (room!.phase !== 'results') return c.json({ error: 'Finish the round first' }, 409);
  const played = await c.env.DB.prepare('SELECT COUNT(*) AS count FROM rounds WHERE room_id = ?')
    .bind(room!.id)
    .first<{ count: number }>();
  if ((played?.count ?? 0) >= 3) return c.json({ error: 'The game is finished' }, 409);
  await c.env.DB.prepare(
    "UPDATE rooms SET phase = 'lobby', current_round_id = NULL WHERE id = ? AND phase = 'results'",
  )
    .bind(room!.id)
    .run();
  return c.json({ ok: true });
});

app.delete('/api/rooms/:code/me', async (c) => {
  if (!c.env.DB) return c.json({ error: 'Game storage is unavailable' }, 503);
  const room = await getRoom(c.env.DB, c.req.param('code'));
  if (roomError(room)) return c.json({ error: 'Room not found or expired' }, 404);
  const secret = bearer(c.req.header('authorization'));
  if (!secret) return c.json({ error: 'Player access required' }, 401);
  const result = await c.env.DB.prepare(
    'UPDATE players SET active = 0 WHERE room_id = ? AND session_secret_hash = ? AND active = 1',
  )
    .bind(room!.id, await hash(secret))
    .run();
  if (result.meta.changes !== 1) return c.json({ error: 'Player access required' }, 401);
  return c.json({ ok: true });
});

app.delete('/api/rooms/:code', async (c) => {
  if (!c.env.DB) return c.json({ error: 'Game storage is unavailable' }, 503);
  const room = await getRoom(c.env.DB, c.req.param('code'));
  if (roomError(room)) return c.json({ error: 'Room not found or expired' }, 404);
  if (!(await hostAuthorized(room!, c.req.header('authorization')))) {
    return c.json({ error: 'Host access required' }, 403);
  }
  await c.env.DB.prepare("UPDATE rooms SET phase = 'ended' WHERE id = ?").bind(room!.id).run();
  if (c.env.BUCKET) {
    const clips = await c.env.DB.prepare(
      'SELECT clips.storage_key FROM clips JOIN rounds ON rounds.id = clips.round_id WHERE rounds.room_id = ?',
    )
      .bind(room!.id)
      .all<{ storage_key: string }>();
    if (clips.results.length)
      await c.env.BUCKET.delete(clips.results.map((clip) => clip.storage_key));
  }
  return c.json({ ok: true });
});

app.delete('/api/rooms/:code/players/:id', async (c) => {
  if (!c.env.DB) return c.json({ error: 'Game storage is unavailable' }, 503);
  const room = await getRoom(c.env.DB, c.req.param('code'));
  const unavailable = roomError(room);
  if (unavailable) return c.json({ error: unavailable }, 404);
  if (!(await hostAuthorized(room!, c.req.header('authorization')))) {
    return c.json({ error: 'Host access required' }, 403);
  }
  if (room!.phase !== 'lobby')
    return c.json({ error: 'Players can only be removed in the lobby' }, 409);
  const result = await c.env.DB.prepare(
    'UPDATE players SET active = 0 WHERE id = ? AND room_id = ?',
  )
    .bind(c.req.param('id'), room!.id)
    .run();
  if (result.meta.changes !== 1) return c.json({ error: 'Player not found' }, 404);
  return c.json({ ok: true });
});

export default app;

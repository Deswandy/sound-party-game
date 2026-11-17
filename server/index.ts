import { Hono } from 'hono';
import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import type {
  CreateRoomResponse,
  HealthResponse,
  JoinRoomResponse,
  LobbyPlayer,
  LobbyState,
} from '../shared/game';

type Bindings = {
  DB: D1Database;
  BUCKET: R2Bucket;
};

const app = new Hono<{ Bindings: Bindings }>();
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const roomDurationMs = 2 * 60 * 60 * 1000;

type Room = {
  id: string;
  code: string;
  host_secret_hash: string;
  phase: string;
  max_players: number;
  expires_at: number;
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
      'SELECT id, code, host_secret_hash, phase, max_players, expires_at FROM rooms WHERE code = ?',
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
  if (!isHost) {
    const player = await c.env.DB.prepare(
      'SELECT id FROM players WHERE room_id = ? AND session_secret_hash = ? AND active = 1',
    )
      .bind(room!.id, await hash(secret))
      .first<{ id: string }>();
    if (!player) return c.json({ error: 'Room access required' }, 401);
  }
  const rows = await c.env.DB.prepare(
    'SELECT id, display_name FROM players WHERE room_id = ? AND active = 1 ORDER BY joined_at, id',
  )
    .bind(room!.id)
    .all<{ id: string; display_name: string }>();
  const players: LobbyPlayer[] = rows.results.map((row) => ({
    id: row.id,
    name: row.display_name,
  }));
  return c.json<LobbyState>({
    code: room!.code,
    phase: 'lobby',
    players,
    maxPlayers: room!.max_players,
    expiresAt: room!.expires_at,
  });
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

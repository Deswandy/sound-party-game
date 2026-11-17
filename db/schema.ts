import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const rooms = sqliteTable('rooms', {
  id: text('id').primaryKey(),
  code: text('code').notNull().unique(),
  hostSecretHash: text('host_secret_hash').notNull(),
  phase: text('phase').notNull().default('lobby'),
  currentRoundId: text('current_round_id'),
  maxPlayers: integer('max_players').notNull().default(20),
  createdAt: integer('created_at').notNull(),
  lastActiveAt: integer('last_active_at').notNull(),
  expiresAt: integer('expires_at').notNull(),
});

export const players = sqliteTable(
  'players',
  {
    id: text('id').primaryKey(),
    roomId: text('room_id')
      .notNull()
      .references(() => rooms.id),
    sessionSecretHash: text('session_secret_hash').notNull(),
    displayName: text('display_name').notNull(),
    joinedAt: integer('joined_at').notNull(),
    lastSeenAt: integer('last_seen_at').notNull(),
    active: integer('active').notNull().default(1),
  },
  (table) => [uniqueIndex('players_room_session').on(table.roomId, table.sessionSecretHash)],
);

export const rounds = sqliteTable('rounds', {
  id: text('id').primaryKey(),
  roomId: text('room_id')
    .notNull()
    .references(() => rooms.id),
  prompt: text('prompt').notNull(),
  createdAt: integer('created_at').notNull(),
  endedAt: integer('ended_at'),
});

export const clips = sqliteTable(
  'clips',
  {
    id: text('id').primaryKey(),
    roundId: text('round_id')
      .notNull()
      .references(() => rounds.id),
    playerId: text('player_id')
      .notNull()
      .references(() => players.id),
    storageKey: text('storage_key').notNull(),
    mimeType: text('mime_type').notNull(),
    durationMs: integer('duration_ms').notNull(),
    submittedAt: integer('submitted_at').notNull(),
    status: text('status').notNull().default('submitted'),
  },
  (table) => [uniqueIndex('clips_round_player').on(table.roundId, table.playerId)],
);

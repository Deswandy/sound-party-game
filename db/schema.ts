import { integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

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
    ready: integer('ready').notNull().default(0),
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
  playbackIndex: integer('playback_index').notNull().default(-1),
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

export const votes = sqliteTable(
  'votes',
  {
    roundId: text('round_id')
      .notNull()
      .references(() => rounds.id),
    playerId: text('player_id')
      .notNull()
      .references(() => players.id),
    clipId: text('clip_id')
      .notNull()
      .references(() => clips.id),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.roundId, table.playerId] })],
);

export const hearsayRounds = sqliteTable(
  'hearsay_rounds',
  {
    id: text('id').primaryKey(),
    roomId: text('room_id')
      .notNull()
      .references(() => rooms.id),
    roundNumber: integer('round_number').notNull(),
    planJson: text('plan_json').notNull(),
    stage: text('stage').notNull().default('recording'),
    currentMatchup: integer('current_matchup').notNull().default(-1),
    deadlineAt: integer('deadline_at').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [uniqueIndex('hearsay_round_room_number').on(table.roomId, table.roundNumber)],
);

export const hearsayAssignments = sqliteTable(
  'hearsay_assignments',
  {
    id: text('id').primaryKey(),
    roundId: text('round_id')
      .notNull()
      .references(() => hearsayRounds.id),
    playerId: text('player_id')
      .notNull()
      .references(() => players.id),
    sceneId: text('scene_id').notNull(),
    slot: integer('slot').notNull(),
    durationMs: integer('duration_ms').notNull(),
    storageKey: text('storage_key'),
    mimeType: text('mime_type'),
    submittedAt: integer('submitted_at'),
  },
  (table) => [
    uniqueIndex('hearsay_assignment_player_scene_slot').on(
      table.roundId,
      table.playerId,
      table.sceneId,
      table.slot,
    ),
  ],
);

export const hearsayMatchups = sqliteTable(
  'hearsay_matchups',
  {
    id: text('id').primaryKey(),
    roundId: text('round_id')
      .notNull()
      .references(() => hearsayRounds.id),
    sceneId: text('scene_id').notNull(),
    slot: integer('slot').notNull(),
    sequence: integer('sequence').notNull(),
    winnerAssignmentId: text('winner_assignment_id'),
    runnerUpAssignmentId: text('runner_up_assignment_id'),
  },
  (table) => [
    uniqueIndex('hearsay_matchup_scene_slot').on(table.roundId, table.sceneId, table.slot),
  ],
);

export const hearsayVotes = sqliteTable(
  'hearsay_votes',
  {
    matchupId: text('matchup_id')
      .notNull()
      .references(() => hearsayMatchups.id),
    playerId: text('player_id')
      .notNull()
      .references(() => players.id),
    assignmentId: text('assignment_id')
      .notNull()
      .references(() => hearsayAssignments.id),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.matchupId, table.playerId] })],
);

export const hearsayLikes = sqliteTable(
  'hearsay_likes',
  {
    matchupId: text('matchup_id')
      .notNull()
      .references(() => hearsayMatchups.id),
    playerId: text('player_id')
      .notNull()
      .references(() => players.id),
    assignmentId: text('assignment_id')
      .notNull()
      .references(() => hearsayAssignments.id),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.matchupId, table.playerId, table.assignmentId] })],
);

export const hearsayAvatars = sqliteTable('hearsay_avatars', {
  playerId: text('player_id')
    .primaryKey()
    .references(() => players.id),
  storageKey: text('storage_key').notNull(),
  mimeType: text('mime_type').notNull(),
  submittedAt: integer('submitted_at').notNull(),
});

export const hearsayScores = sqliteTable('hearsay_scores', {
  playerId: text('player_id')
    .primaryKey()
    .references(() => players.id),
  score: integer('score').notNull().default(0),
  videoAppearances: integer('video_appearances').notNull().default(0),
});

export const hearsayMinigameTallies = sqliteTable(
  'hearsay_minigame_tallies',
  {
    roundId: text('round_id')
      .notNull()
      .references(() => hearsayRounds.id),
    playerId: text('player_id')
      .notNull()
      .references(() => players.id),
    tally: integer('tally').notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.roundId, table.playerId] })],
);

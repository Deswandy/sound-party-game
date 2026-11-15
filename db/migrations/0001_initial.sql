CREATE TABLE rooms (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  host_secret_hash TEXT NOT NULL,
  phase TEXT NOT NULL DEFAULT 'lobby',
  current_round_id TEXT,
  max_players INTEGER NOT NULL DEFAULT 20,
  created_at INTEGER NOT NULL,
  last_active_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE players (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id),
  session_secret_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  joined_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX players_room ON players(room_id);

CREATE TABLE rounds (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id),
  prompt TEXT NOT NULL,
  recording_deadline INTEGER,
  created_at INTEGER NOT NULL,
  ended_at INTEGER
);

CREATE INDEX rounds_room ON rounds(room_id);

CREATE TABLE clips (
  id TEXT PRIMARY KEY,
  round_id TEXT NOT NULL REFERENCES rounds(id),
  player_id TEXT NOT NULL REFERENCES players(id),
  storage_key TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  submitted_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'submitted',
  UNIQUE(round_id, player_id)
);

CREATE TABLE votes (
  round_id TEXT NOT NULL REFERENCES rounds(id),
  player_id TEXT NOT NULL REFERENCES players(id),
  clip_id TEXT NOT NULL REFERENCES clips(id),
  created_at INTEGER NOT NULL,
  PRIMARY KEY(round_id, player_id)
);

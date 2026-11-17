export const MAX_PLAYERS = 20;

export type GamePhase = 'lobby' | 'recording' | 'playback' | 'voting' | 'results' | 'ended';

export type RoomState = {
  code: string;
  phase: GamePhase;
  playerCount: number;
  roundNumber: number;
  prompt: string | null;
};

export type HealthResponse = { status: 'ok'; service: 'sound-party-game' };

export type LobbyPlayer = { id: string; name: string; ready: boolean };
export type RoundClip = { id: string; number: number };
export type RoundResult = RoundClip & { playerId: string; name: string; votes: number };
export type ScoreEntry = { playerId: string; name: string; votes: number };

export type LobbyState = {
  code: string;
  phase: GamePhase;
  players: LobbyPlayer[];
  maxPlayers: number;
  expiresAt: number;
  roundId: string | null;
  prompt: string | null;
  submissionCount: number;
  mySubmitted: boolean;
  roundNumber: number;
  playbackIndex: number;
  clips: RoundClip[];
  myClipId: string | null;
  myVoteClipId: string | null;
  voteCount: number;
  results: RoundResult[];
  scores: ScoreEntry[];
};

export type CreateRoomResponse = { code: string; hostToken: string };
export type JoinRoomResponse = { playerId: string; playerToken: string };

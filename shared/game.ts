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

export type LobbyPlayer = { id: string; name: string };

export type LobbyState = {
  code: string;
  phase: 'lobby';
  players: LobbyPlayer[];
  maxPlayers: number;
  expiresAt: number;
};

export type CreateRoomResponse = { code: string; hostToken: string };
export type JoinRoomResponse = { playerId: string; playerToken: string };

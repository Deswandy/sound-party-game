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

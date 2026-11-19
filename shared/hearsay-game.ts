import type { RoundPlan, Scene } from './hearsay';

export type HearSayStage =
  | 'lobby'
  | 'intermission'
  | 'intermission-results'
  | 'recording'
  | 'playback'
  | 'voting'
  | 'reveal'
  | 'video'
  | 'results';

export type HearSayAssignment = {
  id: string;
  playerId: string;
  sceneId: string;
  slot: number;
  prompt: string;
  direction: string | null;
  durationMs: number;
  submitted: boolean;
};

export type HearSayMatchup = {
  id: string;
  sceneId: string;
  slot: number;
  prompt: string;
  scene: Scene;
  choices: {
    assignmentId: string;
    playerId: string;
    name: string;
    submitted: boolean;
  }[];
  winnerAssignmentId: string | null;
  runnerUpAssignmentId: string | null;
  myVoteAssignmentId: string | null;
  myLikedAssignmentIds: string[];
};

export type HearSayState = {
  code: string;
  phase: string;
  roundNumber: number;
  stage: HearSayStage;
  deadlineAt: number | null;
  minigame: 'bop' | 'dots' | 'jump' | null;
  minigameTallies: { playerId: string; tally: number }[];
  currentMatchup: number;
  players: {
    id: string;
    name: string;
    ready: boolean;
    hasAvatar: boolean;
    score: number;
  }[];
  assignments: HearSayAssignment[];
  sceneCount: number;
  plan?: RoundPlan;
  matchup: HearSayMatchup | null;
  sceneWinners: { slot: number; assignmentId: string | null }[];
  soundboard: {
    assignmentId: string;
    playerName: string;
    roundNumber: number;
    prompt: string;
    blooper: boolean;
    slot: number;
    scene: Scene | null;
  }[];
};

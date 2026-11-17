import scenes from '../content/hearsay/scenes.json';

export type SoundSlot = { prompt: string; direction: string | null; durationMs: number };
export type Scene = {
  id: string;
  appearance: 'EARLY' | 'MID-GAME' | 'LATE';
  videoId: string;
  title: string;
  description: string;
  video: string;
  backingTrack: string;
  slots: SoundSlot[];
};
export type SoundAssignment = {
  playerId: string;
  sceneId: string;
  slot: number;
  prompt: string;
  direction: string | null;
  durationMs: number;
};
export type PlannedScene = {
  scene: Scene;
  matchups: { slot: number; playerIds: string[] }[];
};
export type RoundPlan = { scenes: PlannedScene[]; assignments: SoundAssignment[] };

export const HEARSAY_SCENES = scenes as Scene[];

const ORIGINAL_SPLIT_GROUPS: Record<number, number[][][]> = {
  6: [
    [
      [0, 1, 2],
      [3, 4, 5],
    ],
    [
      [4, 3, 0],
      [2, 5, 1],
    ],
  ],
  7: [
    [
      [0, 1, 2],
      [3, 4, 5, 6],
    ],
    [
      [4, 3, 0],
      [6, 2, 5, 1],
    ],
  ],
  8: [
    [
      [0, 1, 2, 3],
      [4, 5, 6, 7],
    ],
    [
      [7, 2, 5, 0],
      [3, 6, 1, 4],
    ],
  ],
  9: [
    [
      [0, 1, 2, 3],
      [4, 5, 6, 7, 8],
    ],
    [
      [7, 2, 5, 0],
      [8, 3, 6, 1, 4],
    ],
  ],
  10: [
    [
      [0, 1, 2, 3, 4],
      [5, 6, 7, 8, 9],
    ],
    [
      [9, 3, 7, 1, 5],
      [4, 8, 2, 6, 0],
    ],
  ],
};

const ORIGINAL_FINAL_SLOTS: Record<number, number[][]> = {
  5: [
    [0, 1],
    [0, 2],
    [1, 2],
    [1, 2],
    [1, 2],
  ],
  6: [
    [0, 1],
    [0, 1],
    [0, 2],
    [0, 2],
    [1, 2],
    [1, 2],
  ],
  7: [
    [0, 1],
    [0, 1],
    [0, 2],
    [0, 2],
    [1, 2],
    [1, 2],
    [1, 2],
  ],
  8: [
    [0, 1],
    [0, 1],
    [0, 2],
    [0, 2],
    [1, 2],
    [1, 2],
    [1, 2],
    [1, 2],
  ],
};

function shuffle<T>(values: T[], random: () => number): T[] {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function takeScene(
  appearance: Scene['appearance'],
  usedVideoIds: Set<string>,
  random: () => number,
): Scene {
  const choices = HEARSAY_SCENES.filter(
    (scene) => scene.appearance === appearance && !usedVideoIds.has(scene.videoId),
  );
  if (!choices.length) throw new Error(`No unused ${appearance} scene remains`);
  const picked = choices[Math.floor(random() * choices.length)];
  usedVideoIds.add(picked.videoId);
  return picked;
}

/** Plans the original round structure, extending its split groups and final slots to 20 players. */
export function planHearSayRound(
  playerIds: string[],
  roundNumber: 1 | 2 | 3,
  usedVideoIds: Set<string> = new Set(),
  random: () => number = Math.random,
): RoundPlan {
  if (
    playerIds.length < 2 ||
    playerIds.length > 20 ||
    new Set(playerIds).size !== playerIds.length
  ) {
    throw new Error('Hear Say requires 2–20 distinct players');
  }
  const players = [...playerIds];
  const isFinal = roundNumber === 3;
  const groups: string[][] = isFinal
    ? [players]
    : players.length <= 5
      ? [players, players]
      : (() => {
          const original = ORIGINAL_SPLIT_GROUPS[players.length];
          if (original)
            return original[roundNumber - 1].map((group) => group.map((index) => players[index]));
          const half = Math.ceil(players.length / 2);
          if (roundNumber === 1) return [players.slice(0, half), players.slice(half)];
          // Rotate membership so players meet a different set of competitors in round two.
          const left = players.filter((_, i) => i % 2 === 0);
          const right = players.filter((_, i) => i % 2 === 1);
          return [left, right];
        })();

  const planned: PlannedScene[] = [];
  const assignments: SoundAssignment[] = [];
  const seen = new Set(usedVideoIds);
  for (const group of groups) {
    const scene = takeScene(
      isFinal ? 'LATE' : roundNumber === 1 ? 'EARLY' : 'MID-GAME',
      seen,
      random,
    );
    const matchups = scene.slots.map((_, slot) => ({ slot, playerIds: [] as string[] }));
    for (let i = 0; i < group.length; i++) {
      const slotIndexes = isFinal
        ? group.length <= 4
          ? [0, 1, 2]
          : ORIGINAL_FINAL_SLOTS[group.length]
            ? ORIGINAL_FINAL_SLOTS[group.length][i]
            : [i % 3]
        : [0];
      for (const slot of slotIndexes) {
        const sound = scene.slots[slot];
        assignments.push({
          playerId: group[i],
          sceneId: scene.id,
          slot,
          prompt: sound.prompt,
          direction: sound.direction,
          durationMs: sound.durationMs,
        });
        matchups[slot].playerIds.push(group[i]);
      }
    }
    planned.push({ scene, matchups });
  }
  return { scenes: planned, assignments: shuffle(assignments, random) };
}

export function matchupPoints(votes: number[], pointPool = 1500): number[] {
  const total = votes.reduce((sum, count) => sum + count, 0);
  return votes.map((count) => (total ? Math.round((pointPool * count) / total / 100) * 100 : 0));
}

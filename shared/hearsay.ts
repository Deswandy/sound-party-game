import { FOLEY_SCENES } from './foley-scenes';

export type SoundSlot = {
  prompt: string;
  direction: string | null;
  durationMs: number;
  action: string;
};
export type Scene = {
  id: string;
  appearance: 'EARLY' | 'MID-GAME' | 'LATE';
  videoId: string;
  title: string;
  symbol: string;
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
  const choices = FOLEY_SCENES.filter(
    (scene) => scene.appearance === appearance && !usedVideoIds.has(scene.videoId),
  );
  if (!choices.length) throw new Error(`No unused ${appearance} scene remains`);
  const picked = choices[Math.floor(random() * choices.length)];
  usedVideoIds.add(picked.videoId);
  return picked;
}

/** Plans Foley Fools rounds for 2–20 players. */
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
    throw new Error('Foley Fools requires 2â€“20 distinct players');
  }
  const players = [...playerIds];
  const isFinal = roundNumber === 3;
  const groups: string[][] = isFinal
    ? [players]
    : players.length <= 5
      ? [players, players]
      : (() => {
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
          : group.length <= 8
            ? [i % 3, (i + 1) % 3]
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

export type MatchupStanding = {
  playerId: string;
  votes: number;
  likes: number;
  priorVideoAppearances: number;
};

export function rankMatchup(standings: MatchupStanding[]): {
  winner: MatchupStanding;
  runnerUp: MatchupStanding | null;
  points: Map<string, number>;
} {
  if (!standings.length) throw new Error('A matchup needs recordings');
  const ranked = [...standings].sort(
    (a, b) => b.votes - a.votes || a.priorVideoAppearances - b.priorVideoAppearances,
  );
  const [winner] = ranked;
  const runnerUp =
    ranked
      .slice(1)
      .filter((entry) => entry.votes > 0 || entry.likes > 0)
      .sort(
        (a, b) =>
          b.votes - a.votes ||
          a.priorVideoAppearances - b.priorVideoAppearances ||
          b.likes - a.likes,
      )[0] ?? null;
  const awards = matchupPoints(standings.map((entry) => entry.votes));
  return {
    winner,
    runnerUp,
    points: new Map(
      standings.map((entry, index) => [entry.playerId, awards[index] + entry.likes * 20]),
    ),
  };
}

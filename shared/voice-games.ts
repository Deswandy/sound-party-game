export type VoiceGameKind = 'bop' | 'dots' | 'jump';

export type VoiceGameState = {
  kind: VoiceGameKind;
  elapsedMs: number;
  tally: number;
  level: number;
  x: number;
  y: number;
  velocity: number;
  targetX: number;
  targetY: number;
  obstacleX: number;
  sequence: number;
  high: boolean;
  armed: boolean;
  lastScoreMs: number;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function dotY(sequence: number) {
  return [25, 65, 38, 72, 48, 30, 62][sequence % 7];
}

export function createVoiceGame(kind: VoiceGameKind): VoiceGameState {
  return {
    kind,
    elapsedMs: 0,
    tally: 0,
    level: 0,
    x: kind === 'dots' ? 8 : 22,
    y: kind === 'jump' ? 80 : 75,
    velocity: 0,
    targetX: 32,
    targetY: dotY(0),
    obstacleX: 100,
    sequence: 0,
    high: false,
    armed: true,
    lastScoreMs: -1000,
  };
}

function finish(state: VoiceGameState, next: VoiceGameState) {
  if (next.tally > state.tally) {
    if (next.elapsedMs - state.lastScoreMs < 150) next.tally = state.tally;
    else next.lastScoreMs = next.elapsedMs;
  }
  return next;
}

export function stepVoiceGame(state: VoiceGameState, rms: number, dtMs: number): VoiceGameState {
  const dt = clamp(dtMs, 0, 100) / 1000;
  const level = clamp(rms / 0.24, 0, 1);
  const next = { ...state, elapsedMs: state.elapsedMs + dt * 1000, level };

  if (state.kind === 'bop') {
    next.y += (80 - level * 65 - next.y) * Math.min(1, dt * 9);
    if (next.armed && next.y < 32) {
      next.armed = false;
      next.high = true;
    } else if (next.high && next.y > 68) {
      next.high = false;
      next.armed = true;
      next.tally += 1;
    }
    return finish(state, next);
  }

  if (state.kind === 'dots') {
    next.x += dt * 22;
    if (next.x > 96) next.x = 8;
    next.y += (80 - level * 65 - next.y) * Math.min(1, dt * 7);
    if (Math.abs(next.x - next.targetX) < 4 && Math.abs(next.y - next.targetY) < 12) {
      next.tally += 1;
      next.sequence += 1;
      next.targetX = next.x + 23;
      if (next.targetX > 94) next.targetX -= 86;
      next.targetY = dotY(next.sequence);
    }
    return finish(state, next);
  }

  const rising = level > 0.5 && !state.high;
  next.high = level > 0.25;
  if (rising && next.y >= 79) next.velocity = -170;
  next.y = Math.min(80, next.y + next.velocity * dt);
  next.velocity = next.y >= 80 ? 0 : next.velocity + 500 * dt;
  next.obstacleX -= dt * 25;
  if (state.obstacleX > 22 && next.obstacleX <= 22) {
    if (next.y < 58) next.tally += 1;
    next.sequence += 1;
  }
  if (next.obstacleX < -5) next.obstacleX = 100;
  return finish(state, next);
}

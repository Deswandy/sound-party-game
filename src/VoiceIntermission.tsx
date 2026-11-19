import { useEffect, useRef, useState } from 'preact/hooks';
import {
  createVoiceGame,
  stepVoiceGame,
  voiceGameNames,
  type VoiceGameKind,
} from '../shared/voice-games';

const instructions = {
  bop: 'Use your voice to lift the lantern, then go quiet to bring it home.',
  dots: 'Use your volume to steer the comet through the rings.',
  jump: 'Make a sound as a meteor approaches to jump over it.',
};

export function VoiceIntermission({
  code,
  token,
  kind,
  deadlineAt,
}: {
  code: string;
  token: string;
  kind: VoiceGameKind;
  deadlineAt: number;
}) {
  const stream = useRef<MediaStream | null>(null);
  const context = useRef<AudioContext | null>(null);
  const frame = useRef<number | null>(null);
  const game = useRef(createVoiceGame(kind));
  const lastFrame = useRef(0);
  const lastPaint = useRef(0);
  const disposed = useRef(false);
  const [picture, setPicture] = useState(game.current);
  const [active, setActive] = useState(false);
  const [error, setError] = useState('');

  function stop() {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    stream.current?.getTracks().forEach((track) => track.stop());
    void context.current?.close();
    frame.current = null;
    stream.current = null;
    context.current = null;
    setActive(false);
  }
  useEffect(
    () => () => {
      disposed.current = true;
      stop();
    },
    [],
  );

  async function submitTally() {
    try {
      const response = await fetch(`/api/rooms/${code}/hearsay/intermission/tally`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok && ![409, 429].includes(response.status))
        throw new Error('Could not save a tally');
    } catch {
      setError('A tally could not be saved. Check your connection.');
    }
  }

  async function start() {
    if (Date.now() >= deadlineAt) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Microphone input is unavailable in this browser.');
      return;
    }
    try {
      const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (disposed.current || Date.now() >= deadlineAt) {
        mic.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.current = mic;
      const audio = new AudioContext();
      context.current = audio;
      await audio.resume();
      if (disposed.current || Date.now() >= deadlineAt) {
        stop();
        return;
      }
      const analyser = audio.createAnalyser();
      analyser.fftSize = 1024;
      audio.createMediaStreamSource(mic).connect(analyser);
      const samples = new Uint8Array(analyser.fftSize);
      setError('');
      setActive(true);
      lastFrame.current = performance.now();
      function tick(time: number) {
        if (Date.now() >= deadlineAt) {
          stop();
          return;
        }
        analyser.getByteTimeDomainData(samples);
        let sum = 0;
        for (const sample of samples) sum += ((sample - 128) / 128) ** 2;
        const rms = Math.sqrt(sum / samples.length);
        const before = game.current.tally;
        game.current = stepVoiceGame(game.current, rms, time - lastFrame.current);
        lastFrame.current = time;
        if (game.current.tally > before) void submitTally();
        if (time - lastPaint.current > 40) {
          setPicture(game.current);
          lastPaint.current = time;
        }
        frame.current = requestAnimationFrame(tick);
      }
      frame.current = requestAnimationFrame(tick);
    } catch (cause) {
      stop();
      setError(
        (cause as DOMException).name === 'NotAllowedError'
          ? 'Allow microphone access to play the voice game.'
          : 'Could not start the microphone.',
      );
    }
  }

  return (
    <div class="voice-game">
      <h2>{voiceGameNames[kind]}</h2>
      <p>{instructions[kind]}</p>
      <div class={`voice-board voice-board-${kind}`} aria-label={`${kind} voice game`}>
        {kind === 'bop' && (
          <>
            <span class="voice-goal voice-goal-high">LOUD</span>
            <span class="voice-goal voice-goal-low">QUIET</span>
            <span class="voice-ball" style={{ top: `${picture.y}%` }} />
          </>
        )}
        {kind === 'dots' && (
          <>
            <span
              class="voice-dot"
              style={{ left: `${picture.targetX}%`, top: `${picture.targetY}%` }}
            />
            <span class="voice-snake" style={{ left: `${picture.x}%`, top: `${picture.y}%` }}>
              ◉
            </span>
          </>
        )}
        {kind === 'jump' && (
          <>
            <span class="voice-ground" />
            <span class="voice-runner" style={{ top: `${picture.y}%` }}>
              ●
            </span>
            <span class="voice-obstacle" style={{ left: `${picture.obstacleX}%` }} />
          </>
        )}
      </div>
      <div
        class="meter"
        role="meter"
        aria-label="Microphone level"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(picture.level * 100)}
      >
        <span style={{ width: `${picture.level * 100}%` }} />
      </div>
      <strong>
        {picture.tally} {picture.tally === 1 ? 'tally' : 'tallies'}
      </strong>
      <button disabled={Date.now() >= deadlineAt} onClick={() => (active ? stop() : void start())}>
        {active ? 'Stop microphone' : 'Start voice game'}
      </button>
      {error && (
        <p class="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

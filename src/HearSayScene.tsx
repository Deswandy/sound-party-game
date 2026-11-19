import { useEffect, useRef, useState } from 'preact/hooks';
import type { Scene } from '../shared/hearsay';

const leadIn = 1.1;
const beatSeconds = 3.3;

export function HearSayScene({
  code,
  token,
  scene,
  winners,
  frameArt = false,
}: {
  code: string;
  token: string;
  scene: Scene;
  winners: { slot: number; assignmentId: string | null }[];
  frameArt?: boolean;
}) {
  const context = useRef<AudioContext | null>(null);
  const frame = useRef(0);
  const busy = useRef(false);
  const playbackId = useRef(0);
  const [clips, setClips] = useState<Map<number, ArrayBuffer> | null>(null);
  const [error, setError] = useState('');
  const [playing, setPlaying] = useState(false);
  const [slot, setSlot] = useState(-1);

  function stop() {
    playbackId.current++;
    busy.current = false;
    cancelAnimationFrame(frame.current);
    const audio = context.current;
    context.current = null;
    if (audio && audio.state !== 'closed') void audio.close().catch(() => {});
  }

  useEffect(() => {
    const abort = new AbortController();
    void Promise.all(
      winners.flatMap(({ slot, assignmentId }) =>
        assignmentId
          ? [
              fetch(`/api/rooms/${code}/hearsay/assignments/${assignmentId}/audio`, {
                signal: abort.signal,
                headers: { Authorization: `Bearer ${token}` },
              }).then(async (response) => {
                if (!response.ok) throw new Error('A recording could not be loaded');
                return [slot, await response.arrayBuffer()] as const;
              }),
            ]
          : [],
      ),
    ).then(
      (entries) => {
        if (!abort.signal.aborted) setClips(new Map(entries));
      },
      () => {
        if (!abort.signal.aborted) {
          setError('A recording could not be loaded. The scene can still play.');
          setClips(new Map());
        }
      },
    );
    return () => {
      abort.abort();
      stop();
    };
  }, [code, token, scene.id]);

  async function play() {
    if (!clips || busy.current) return;
    busy.current = true;
    const id = ++playbackId.current;
    setPlaying(true);
    setSlot(-1);
    try {
      const audio = new AudioContext();
      context.current = audio;
      await audio.resume();
      const decoded = await Promise.allSettled(
        [...clips].map(
          async ([index, data]) => [index, await audio.decodeAudioData(data.slice(0))] as const,
        ),
      );
      if (id !== playbackId.current) return;
      if (decoded.some((entry) => entry.status === 'rejected')) {
        setError('A recording could not be played.');
      }
      const start = audio.currentTime + 0.08;
      for (const [index, pitch] of [220, 330, 440].entries()) {
        const when = start + index * 0.14;
        const note = audio.createOscillator();
        const gain = audio.createGain();
        note.frequency.value = pitch;
        gain.gain.setValueAtTime(0.04, when);
        gain.gain.exponentialRampToValueAtTime(0.001, when + 0.18);
        note.connect(gain).connect(audio.destination);
        note.start(when);
        note.stop(when + 0.18);
      }
      for (const result of decoded) {
        if (result.status !== 'fulfilled') continue;
        const [index, buffer] = result.value;
        const source = audio.createBufferSource();
        source.buffer = buffer;
        source.connect(audio.destination);
        source.start(start + leadIn + index * beatSeconds, 0, Math.min(buffer.duration, 3.1));
      }
      let lastSlot = -1;
      function tick() {
        const elapsed = audio.currentTime - start;
        if (elapsed >= leadIn + scene.slots.length * beatSeconds) {
          stop();
          setPlaying(false);
          return;
        }
        const index = elapsed < leadIn ? -1 : Math.floor((elapsed - leadIn) / beatSeconds);
        if (index !== lastSlot) {
          setSlot(index);
          lastSlot = index;
        }
        frame.current = requestAnimationFrame(tick);
      }
      frame.current = requestAnimationFrame(tick);
    } catch {
      if (id !== playbackId.current) return;
      stop();
      setPlaying(false);
      setError('Audio could not start. Press Play scene to try again.');
    }
  }

  const beat = scene.slots[slot];
  return (
    <div class="hearsay-scene">
      <div class={`foley-stage ${frameArt ? 'foley-stage-replay' : ''}`}>
        <strong>{scene.title}</strong>
        <div class="foley-stage-action" key={slot} aria-hidden="true">
          {beat?.action ?? scene.symbol ?? '🎙️'}
        </div>
        <span>{beat?.prompt ?? 'Get ready to listen'}</span>
      </div>
      <button
        disabled={!clips}
        onClick={() => {
          if (playing) {
            stop();
            setPlaying(false);
          } else void play();
        }}
      >
        {!clips ? 'Loading sounds…' : playing ? 'Stop scene' : 'Play scene'}
      </button>
      {error && (
        <p class="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

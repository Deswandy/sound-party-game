import { useEffect, useRef, useState } from 'preact/hooks';
import type { Scene } from '../shared/hearsay';

const mediaRoot =
  'https://github.com/Deswandy/sound-party-game/releases/download/hearsay-media-v1/';

export function HearSayScene({
  code,
  token,
  scene,
  winners,
}: {
  code: string;
  token: string;
  scene: Scene;
  winners: { slot: number; assignmentId: string | null }[];
}) {
  const video = useRef<HTMLVideoElement | null>(null);
  const backing = useRef<HTMLAudioElement | null>(null);
  const clips = useRef<Map<number, string>>(new Map());
  const playing = useRef<HTMLAudioElement[]>([]);
  const fired = useRef<Set<number>>(new Set());
  const frame = useRef<number | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [playingNow, setPlayingNow] = useState(false);
  const [activeSlot, setActiveSlot] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const urls: string[] = [];
    async function load() {
      try {
        const entries = await Promise.all(
          winners
            .filter((winner) => winner.assignmentId)
            .map(async (winner) => {
              const response = await fetch(
                `/api/rooms/${code}/hearsay/assignments/${winner.assignmentId}/audio`,
                { headers: { Authorization: `Bearer ${token}` } },
              );
              if (!response.ok) throw new Error('Could not load a winning sound');
              const url = URL.createObjectURL(await response.blob());
              urls.push(url);
              return [winner.slot, url] as const;
            }),
        );
        if (!cancelled) {
          clips.current = new Map(entries);
          setReady(true);
        }
      } catch (cause) {
        if (!cancelled) setError((cause as Error).message);
      }
    }
    void load();
    return () => {
      cancelled = true;
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      playing.current.forEach((audio) => audio.pause());
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [code, token, scene.id]);

  function stop() {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    playing.current.forEach((audio) => audio.pause());
    playing.current = [];
    backing.current?.pause();
    video.current?.pause();
    setPlayingNow(false);
    setActiveSlot(null);
  }

  async function play() {
    if (!ready || !video.current || !backing.current) return;
    stop();
    setError('');
    fired.current.clear();
    video.current.currentTime = 0;
    backing.current.currentTime = 0;
    try {
      await Promise.all([video.current.play(), backing.current.play()]);
      setPlayingNow(true);
      const starts = scene.timeline?.soundStarts ?? [];
      const markers = scene.timeline?.markers ?? [];
      function tick() {
        const elapsed = (backing.current?.currentTime ?? 0) * 1000;
        starts.forEach((cue, index) => {
          if (fired.current.has(index) || elapsed < cue.positionMs) return;
          fired.current.add(index);
          const slot = Number(/^Prompt(\d+)$/.exec(cue.name)?.[1]);
          const url = clips.current.get(slot);
          if (url) {
            const sound = new Audio(url);
            playing.current.push(sound);
            void sound.play().catch(() => setError('Could not play a recorded sound'));
          }
        });
        const visible = [...markers]
          .reverse()
          .find(
            (marker) => marker.positionMs <= elapsed && /^Prompt\d+(On|Off)$/.test(marker.name),
          );
        setActiveSlot(
          visible?.name.endsWith('On') ? Number(/^Prompt(\d+)/.exec(visible.name)?.[1]) : null,
        );
        if (backing.current && !backing.current.ended) frame.current = requestAnimationFrame(tick);
        else stop();
      }
      frame.current = requestAnimationFrame(tick);
    } catch {
      stop();
      setError('Browser playback was blocked. Press Play scene again.');
    }
  }

  return (
    <div class="hearsay-scene">
      <video ref={video} src={mediaRoot + scene.video} muted playsInline preload="metadata" />
      <audio ref={backing} src={mediaRoot + scene.audio} preload="auto" />
      {activeSlot !== null && <span class="scene-voice">Sound {activeSlot + 1}</span>}
      <button disabled={!ready} onClick={() => void play()}>
        {ready ? (playingNow ? 'Replay scene' : 'Play scene') : 'Loading sounds…'}
      </button>
      {playingNow && (
        <button class="secondary" onClick={stop}>
          Stop
        </button>
      )}
      {error && (
        <p class="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

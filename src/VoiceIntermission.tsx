import { useEffect, useRef, useState } from 'preact/hooks';

const instructions = {
  bop: 'Use your volume to move the ball up and down. Make as many reps as you can.',
  dots: 'Use your volume to steer the snake toward the dots.',
  jump: 'Use your volume to jump. Make as many jumps as you can.',
};

export function VoiceIntermission({
  code,
  token,
  kind,
  deadlineAt,
}: {
  code: string;
  token: string;
  kind: 'bop' | 'dots' | 'jump';
  deadlineAt: number;
}) {
  const stream = useRef<MediaStream | null>(null);
  const context = useRef<AudioContext | null>(null);
  const frame = useRef<number | null>(null);
  const [level, setLevel] = useState(0);
  const [tallies, setTallies] = useState(0);
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
  useEffect(() => () => stop(), []);

  async function start() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Microphone input is unavailable in this browser.');
      return;
    }
    try {
      const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
      const audio = new AudioContext();
      const analyser = audio.createAnalyser();
      analyser.fftSize = 1024;
      audio.createMediaStreamSource(mic).connect(analyser);
      const samples = new Uint8Array(analyser.fftSize);
      stream.current = mic;
      context.current = audio;
      setActive(true);
      let above = false;
      let lastTally = 0;
      function tick() {
        if (Date.now() >= deadlineAt) {
          stop();
          return;
        }
        analyser.getByteTimeDomainData(samples);
        let sum = 0;
        for (const sample of samples) sum += ((sample - 128) / 128) ** 2;
        const rms = Math.sqrt(sum / samples.length);
        setLevel(Math.min(100, Math.round(rms * 400)));
        const threshold = kind === 'jump' ? 0.16 : kind === 'dots' ? 0.09 : 0.12;
        if (rms > threshold && !above && Date.now() - lastTally > 350) {
          above = true;
          lastTally = Date.now();
          setTallies((current) => current + 1);
          void fetch(`/api/rooms/${code}/hearsay/intermission/tally`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
          });
        }
        if (rms < threshold * 0.5) above = false;
        frame.current = requestAnimationFrame(tick);
      }
      tick();
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
      <h2>{kind === 'bop' ? 'Ups & Downs' : kind === 'dots' ? 'Nibble Noises' : 'Hup Hop'}</h2>
      <p>{instructions[kind]}</p>
      <div
        class="meter"
        role="meter"
        aria-label="Microphone level"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={level}
      >
        <span style={{ width: `${level}%` }} />
      </div>
      <strong>
        {tallies} {tallies === 1 ? 'tally' : 'tallies'}
      </strong>
      <button onClick={() => (active ? stop() : void start())}>
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

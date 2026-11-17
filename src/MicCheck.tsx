import { useEffect, useRef, useState } from 'preact/hooks';

export function MicCheck() {
  const stream = useRef<MediaStream | null>(null);
  const context = useRef<AudioContext | null>(null);
  const frame = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [active, setActive] = useState(false);
  const [level, setLevel] = useState(0);
  const [hits, setHits] = useState(0);
  const [message, setMessage] = useState('');

  function stop() {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    if (timer.current) clearTimeout(timer.current);
    stream.current?.getTracks().forEach((track) => track.stop());
    void context.current?.close();
    frame.current = null;
    timer.current = null;
    stream.current = null;
    context.current = null;
    setActive(false);
  }

  useEffect(() => () => stop(), []);

  async function start() {
    setMessage('');
    setHits(0);
    if (!navigator.mediaDevices?.getUserMedia || typeof AudioContext === 'undefined') {
      setMessage('Microphone check is unavailable in this browser.');
      return;
    }
    try {
      const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
      const audio = new AudioContext();
      stream.current = mic;
      context.current = audio;
      const source = audio.createMediaStreamSource(mic);
      const analyser = audio.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
      const samples = new Uint8Array(analyser.fftSize);
      let above = false;
      let count = 0;
      function measure() {
        analyser.getByteTimeDomainData(samples);
        let sum = 0;
        for (const sample of samples) sum += ((sample - 128) / 128) ** 2;
        const rms = Math.sqrt(sum / samples.length);
        setLevel(Math.min(100, Math.round(rms * 400)));
        if (rms > 0.12 && !above) {
          count++;
          setHits(count);
          above = true;
        }
        if (rms < 0.06) above = false;
        frame.current = requestAnimationFrame(measure);
      }
      setActive(true);
      measure();
      timer.current = setTimeout(() => {
        stop();
        setLevel(0);
        setMessage(
          count
            ? 'Microphone is working. You’re ready to record.'
            : 'No sound detected. Check your microphone and try again.',
        );
      }, 6000);
    } catch (cause) {
      stop();
      setMessage(
        (cause as DOMException).name === 'NotAllowedError'
          ? 'Microphone access was denied. Allow it in your browser to test.'
          : 'Could not start the microphone check.',
      );
    }
  }

  return (
    <div class="mic-check">
      <h2>Mic warm-up</h2>
      <p>Make a few sounds and watch the meter move.</p>
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
      {active && (
        <small>
          {hits} sound {hits === 1 ? 'burst' : 'bursts'} detected
        </small>
      )}
      <button class="secondary" onClick={() => (active ? stop() : void start())}>
        {active ? 'Stop mic check' : 'Test microphone'}
      </button>
      {message && <small>{message}</small>}
    </div>
  );
}

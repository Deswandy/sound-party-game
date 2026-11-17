import { useEffect, useRef, useState } from 'preact/hooks';

const maxDurationMs = 30_000;
const acceptedTypes = [
  'audio/webm;codecs=opus',
  'audio/mp4',
  'audio/ogg;codecs=opus',
  'audio/webm',
];

type Preview = { blob: Blob; url: string; durationMs: number };

export function Recorder({
  code,
  token,
  submitted,
  onSubmitted,
}: {
  code: string;
  token: string;
  submitted: boolean;
  onSubmitted: () => void;
}) {
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ticker = useRef<ReturnType<typeof setInterval> | null>(null);
  const [recording, setRecording] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(30);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState(false);
  const [error, setError] = useState('');

  function releaseMicrophone() {
    if (timeout.current) clearTimeout(timeout.current);
    if (ticker.current) clearInterval(ticker.current);
    timeout.current = null;
    ticker.current = null;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    recorder.current = null;
    setRecording(false);
  }

  useEffect(
    () => () => {
      if (recorder.current?.state === 'recording') recorder.current.stop();
      releaseMicrophone();
    },
    [],
  );

  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview.url);
    },
    [preview],
  );

  async function start() {
    setError('');
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('This browser cannot record audio. Try a current Chrome or Safari browser.');
      return;
    }
    try {
      const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.current = audioStream;
      const mimeType = acceptedTypes.find((type) => MediaRecorder.isTypeSupported(type));
      const next = new MediaRecorder(audioStream, {
        ...(mimeType ? { mimeType } : {}),
        audioBitsPerSecond: 96_000,
      });
      recorder.current = next;
      const chunks: BlobPart[] = [];
      const started = performance.now();
      next.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      next.onerror = () => {
        setError('Recording stopped unexpectedly. Please try again.');
        releaseMicrophone();
      };
      next.onstop = () => {
        const durationMs = Math.max(
          1,
          Math.min(maxDurationMs, Math.round(performance.now() - started)),
        );
        const blob = new Blob(chunks, { type: next.mimeType });
        releaseMicrophone();
        if (blob.size) {
          setPreview({ blob, url: URL.createObjectURL(blob), durationMs });
          setUploaded(false);
        } else setError('No audio was captured. Please record again.');
      };
      setPreview(null);
      setUploaded(false);
      setSecondsLeft(30);
      next.start(250);
      setRecording(true);
      const deadline = started + maxDurationMs;
      ticker.current = setInterval(
        () => setSecondsLeft(Math.max(0, Math.ceil((deadline - performance.now()) / 1000))),
        200,
      );
      timeout.current = setTimeout(() => {
        if (next.state === 'recording') next.stop();
      }, maxDurationMs);
    } catch (cause) {
      releaseMicrophone();
      setError(
        (cause as DOMException).name === 'NotAllowedError'
          ? 'Microphone permission was denied. Allow it in your browser and try again.'
          : 'Could not start recording. Check your microphone and try again.',
      );
    }
  }

  async function submit() {
    if (!preview) return;
    setUploading(true);
    setError('');
    try {
      const response = await fetch(`/api/rooms/${code}/clips`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': preview.blob.type,
          'X-Clip-Duration-Ms': String(preview.durationMs),
        },
        body: preview.blob,
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? 'Upload failed');
      setUploaded(true);
      onSubmitted();
    } catch (cause) {
      setError(`${(cause as Error).message}. Your preview is still here; try submitting again.`);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div class="recorder">
      <p class="recording-note">
        Mute your meeting microphone before recording. Your clip will be heard by this room.
      </p>
      {recording ? (
        <>
          <div class="timer" role="timer">
            {secondsLeft}s left
          </div>
          <button onClick={() => recorder.current?.stop()}>Stop recording</button>
        </>
      ) : (
        <>
          {preview && (
            <>
              <audio controls src={preview.url} aria-label="Preview your recording" />
              <small>{Math.ceil(preview.durationMs / 1000)} seconds recorded</small>
            </>
          )}
          {(uploaded || submitted) && (
            <p class="submitted">
              Your clip is submitted. You can replace it while recording is open.
            </p>
          )}
          {preview && !uploaded && (
            <button disabled={uploading} onClick={() => void submit()}>
              {uploading ? 'Submitting…' : 'Submit clip'}
            </button>
          )}
          <button class="secondary" disabled={uploading} onClick={() => void start()}>
            {preview || submitted ? 'Record again' : 'Record'}
          </button>
        </>
      )}
      {error && (
        <p class="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

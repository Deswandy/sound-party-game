import { useEffect, useState } from 'preact/hooks';
import type { RoundClip } from '../shared/game';

export function Playback({
  code,
  token,
  clips,
  playbackIndex,
  onSelected,
  onVoting,
}: {
  code: string;
  token: string;
  clips: RoundClip[];
  playbackIndex: number;
  onSelected: (index: number) => void;
  onVoting: () => void;
}) {
  const [url, setUrl] = useState('');
  const [selected, setSelected] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );

  async function select(clip: RoundClip) {
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/rooms/${code}/clips/${clip.id}/audio`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error('Could not load this clip');
      const blob = await response.blob();
      const nextUrl = URL.createObjectURL(blob);
      const changed = await fetch(`/api/rooms/${code}/playback/select`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ clipId: clip.id }),
      });
      if (!changed.ok) {
        URL.revokeObjectURL(nextUrl);
        const body = (await changed.json()) as { error?: string };
        throw new Error(body.error ?? 'Could not select this clip');
      }
      setUrl(nextUrl);
      setSelected(clip.number);
      onSelected(clip.number - 1);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="playback">
      <p>Share this tab with audio in your meeting. Play each anonymous clip in order.</p>
      <div class="clip-grid">
        {clips.map((clip) => (
          <button
            key={clip.id}
            class={selected === clip.number ? 'clip selected' : 'clip'}
            disabled={busy || clip.number > playbackIndex + 2}
            onClick={() => void select(clip)}
          >
            Clip {clip.number}
          </button>
        ))}
      </div>
      {url && <audio key={url} controls src={url} aria-label={`Play clip ${selected}`} />}
      {playbackIndex >= clips.length - 1 && clips.length > 0 && (
        <button onClick={onVoting}>Open voting</button>
      )}
      {error && (
        <p class="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

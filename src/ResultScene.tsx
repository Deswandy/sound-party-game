import { useEffect, useState } from 'preact/hooks';
import type { RoundResult } from '../shared/game';

export function ResultScene({
  code,
  token,
  results,
  prompt,
  isHost,
}: {
  code: string;
  token: string;
  results: RoundResult[];
  prompt: string | null;
  isHost: boolean;
}) {
  const [selected, setSelected] = useState(results[0]?.id ?? '');
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const winners = results.filter((result) => result.votes === results[0]?.votes);

  useEffect(() => {
    if (!isHost || !selected) return;
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch(`/api/rooms/${code}/clips/${selected}/audio`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) throw new Error('Could not load the winning sound');
        const next = URL.createObjectURL(await response.blob());
        if (cancelled) URL.revokeObjectURL(next);
        else {
          setUrl(next);
          setError('');
        }
      } catch (cause) {
        if (!cancelled) setError((cause as Error).message);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [code, token, selected, isHost]);
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );

  const scene = prompt?.includes('balloon')
    ? 'A silent library. One tiny noise breaks the tension.'
    : prompt?.includes('spaceship')
      ? 'A kitchen table becomes a launchpad.'
      : prompt?.includes('monster')
        ? 'Something stirs behind the museum curtain.'
        : 'The sound lands in an unexpected late-night radio drama.';

  return (
    <div class="scene">
      <span class="scene-label">A new scene</span>
      <div class="scene-art" aria-hidden="true">
        <span>♪</span>
      </div>
      <p>{scene}</p>
      {isHost && winners.length > 1 && (
        <div class="clip-grid">
          {winners.map((winner) => (
            <button class="clip" key={winner.id} onClick={() => setSelected(winner.id)}>
              Clip {winner.number}
            </button>
          ))}
        </div>
      )}
      {isHost && url && <audio key={url} controls src={url} aria-label="Play winning sound" />}
      {error && (
        <p class="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

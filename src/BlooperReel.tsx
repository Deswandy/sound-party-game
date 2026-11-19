import { useState } from 'preact/hooks';
import type { HearSayState } from '../shared/hearsay-game';
import { HearSayScene } from './HearSayScene';

type Blooper = HearSayState['soundboard'][number];

export function BlooperReel({
  code,
  token,
  bloopers,
}: {
  code: string;
  token: string;
  bloopers: Blooper[];
}) {
  const [selected, setSelected] = useState(0);
  const current = bloopers[selected];
  if (!current?.scene) return <p>No runner-up scenes this game.</p>;

  function select(index: number) {
    setSelected(index);
  }

  return (
    <section class="blooper-reel" aria-label="Blooper reel">
      <div class="blooper-heading">
        <span>
          Blooper {selected + 1} of {bloopers.length}
        </span>
        <strong>{current.playerName}</strong>
        <span>{current.prompt}</span>
      </div>
      <HearSayScene
        key={current.assignmentId}
        code={code}
        token={token}
        scene={current.scene}
        winners={[{ slot: current.slot, assignmentId: current.assignmentId }]}
        frameArt
      />
      <div class="blooper-controls">
        <button class="secondary" disabled={selected === 0} onClick={() => select(selected - 1)}>
          Previous blooper
        </button>
        <button
          class="secondary"
          disabled={selected === bloopers.length - 1}
          onClick={() => select(selected + 1)}
        >
          Next blooper
        </button>
      </div>
    </section>
  );
}

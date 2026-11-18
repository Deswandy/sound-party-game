import { render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import QRCode from 'qrcode';
import type { CreateRoomResponse, JoinRoomResponse } from '../shared/game';
import type { HearSayState } from '../shared/hearsay-game';
import { Recorder } from './Recorder';
import { MicCheck } from './MicCheck';
import { HearSayScene } from './HearSayScene';
import { VoiceIntermission } from './VoiceIntermission';
import './style.css';

const isHost = location.pathname === '/host';
const queryCode = new URLSearchParams(location.search).get('code')?.toUpperCase() ?? '';

class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(
  path: string,
  method: string,
  token?: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new ApiError(data.error ?? 'Something went wrong', response.status);
  return data;
}

function HostAudio({
  code,
  token,
  assignmentId,
  label,
}: {
  code: string;
  token: string;
  assignmentId: string;
  label: string;
}) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );
  async function load() {
    try {
      const response = await fetch(`/api/rooms/${code}/hearsay/assignments/${assignmentId}/audio`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error('Could not load the sound');
      setUrl(URL.createObjectURL(await response.blob()));
    } catch (cause) {
      setError((cause as Error).message);
    }
  }
  return (
    <div class="sound-choice">
      <strong>{label}</strong>
      {url ? (
        <audio controls autoPlay src={url} />
      ) : (
        <button class="secondary" onClick={() => void load()}>
          Play sound
        </button>
      )}
      {error && <p class="error">{error}</p>}
    </div>
  );
}

function App() {
  const [name, setName] = useState(localStorage.getItem('foley-name') ?? '');
  const [code, setCode] = useState(queryCode);
  const [roomCode, setRoomCode] = useState('');
  const [session, setSession] = useState('');
  const [playerId, setPlayerId] = useState('');
  const [state, setState] = useState<HearSayState | null>(null);
  const [qr, setQr] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());
  const autoTransition = useRef('');
  const savedHostCode = localStorage.getItem('foley-host-code');
  const canOpenHost = Boolean(savedHostCode && localStorage.getItem(`foley-host-${savedHostCode}`));

  function forgetSession(oldCode: string) {
    localStorage.removeItem(`foley-${isHost ? 'host' : 'player'}-${oldCode}`);
    localStorage.removeItem(isHost ? 'foley-host-code' : 'foley-player-code');
    if (!isHost) localStorage.removeItem(`foley-player-id-${oldCode}`);
    setRoomCode('');
    setSession('');
    setState(null);
  }

  useEffect(() => {
    const savedCode = localStorage.getItem(isHost ? 'foley-host-code' : 'foley-player-code');
    const savedToken =
      savedCode && localStorage.getItem(`foley-${isHost ? 'host' : 'player'}-${savedCode}`);
    if (savedCode && savedToken && (isHost || !queryCode || queryCode === savedCode)) {
      setRoomCode(savedCode);
      setSession(savedToken);
      if (!isHost) setPlayerId(localStorage.getItem(`foley-player-id-${savedCode}`) ?? '');
    }
  }, []);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(interval);
  }, []);

  async function refresh(codeToUse = roomCode, tokenToUse = session) {
    if (!codeToUse || !tokenToUse) return;
    try {
      const next = await request<HearSayState>(
        `/api/rooms/${codeToUse}/hearsay/state`,
        'GET',
        tokenToUse,
      );
      setState(next);
      setError('');
    } catch (cause) {
      if (cause instanceof ApiError && [401, 404].includes(cause.status)) {
        forgetSession(codeToUse);
        setError('');
      } else setError((cause as Error).message);
    }
  }
  useEffect(() => {
    if (!roomCode || !session) return;
    void refresh();
    const interval = setInterval(() => void refresh(), 2000);
    return () => clearInterval(interval);
  }, [roomCode, session]);

  const joinUrl = roomCode ? `${location.origin}/?code=${roomCode}` : '';
  useEffect(() => {
    if (joinUrl) void QRCode.toDataURL(joinUrl, { width: 220, margin: 2 }).then(setQr);
  }, [joinUrl]);

  async function createRoom() {
    setBusy(true);
    setError('');
    try {
      const result = await request<CreateRoomResponse>('/api/rooms', 'POST');
      localStorage.setItem('foley-host-code', result.code);
      localStorage.setItem(`foley-host-${result.code}`, result.hostToken);
      setRoomCode(result.code);
      setSession(result.hostToken);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function joinRoom(event: Event) {
    event.preventDefault();
    const normalized = code.trim().toUpperCase();
    setBusy(true);
    setError('');
    try {
      const result = await request<JoinRoomResponse>(
        `/api/rooms/${normalized}/join`,
        'POST',
        undefined,
        {
          name: name.trim(),
          playerToken: localStorage.getItem(`foley-player-${normalized}`),
        },
      );
      localStorage.setItem('foley-name', name.trim());
      localStorage.setItem('foley-player-code', normalized);
      localStorage.setItem(`foley-player-${normalized}`, result.playerToken);
      localStorage.setItem(`foley-player-id-${normalized}`, result.playerId);
      setRoomCode(normalized);
      setSession(result.playerToken);
      setPlayerId(result.playerId);
      history.replaceState(null, '', `/?code=${normalized}`);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function action(path: string, body?: unknown) {
    setBusy(true);
    setError('');
    try {
      await request(`/api/rooms/${roomCode}/${path}`, 'POST', session, body);
      await refresh();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!isHost || !state?.deadlineAt || busy) return;
    const grace = state.stage === 'recording' ? 5000 : 0;
    if (now < state.deadlineAt + grace) return;
    const path =
      state.stage === 'intermission'
        ? 'hearsay/intermission/finish'
        : state.stage === 'recording'
          ? 'hearsay/close-recording'
          : state.stage === 'voting'
            ? 'hearsay/reveal'
            : null;
    if (!path) return;
    const key = `${state.roundNumber}-${state.currentMatchup}-${state.stage}`;
    if (autoTransition.current === key) return;
    autoTransition.current = key;
    void action(path);
  }, [state?.stage, state?.deadlineAt, state?.roundNumber, state?.currentMatchup, now, busy]);

  async function leave() {
    setBusy(true);
    setError('');
    try {
      if (isHost) {
        if (!confirm('Close this room for everyone?')) return;
        await request(`/api/rooms/${roomCode}/hearsay`, 'DELETE', session);
      } else {
        await request(`/api/rooms/${roomCode}/me`, 'DELETE', session);
      }
      forgetSession(roomCode);
      location.href = isHost ? '/host' : '/';
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function removePlayer(id: string) {
    setBusy(true);
    setError('');
    try {
      await request(`/api/rooms/${roomCode}/players/${id}`, 'DELETE', session);
      await refresh();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const deadlineSeconds = state?.deadlineAt
    ? Math.max(0, Math.ceil((state.deadlineAt - now) / 1000))
    : 0;
  const me = state?.players.find((player) => player.id === playerId);
  const matchup = state?.matchup;

  return (
    <main class="shell">
      <nav class="topbar" aria-label="Main navigation">
        <a class="brand" href="/">
          ◉ <span>Foley Fools</span>
        </a>
      </nav>
      <section class="hero">
        <h1>
          {!roomCode
            ? isHost
              ? 'Host Game'
              : 'Join Game'
            : state?.stage === 'lobby'
              ? 'Game Lobby'
              : state?.stage === 'recording'
                ? 'Record a Sound'
                : state?.stage === 'intermission'
                  ? 'Mic Game'
                  : state?.stage === 'results'
                    ? 'Round Results'
                    : 'Sound Matchup'}
        </h1>
        <div class={`card ${roomCode ? 'lobby' : ''}`}>
          {!roomCode ? (
            isHost ? (
              <>
                <p>Share your game screen and audio in the meeting.</p>
                <button disabled={busy} onClick={() => void createRoom()}>
                  {busy ? 'Creating…' : 'Create Game'}
                </button>
              </>
            ) : (
              <form onSubmit={(event) => void joinRoom(event)}>
                <label htmlFor="name">Your name</label>
                <input
                  id="name"
                  value={name}
                  onInput={(event) => setName(event.currentTarget.value)}
                  maxLength={24}
                  required
                />
                <label htmlFor="code">Game code</label>
                <input
                  id="code"
                  value={code}
                  onInput={(event) => setCode(event.currentTarget.value.toUpperCase())}
                  maxLength={6}
                  required
                />
                <button disabled={busy}>{busy ? 'Joining…' : 'Join Game'}</button>
              </form>
            )
          ) : (
            <>
              <div class="room-heading">
                <span>Room code</span>
                <strong class="room-code">{roomCode}</strong>
              </div>
              {!state && <p>Loading game…</p>}
              {state?.stage === 'lobby' && (
                <>
                  <p class="count">
                    {state.players.length} / 20 players ·{' '}
                    {state.players.filter((player) => player.ready).length} ready
                  </p>
                  {isHost && (
                    <div class="sharing">
                      <p>Share this link or code with your players.</p>
                      {qr && <img class="qr" src={qr} alt={`QR code to join room ${roomCode}`} />}
                      <a class="join-link" href={joinUrl}>
                        {joinUrl}
                      </a>
                      <button
                        class="secondary"
                        onClick={() => void navigator.clipboard.writeText(joinUrl)}
                      >
                        Copy join link
                      </button>
                    </div>
                  )}
                  <h2>Players</h2>
                  <ul class="players">
                    {state.players.map((player) => (
                      <li key={player.id}>
                        <span>
                          {player.name}
                          {player.id === playerId ? ' (you)' : ''}
                          {player.hasAvatar ? ' · Sound ready' : ''}
                          {player.ready ? ' · Ready' : ''}
                        </span>
                        {isHost && (
                          <button
                            class="remove"
                            aria-label={`Remove ${player.name}`}
                            onClick={() => void removePlayer(player.id)}
                          >
                            Remove
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                  {isHost ? (
                    <button
                      disabled={
                        busy ||
                        state.players.length < 2 ||
                        state.players.some((player) => !player.ready || !player.hasAvatar)
                      }
                      onClick={() => void action('hearsay/rounds')}
                    >
                      Start game
                    </button>
                  ) : (
                    <>
                      <h2>Your lobby sound</h2>
                      <Recorder
                        code={roomCode}
                        token={session}
                        maxDurationMs={2000}
                        uploadPath={`/api/rooms/${roomCode}/hearsay/avatar`}
                        submitted={Boolean(me?.hasAvatar)}
                        onSubmitted={() => void refresh()}
                        note="Record a two-second sound for your player avatar."
                      />
                      <MicCheck />
                      <button
                        class="secondary"
                        disabled={busy || !me?.hasAvatar}
                        onClick={() => void action('ready', { ready: !me?.ready })}
                      >
                        {me?.ready ? 'Not ready' : 'I’m ready'}
                      </button>
                    </>
                  )}
                </>
              )}
              {state?.stage === 'intermission' && (
                <div class="round-active">
                  <p class="count">
                    Round {state.roundNumber} of 3 · {deadlineSeconds}s
                  </p>
                  {isHost ? (
                    <>
                      <h2>
                        {state.minigame === 'bop'
                          ? 'Ups & Downs'
                          : state.minigame === 'dots'
                            ? 'Nibble Noises'
                            : 'Hup Hop'}
                      </h2>
                      <p>Players use their microphones for 15 seconds.</p>
                      <button
                        disabled={busy || deadlineSeconds > 0}
                        onClick={() => void action('hearsay/intermission/finish')}
                      >
                        Finish warm-up
                      </button>
                    </>
                  ) : (
                    state.minigame &&
                    state.deadlineAt && (
                      <VoiceIntermission
                        key={`${state.roundNumber}-${state.minigame}`}
                        code={roomCode}
                        token={session}
                        kind={state.minigame}
                        deadlineAt={state.deadlineAt}
                      />
                    )
                  )}
                </div>
              )}
              {state?.stage === 'recording' && (
                <div class="round-active">
                  <p class="count">
                    Round {state.roundNumber} of 3 · {deadlineSeconds}s
                  </p>
                  {isHost ? (
                    <>
                      <p>
                        {state.assignments.filter((assignment) => assignment.submitted).length} of{' '}
                        {state.assignments.length} sounds recorded
                      </p>
                      <button
                        disabled={busy}
                        onClick={() => void action('hearsay/close-recording')}
                      >
                        Close recording
                      </button>
                    </>
                  ) : (
                    state.assignments.map((assignment, index) => (
                      <div class="sound-assignment" key={assignment.id}>
                        <h2>
                          Sound {index + 1} of {state.assignments.length}
                        </h2>
                        <p class="prompt">{assignment.prompt}</p>
                        {assignment.direction && <p>{assignment.direction}</p>}
                        <Recorder
                          key={assignment.id}
                          code={roomCode}
                          token={session}
                          maxDurationMs={assignment.durationMs}
                          uploadPath={`/api/rooms/${roomCode}/hearsay/assignments/${assignment.id}/audio`}
                          submitted={assignment.submitted}
                          onSubmitted={() => void refresh()}
                        />
                      </div>
                    ))
                  )}
                </div>
              )}
              {matchup && ['playback', 'voting', 'reveal'].includes(state?.stage ?? '') && (
                <div class="round-active">
                  <p class="count">
                    Round {state?.roundNumber} · Matchup {state?.currentMatchup + 1}
                  </p>
                  <p class="prompt">{matchup.prompt}</p>
                  {state?.stage === 'playback' &&
                    (isHost ? (
                      <>
                        <p>Play each sound through your meeting audio.</p>
                        {matchup.choices.map((choice, index) => (
                          <HostAudio
                            key={choice.assignmentId}
                            code={roomCode}
                            token={session}
                            assignmentId={choice.assignmentId}
                            label={`Sound ${index + 1} · ${choice.name}`}
                          />
                        ))}
                        <button disabled={busy} onClick={() => void action('hearsay/open-voting')}>
                          Open voting
                        </button>
                      </>
                    ) : (
                      <p>Listen through the meeting audio. Voting opens soon.</p>
                    ))}
                  {state?.stage === 'voting' &&
                    (isHost ? (
                      <>
                        <p>{deadlineSeconds}s left to vote and like sounds.</p>
                        <button disabled={busy} onClick={() => void action('hearsay/reveal')}>
                          Reveal winner
                        </button>
                      </>
                    ) : (
                      <>
                        {!matchup.choices.length && (
                          <p>You're in this two-person matchup. Everyone else votes.</p>
                        )}
                        {matchup.choices.length > 0 && !matchup.myVoteAssignmentId && (
                          <div class="clip-grid">
                            {matchup.choices.map((choice, index) => (
                              <button
                                class="clip"
                                key={choice.assignmentId}
                                disabled={busy}
                                onClick={() =>
                                  void action('hearsay/votes', {
                                    assignmentId: choice.assignmentId,
                                  })
                                }
                              >
                                Vote for sound {index + 1} · {choice.name}
                              </button>
                            ))}
                          </div>
                        )}
                        {(matchup.myVoteAssignmentId || !matchup.choices.length) && (
                          <>
                            <p>Like any sounds you enjoyed.</p>
                            <div class="clip-grid">
                              {matchup.choices.map((choice) => (
                                <button
                                  class="clip"
                                  key={choice.assignmentId}
                                  disabled={
                                    busy ||
                                    matchup.myLikedAssignmentIds.includes(choice.assignmentId)
                                  }
                                  onClick={() =>
                                    void action('hearsay/likes', {
                                      assignmentId: choice.assignmentId,
                                    })
                                  }
                                >
                                  {matchup.myLikedAssignmentIds.includes(choice.assignmentId)
                                    ? 'Liked'
                                    : `Like ${choice.name}`}
                                </button>
                              ))}
                            </div>
                          </>
                        )}
                      </>
                    ))}
                  {state?.stage === 'reveal' && (
                    <>
                      <h2>Winner</h2>
                      <p>
                        {matchup.choices.find(
                          (choice) => choice.assignmentId === matchup.winnerAssignmentId,
                        )?.name ?? 'A sound'}
                      </p>
                      {isHost && (
                        <button disabled={busy} onClick={() => void action('hearsay/advance')}>
                          Continue
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}
              {state?.stage === 'video' && matchup && (
                <div class="round-active">
                  <h2>The winning sounds in a scene</h2>
                  {isHost ? (
                    <>
                      <HearSayScene
                        key={`${state.roundNumber}-${matchup.sceneId}`}
                        code={roomCode}
                        token={session}
                        scene={matchup.scene}
                        winners={state.sceneWinners}
                      />
                      <button disabled={busy} onClick={() => void action('hearsay/advance')}>
                        Continue
                      </button>
                    </>
                  ) : (
                    <p>Watch and listen through the meeting.</p>
                  )}
                </div>
              )}
              {state?.stage === 'results' && (
                <div class="round-active">
                  <h2>
                    {state.roundNumber === 3 ? 'Final scores' : `Round ${state.roundNumber} scores`}
                  </h2>
                  <ul class="results">
                    {[...state.players]
                      .sort((a, b) => b.score - a.score)
                      .map((player) => (
                        <li key={player.id}>
                          <span>{player.name}</span>
                          <strong>{player.score}</strong>
                        </li>
                      ))}
                  </ul>
                  {state.roundNumber === 3 && state.soundboard.length > 0 && (
                    <>
                      <h2>Blooper reel</h2>
                      {isHost ? (
                        state.soundboard.filter((sound) => sound.blooper).length > 0 ? (
                          state.soundboard
                            .filter((sound) => sound.blooper)
                            .map((sound) => (
                              <HostAudio
                                key={sound.assignmentId}
                                code={roomCode}
                                token={session}
                                assignmentId={sound.assignmentId}
                                label={`Round ${sound.roundNumber} · ${sound.playerName} · ${sound.prompt}`}
                              />
                            ))
                        ) : (
                          <p>No runner-up sounds this game.</p>
                        )
                      ) : (
                        <p>Listen through the meeting audio.</p>
                      )}
                      {isHost ? (
                        <details class="soundboard">
                          <summary>Soundboard · {state.soundboard.length} sounds</summary>
                          {state.soundboard.map((sound) => (
                            <HostAudio
                              key={sound.assignmentId}
                              code={roomCode}
                              token={session}
                              assignmentId={sound.assignmentId}
                              label={`Round ${sound.roundNumber} · ${sound.playerName} · ${sound.prompt}`}
                            />
                          ))}
                        </details>
                      ) : (
                        <p>Ask the host to replay any sound.</p>
                      )}
                    </>
                  )}
                  {isHost && (
                    <button
                      disabled={busy}
                      onClick={() =>
                        void action(state.roundNumber === 3 ? 'hearsay/restart' : 'hearsay/rounds')
                      }
                    >
                      {state.roundNumber === 3
                        ? 'Play again with same players'
                        : 'Continue to next round'}
                    </button>
                  )}
                </div>
              )}
              <button class="secondary" disabled={busy} onClick={() => void leave()}>
                {isHost ? 'Close room' : 'Leave game'}
              </button>
              {isHost && (
                <a
                  class="switch lobby-switch"
                  href={joinUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Join as a player
                </a>
              )}
              {!isHost && canOpenHost && (
                <a class="switch lobby-switch" href="/host">
                  Open host lobby
                </a>
              )}
            </>
          )}
          {error && (
            <p class="error" role="alert">
              {error}
            </p>
          )}
        </div>
        {!roomCode && (
          <>
            <a class="switch" href={isHost ? '/' : '/host'}>
              {isHost ? 'Join a game' : 'Host a game'}
            </a>
            {!isHost && canOpenHost && (
              <a class="switch" href="/host">
                Open host lobby
              </a>
            )}
          </>
        )}
      </section>
    </main>
  );
}

render(<App />, document.getElementById('app')!);

import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import QRCode from 'qrcode';
import type { CreateRoomResponse, JoinRoomResponse, LobbyState } from '../shared/game';
import { Recorder } from './Recorder';
import './style.css';

const isHost = location.pathname === '/host';
const queryCode = new URLSearchParams(location.search).get('code')?.toUpperCase() ?? '';
const prompts = [
  'Make the sound of a balloon slowly deflating.',
  'Make the sound of a tiny spaceship taking off.',
  'Make the sound of a monster trying to be quiet.',
];

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
  body?: unknown,
  token?: string,
): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new ApiError(data.error ?? 'Something went wrong', response.status);
  return data;
}

function App() {
  const [name, setName] = useState(localStorage.getItem('foley-name') ?? '');
  const [code, setCode] = useState(queryCode);
  const [roomCode, setRoomCode] = useState('');
  const [session, setSession] = useState('');
  const [playerId, setPlayerId] = useState('');
  const [lobby, setLobby] = useState<LobbyState | null>(null);
  const [qr, setQr] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [promptChoice, setPromptChoice] = useState(prompts[0]);
  const [customPrompt, setCustomPrompt] = useState('');
  const savedHostCode = localStorage.getItem('foley-host-code');
  const canOpenHost = Boolean(savedHostCode && localStorage.getItem(`foley-host-${savedHostCode}`));

  function forgetSession(codeToForget: string) {
    localStorage.removeItem(`foley-${isHost ? 'host' : 'player'}-${codeToForget}`);
    localStorage.removeItem(isHost ? 'foley-host-code' : 'foley-player-code');
    if (!isHost) localStorage.removeItem(`foley-player-id-${codeToForget}`);
    setRoomCode('');
    setSession('');
    setLobby(null);
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
    if (!roomCode || !session) return;
    let cancelled = false;
    async function refresh() {
      try {
        const next = await request<LobbyState>(
          `/api/rooms/${roomCode}/state`,
          'GET',
          undefined,
          session,
        );
        if (!cancelled) {
          setLobby(next);
          setError('');
        }
      } catch (cause) {
        if (!cancelled) {
          if (cause instanceof ApiError && [401, 404].includes(cause.status)) {
            forgetSession(roomCode);
          }
          setError((cause as Error).message);
        }
      }
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 3000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
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
      const result = await request<JoinRoomResponse>(`/api/rooms/${normalized}/join`, 'POST', {
        name: name.trim(),
        playerToken: localStorage.getItem(`foley-player-${normalized}`),
      });
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

  async function removePlayer(id: string) {
    try {
      await request(`/api/rooms/${roomCode}/players/${id}`, 'DELETE', undefined, session);
      setLobby(
        (current) => current && { ...current, players: current.players.filter((p) => p.id !== id) },
      );
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  async function startRound() {
    setBusy(true);
    setError('');
    try {
      const result = await request<{ roundId: string; prompt: string }>(
        `/api/rooms/${roomCode}/rounds`,
        'POST',
        { prompt: promptChoice === 'custom' ? customPrompt : promptChoice },
        session,
      );
      setLobby(
        (current) =>
          current && {
            ...current,
            phase: 'recording',
            roundId: result.roundId,
            prompt: result.prompt,
            submissionCount: 0,
            mySubmitted: false,
          },
      );
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function closeRecording() {
    setBusy(true);
    setError('');
    try {
      await request(`/api/rooms/${roomCode}/close-recording`, 'POST', undefined, session);
      setLobby((current) => current && { ...current, phase: 'playback' });
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function leaveLobby() {
    setBusy(true);
    setError('');
    try {
      if (isHost) {
        if (!confirm('Close this room for everyone?')) return;
        await request(`/api/rooms/${roomCode}`, 'DELETE', undefined, session);
        forgetSession(roomCode);
        location.href = '/host';
      } else {
        await request(`/api/rooms/${roomCode}/me`, 'DELETE', undefined, session);
        forgetSession(roomCode);
        location.href = '/';
      }
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main class="shell">
      <nav class="topbar" aria-label="Main navigation">
        <a class="brand" href="/">
          ◉ <span>Foley Fools</span>
        </a>
      </nav>
      <section class="hero">
        <h1>
          {roomCode
            ? lobby?.phase === 'recording'
              ? 'Record a Sound'
              : lobby?.phase === 'playback'
                ? 'Recording Closed'
                : 'Game Lobby'
            : isHost
              ? 'Host Game'
              : 'Join Game'}
        </h1>
        <div class={`card ${roomCode ? 'lobby' : ''}`}>
          {roomCode ? (
            <>
              <div class="room-heading">
                <span>Room code</span>
                <strong class="room-code">{roomCode}</strong>
              </div>
              {lobby?.phase === 'lobby' && (
                <p class="count">
                  {lobby.players.length} / {lobby.maxPlayers} players
                </p>
              )}
              {isHost && lobby?.phase === 'lobby' && (
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
              {lobby?.phase === 'lobby' && <h2>Players</h2>}
              {lobby?.phase === 'lobby' &&
                (lobby.players.length ? (
                  <ul class="players">
                    {lobby.players.map((player) => (
                      <li key={player.id}>
                        <span>
                          {player.name}
                          {player.id === playerId && !isHost ? ' (you)' : ''}
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
                ) : (
                  <p class="waiting">Waiting for players…</p>
                ))}
              {isHost && lobby?.phase === 'lobby' && (
                <div class="round-setup">
                  <h2>Start a round</h2>
                  <label htmlFor="prompt">Sound prompt</label>
                  <select
                    id="prompt"
                    value={promptChoice}
                    onChange={(event) => setPromptChoice(event.currentTarget.value)}
                  >
                    {prompts.map((prompt) => (
                      <option value={prompt} key={prompt}>
                        {prompt}
                      </option>
                    ))}
                    <option value="custom">Write my own prompt</option>
                  </select>
                  {promptChoice === 'custom' && (
                    <input
                      aria-label="Custom sound prompt"
                      value={customPrompt}
                      maxLength={160}
                      onInput={(event) => setCustomPrompt(event.currentTarget.value)}
                      placeholder="What sound should players make?"
                    />
                  )}
                  <button
                    disabled={busy || !lobby.players.length}
                    onClick={() => void startRound()}
                  >
                    {busy ? 'Starting…' : 'Start recording round'}
                  </button>
                </div>
              )}
              {lobby?.phase === 'recording' && (
                <div class="round-active">
                  <p class="prompt">{lobby.prompt}</p>
                  {isHost ? (
                    <>
                      <p class="count">
                        {lobby.submissionCount} of {lobby.players.length} submitted
                      </p>
                      <button
                        disabled={busy || lobby.submissionCount === 0}
                        onClick={() => void closeRecording()}
                      >
                        {busy ? 'Closing…' : 'Close recording'}
                      </button>
                    </>
                  ) : (
                    lobby.roundId && (
                      <Recorder
                        key={lobby.roundId}
                        code={roomCode}
                        token={session}
                        submitted={lobby.mySubmitted}
                        onSubmitted={() =>
                          setLobby(
                            (current) =>
                              current && {
                                ...current,
                                submissionCount:
                                  current.submissionCount + (current.mySubmitted ? 0 : 1),
                                mySubmitted: true,
                              },
                          )
                        }
                      />
                    )
                  )}
                </div>
              )}
              {lobby?.phase === 'playback' && (
                <div class="round-active">
                  <p class="prompt">{lobby.prompt}</p>
                  <p>Recording is closed. Playback and voting are coming in the next build.</p>
                </div>
              )}
              {lobby?.phase === 'lobby' && (
                <small>
                  {isHost ? 'Keep this tab open while hosting.' : 'You’re in! Keep this tab open.'}
                </small>
              )}
              <button class="secondary" disabled={busy} onClick={() => void leaveLobby()}>
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
          ) : isHost ? (
            <>
              <p>Share your game screen and audio in the meeting.</p>
              <button onClick={() => void createRoom()} disabled={busy}>
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
                autoComplete="name"
                required
              />
              <label htmlFor="code">Game code</label>
              <input
                id="code"
                value={code}
                onInput={(event) => setCode(event.currentTarget.value.toUpperCase())}
                maxLength={6}
                autoCapitalize="characters"
                required
              />
              <button disabled={busy}>{busy ? 'Joining…' : 'Join Game'}</button>
            </form>
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

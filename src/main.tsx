import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import QRCode from 'qrcode';
import type { CreateRoomResponse, JoinRoomResponse, LobbyState } from '../shared/game';
import './style.css';

const isHost = location.pathname === '/host';
const queryCode = new URLSearchParams(location.search).get('code')?.toUpperCase() ?? '';

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
  if (!response.ok) throw new Error(data.error ?? 'Something went wrong');
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
        if (!cancelled) setError((cause as Error).message);
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

  return (
    <main class="shell">
      <nav class="topbar" aria-label="Main navigation">
        <a class="brand" href="/">
          ◉ <span>Foley Fools</span>
        </a>
      </nav>
      <section class="hero">
        <h1>{roomCode ? 'Game Lobby' : isHost ? 'Host Game' : 'Join Game'}</h1>
        <div class={`card ${roomCode ? 'lobby' : ''}`}>
          {roomCode ? (
            <>
              <div class="room-heading">
                <span>Room code</span>
                <strong class="room-code">{roomCode}</strong>
              </div>
              <p class="count">
                {lobby?.players.length ?? 0} / {lobby?.maxPlayers ?? 20} players
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
              {lobby?.players.length ? (
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
              )}
              <small>
                {isHost ? 'Keep this tab open while hosting.' : 'You’re in! Keep this tab open.'}
              </small>
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
          <a class="switch" href={isHost ? '/' : '/host'}>
            {isHost ? 'Join a game' : 'Host a game'}
          </a>
        )}
      </section>
    </main>
  );
}

render(<App />, document.getElementById('app')!);

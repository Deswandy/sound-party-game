import { render } from 'preact';
import { useState } from 'preact/hooks';
import './style.css';

function App() {
  const host = location.pathname === '/host';
  const [name, setName] = useState('');
  const [code, setCode] = useState('');

  return (
    <main class="shell">
      <nav class="topbar" aria-label="Main navigation">
        <a class="brand" href="/">
          ◉ <span>Foley Fools</span>
        </a>
      </nav>
      <section class="hero">
        <h1>{host ? 'Host Game' : 'Join Game'}</h1>
        <div class="card">
          {host ? (
            <>
              <p>Share your game screen and audio in the meeting.</p>
              <button disabled>Create Game</button>
              <small>Available in the next build</small>
            </>
          ) : (
            <>
              <label htmlFor="name">Your name</label>
              <input
                id="name"
                value={name}
                maxLength={24}
                onInput={(e) => setName(e.currentTarget.value)}
                placeholder="Enter your name"
              />
              <label htmlFor="code">Room code</label>
              <input
                id="code"
                value={code}
                maxLength={6}
                onInput={(e) => setCode(e.currentTarget.value.toUpperCase())}
                placeholder="ABCDEF"
                autoCapitalize="characters"
              />
              <button disabled>Join Game</button>
              <small>Available in the next build</small>
            </>
          )}
        </div>
      </section>
      <a class="switch" href={host ? '/' : '/host'}>
        {host ? 'Join a game' : 'Host a game'}
      </a>
    </main>
  );
}

render(<App />, document.getElementById('app')!);

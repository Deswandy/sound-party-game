import { render } from 'preact';
import { useState } from 'preact/hooks';
import { MAX_PLAYERS } from '../shared/game';
import './style.css';

function App() {
  const host = location.pathname === '/host';
  const [name, setName] = useState('');
  const [code, setCode] = useState('');

  return (
    <main class="shell">
      <nav class="topbar" aria-label="Main navigation">
        <a class="brand" href="/">◉ <span>Sound Party</span></a>
        <span class="tag">An online meeting game</span>
      </nav>
      <section class="hero">
        <div class="eyebrow">MAKE SOME NOISE · MAKE SOME MEMORIES</div>
        <h1>{host ? 'Your party starts here.' : 'The mic is yours.'}</h1>
        <p class="intro">
          {host
            ? `Gather up to ${MAX_PLAYERS} friends. Share this screen and its audio in your meeting, then let everyone record and vote from a browser.`
            : 'Join your friends, record a sound, listen together, and vote for your favorite. Your phone or computer works.'}
        </p>
        <div class="card">
          {host ? (
            <>
              <span class="card-kicker">HOST A GAME</span>
              <h2>Ready to run the room?</h2>
              <p>Room creation arrives in the next build. This screen is ready for the host controls.</p>
              <button disabled>Create room · coming next</button>
            </>
          ) : (
            <>
              <span class="card-kicker">JOIN A GAME</span>
              <h2>Bring your best sound.</h2>
              <label htmlFor="name">Your name</label>
              <input id="name" value={name} maxLength={24} onInput={(e) => setName(e.currentTarget.value)} placeholder="What should we call you?" />
              <label htmlFor="code">Room code</label>
              <input id="code" value={code} maxLength={6} onInput={(e) => setCode(e.currentTarget.value.toUpperCase())} placeholder="ABCDEF" autoCapitalize="characters" />
              <button disabled>Join room · coming next</button>
            </>
          )}
        </div>
        <p class="footnote">No accounts. Just a name, a room, and a little imagination.</p>
      </section>
      <a class="switch" href={host ? '/' : '/host'}>{host ? 'Joining instead? →' : 'Hosting instead? →'}</a>
    </main>
  );
}

render(<App />, document.getElementById('app')!);

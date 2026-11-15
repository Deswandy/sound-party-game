# Sound Party Game — Proposed Work Split

This is the implementation sequence for review. Each slice should leave a working, testable result. No application code has been started yet.

## 1. Project foundation and deployment shape

Set up TypeScript, Preact, Vite, Hono, formatting/type checks, and the Worker build. Define shared API and game-phase types. Configure the database and audio storage bindings, local development, and an initial deployable page.

**Review result:** the app builds, the host and player entry pages load, and the API health endpoint responds. Confirm how invited players will access the hosted game before proceeding: a private owner-only Site would prevent guests from joining, so the game URL must be reachable by them while individual rooms remain code-gated.

## 2. Room and lobby

Implement room creation, a secret host session, short join code and link, QR code, player names, a 20-player limit, reconnecting from the same browser, and polling of lobby state.

**Review result:** one host can create a room and 20 phone or computer browsers can join by name. A 21st join is rejected clearly. A page refresh keeps the same player slot.

## 3. Prompt and recording

Implement the host's prompt selection, round start, browser microphone permission, a short recording timer, preview, re-recording, upload, submission count, and close-recording control. Store clip metadata in D1 and audio in R2.

**Review result:** players can submit one clip each, replace it while recording is open, and recover from permission or upload errors. Late submissions are rejected. The host sees a count but cannot reveal names with clips during this phase.

## 4. Playback and voting

Give the host ordered anonymous clip playback and replay controls. Add the voting phase, one vote per player, self-vote rejection, vote progress, and an explicit reveal action.

**Review result:** the host can share browser audio in a meeting; 20 players can vote once; no one sees totals before reveal.

## 5. Results and repeat rounds

Show the winning clip, creator, and vote count. Show all tied winners. Let the host start another prompt with the same room and players, or end the game.

**Review result:** a full game can run for multiple rounds without rejoining, with votes and clips kept separate by round.

## 6. Expiry, access checks, and rehearsal

Add automatic expiry and deletion of temporary audio and room data, server-side authorization and input limits, clear error states, and a short recording/privacy notice. Test phone and desktop browsers, including someone using the meeting and game on one computer. Rehearse with 15–20 people in an online meeting.

**Review result:** expired rooms cannot be used, their clips are removed, host-only controls reject player tokens, and the complete meeting flow works with shared audio.

## Review decisions before implementation

- Confirm the six slices and their order, or merge/split any slice.
- Confirm that invited players may open the public game URL with a room code. The public repository does not itself make a deployed game accessible.
- Choose a recording limit. Proposed default: 10 seconds per clip.
- Choose whether the host can join as a player from a second tab/device. Proposed default: yes, as a normal player slot.

The [behavior spec](sound-party-game-behaviour.md) defines what players experience. The [technical plan](sound-party-game-technical-plan.md) defines the proposed architecture.

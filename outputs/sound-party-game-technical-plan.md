# Sound Party Game — Technical Plan

## 1. Goal and boundaries

Build a browser-based party game for a host and up to 20 active players in an online meeting. The host shares one presentation screen; players use a phone or computer browser to enter a name, record a sound, and vote.

The first version is intentionally small:

- No accounts, passwords, profiles, chat, downloads, or permanent leaderboards.
- One game room at a time per host.
- A maximum of 20 connected players in a room.
- Audio clips up to 30 seconds each.
- Temporary game data and automatic deletion after the game/inactivity expiry.

## 2. Product shape

The site has two interfaces served by the same app:

| Interface | Used by | Primary job |
| --- | --- | --- |
| Host screen | Host computer | Create a room, control phases, share audio/video in the meeting, playback, reveal results |
| Player controller | Phone or computer browser | Join with name, record a clip, submit, vote |

The host shares only the host screen through the meeting tool. Players do not need to share their own screens. A player can keep the meeting and game in separate tabs on one computer, or use a phone for the game.

## Language and application code

Use **TypeScript** for the browser interfaces and the Worker API. TypeScript is JavaScript with type checks during development; the deployed code runs as JavaScript in browsers and Cloudflare Workers. The same language can describe room phases, API messages, players, clips, and votes on both sides. That reduces mistakes when the host and player screens respond to changing game state.

Use **Preact** for the host and player screens, **Vite** to build their TypeScript and CSS, and **Hono** for API routes in the Cloudflare Worker. Preact gives the changing game phases small, reusable UI components; Hono keeps endpoint routing and request handling compact. Use SQL for D1 schema and queries. Keep game rules in plain TypeScript modules so they are not tied to a framework. No Python service is needed for this version, because recording happens in the browser and the Worker coordinates uploads and game rules.

## 3. Proposed architecture

Use one Cloudflare Worker-backed Site with these managed services:

| Component | Responsibility |
| --- | --- |
| Browser UI | Host and player interfaces; microphone recording using `MediaRecorder` |
| Worker API | Validates actions, enforces phase rules, serves room state, generates signed/opaque IDs |
| D1 database | Rooms, players, rounds, clips metadata, votes, and short-lived sessions |
| R2 object storage | Uploaded audio blobs only |
| Browser `localStorage` | A non-account device/session token so a returning browser keeps its player identity during that room |

Use short polling instead of WebSockets for v1. The host and players request the current room state every 2–3 seconds while the game is active. At 20 players this is small, is easy to recover from flaky mobile connections, and avoids a persistent-connection subsystem.

## 4. Identity, room access, and limits

### Room

- Creating a game makes a random, non-sequential room code (for example, six uppercase characters) and a separate secret host token.
- The host token is stored only in the host browser and authorizes host-only endpoints.
- The room is `lobby` by default and accepts at most 20 active players.
- A QR code encodes the room's player join URL.

### Player

- A player enters a display name, which must be 1–24 characters after trimming.
- Joining creates a random player session token. Store it in that browser's local storage and use it only for that room.
- Names do not need to be unique in v1; the lobby shows duplicates so people can correct them.
- The server accepts only one vote and one final clip per player per round. A re-submission replaces the earlier clip before the host closes recording.

This is lightweight abuse prevention, not strong identity verification. The room code is meant to be shared with invited participants only.

## 5. Data model

### `rooms`

`id`, `code`, `host_secret_hash`, `phase`, `current_round_id`, `max_players`, `created_at`, `last_active_at`, `expires_at`

`phase` is one of: `lobby`, `recording`, `playback`, `voting`, `results`, `ended`.

### `players`

`id`, `room_id`, `session_secret_hash`, `display_name`, `joined_at`, `last_seen_at`, `active`

### `rounds`

`id`, `room_id`, `prompt`, `recording_deadline`, `created_at`, `ended_at`

### `clips`

`id`, `round_id`, `player_id`, `storage_key`, `mime_type`, `duration_ms`, `submitted_at`, `status`

`status` is `draft`, `submitted`, or `deleted`. Only `submitted` clips are eligible for playback and voting.

### `votes`

`round_id`, `player_id`, `clip_id`, `created_at`

Enforce one row per `(round_id, player_id)` and reject a vote where the clip belongs to the voter.

## 6. State machine and permissions

| Phase | Host can do | Player can do |
| --- | --- | --- |
| Lobby | Start round, remove player, end room | Join/change name |
| Recording | Choose/confirm prompt, close recording | Record, preview, replace, submit clip |
| Playback | Select/replay clips, advance to voting | Wait and view current clip number |
| Voting | Open/close voting, reveal results | Cast one vote for another player's clip |
| Results | Start next round or end room | View winner/results |
| Ended | None | View ended message |

Every write endpoint checks both the room phase and the caller's host/player token. The client UI is only a convenience layer; server-side rules are the source of truth.

## 7. API outline

All API responses use JSON unless an audio upload/download is involved.

| Method and path | Caller | Purpose |
| --- | --- | --- |
| `POST /api/rooms` | Host | Create room; return code, join URL, host token |
| `GET /api/rooms/:code/state` | Host/player | Return phase-appropriate room state |
| `POST /api/rooms/:code/join` | Player | Create/recover player session using display name |
| `POST /api/rooms/:code/rounds` | Host | Create round and start recording |
| `POST /api/rounds/:id/clips` | Player | Upload/replace an audio clip |
| `POST /api/rounds/:id/close-recording` | Host | Move to playback |
| `POST /api/rounds/:id/playback` | Host | Set current clip/replay indicator |
| `POST /api/rounds/:id/open-voting` | Host | Move to voting |
| `POST /api/rounds/:id/votes` | Player | Submit one vote |
| `POST /api/rounds/:id/reveal` | Host | Calculate/return results and move to results |
| `POST /api/rooms/:code/end` | Host | End game and queue cleanup |

Audio upload has a strict server-side size limit and accepts only a small allowlist of browser-recordable audio MIME types. The server stores clips with random object keys; clients never choose storage keys.

## 8. Recording and playback

### Recording in the browser

- Request microphone permission only after the player taps **Record**.
- Use the browser `MediaRecorder` API and choose a supported audio-only MIME type at runtime.
- Stop automatically at the configured duration and give the player a preview before submission.
- The recording limit is 30 seconds per clip; the host closes the overall recording phase.
- Compress/limit clips through duration and upload size constraints rather than expensive server transcoding.
- Give clear recovery text for denied permissions, unsupported browsers, and interrupted uploads.

### Playback on host screen

- The host screen fetches clips through authenticated, short-lived playback URLs or a Worker proxy.
- Only the host UI exposes play controls. Player controllers show the clip number and phase, not an independent audio player.
- The host must share tab/computer audio in the meeting application.

## 9. Online-meeting operating rules

- Players can use the game in another browser tab on the same computer as the meeting, or use a separate phone.
- When recording, a player mutes their meeting microphone, records in the game browser, then submits. They should verify that the browser selected the intended microphone.
- During playback, the meeting receives audio from the host's shared tab/screen; players listen rather than play the clips locally.
- Recommend headphones to prevent echo.

This is a usage convention rather than something the game can enforce, because it cannot control another meeting application's microphone or audio settings.

## 10. Privacy, retention, and cleanup

- Store only display names, temporary tokens, game metadata, and submitted audio required for the current game.
- On host end: mark the room `ended`, delete its R2 clips, then delete database records.
- As a fallback, expire inactive rooms after 2 hours and run scheduled cleanup for expired rooms/clips.
- Do not expose clip URLs publicly or make rooms discoverable.
- Put a brief pre-recording notice in the UI: participants' recordings are played to the current room and deleted after the game expires.

## 11. Reliability and edge cases

- A reconnecting player uses their browser-held session token and re-enters the existing player slot.
- If a player's browser closes mid-round, the host can continue; that player simply has no submitted clip/vote.
- If a player submits after recording closes, reject it and show the current phase.
- If no clips are submitted, return the host to lobby/recording with a clear retry option.
- Ties show all tied winners or resolve with a transparent random tiebreaker; choose and document one behavior before build. Preferred v1 behavior: show all tied winners.
- The host can remove a player in the lobby. Mid-round removal can be deferred from v1 unless needed.

## 12. Delivery milestones

1. **Foundation:** Worker Site, schema, R2 binding, room creation, join-by-code/QR, and host/player layouts.
2. **Recording round:** prompt, MediaRecorder flow, upload, submission count, host close control.
3. **Playback and voting:** anonymous playback, one-vote rule, result calculation, reveal.
4. **Polish and safety:** retries, expiry cleanup, validation, privacy notice, mobile layout, error messages.
5. **Validation:** test host plus 3–5 phone and desktop browsers first, including a player using the meeting and game on one computer, then run a 15–20-player online-meeting rehearsal.

## 13. Acceptance checklist

- A host can create a room and share a usable QR code.
- Twenty phone or computer browsers can join without accounts.
- Every joined browser can record, preview, replace, and submit one short clip.
- The host can play anonymous clips over a meeting screen share with audio.
- Every player can cast at most one vote and cannot vote for their own clip.
- Results name the winning clip creator correctly.
- The host can run another round without rejoining players.
- Ending or expiring a game removes the room data and audio.

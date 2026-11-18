# Foley Fools / Hear Say build handoff

Updated 2026-11-18. This file records the current state so work can resume without repeating the investigation.

## Goal and decisions

- Build Foley Fools as a browser version of Hear Say for an online meeting, with room codes, player names, no accounts, and up to **20 players**.
- Match Hear Say's three-round flow, short sound slots, lobby sound, voice intermissions, head-to-head voting, likes, scoring, videos, and soundboard/blooper flow. The larger player limit is the requested gameplay change.
- Include the original Hear Say media. The user stated they have written permission to redistribute it in the public repository and hosted game; the license text itself has not been supplied.
- Keep the blue, non-gradient Foley Fools presentation and the simple “Join Game” entry requested earlier. Phones and computers should both work as controllers.

## Repository and deployed game

- Public repository: <https://github.com/Deswandy/sound-party-game>.
- Active implementation branch: `codex/hearsay-parity`. The latest pushed commit before this update is `c03c30f`. The new API and browser game are currently uncommitted and must be checked, committed, and pushed.
- `main` and the private Sites deployment still run the **older simplified game**: one shared 30-second prompt per round, a single vote, no original video or intermissions. Do not describe the deployed game as Hear Say parity.
- Existing Sites URL: <https://sound-party-game.deswandywong-23.chatgpt.site>. Its private audience has not been changed.
- Project uses TypeScript, Preact, Hono, Cloudflare D1/R2, Vite, and Oxfmt. See `outputs/sound-party-game-technical-plan.md` and `package.json`.

## Investigation and assets completed

- Source game folder supplied by user: `C:\Users\Deswandy wong\Downloads\The.Jackbox.Party.Pack.11.v123\The.Jackbox.Party.Pack.11.v123\The Jackbox Party Pack 11`.
- `games/MicGame/content/en/MicGamePrompt.jet` and `MicGameVideo.jet` provide **137 prompt-scene combinations**, **96 videos**, and sound-slot durations of about **2–7.2 seconds**. There are 53 early, 61 middle, and 23 late prompts. Late scenes have three sound slots.
- `scripts/prepare-hearsay-content.mjs` generates `content/hearsay/scenes.json`, including prompt text, scene/video names, audio filenames, slot durations, and FMOD timeline information. `shared/hearsay.ts` contains the scene types, round assignment planner for 2–20 players, and matchup point/ranking helpers.
- All 96 `.usm` videos were converted with FFmpeg to MP4 in ignored `work/hearsay-media/video` (**80.4 MB**). All 96 scene FMOD events were rendered into browser M4A backing audio in ignored `work/hearsay-media/audio` (**14.2 MB**) using `scripts/render-hearsay-audio.py`. These audio files are the scene backing mixes; player recordings still need browser mixing at the correct triggers.
- The public GitHub release `hearsay-media-v1` contains 192 assets (96 MP4 + 96 M4A), totaling 99,177,182 bytes: <https://github.com/Deswandy/sound-party-game/releases/tag/hearsay-media-v1>. An unauthenticated browser probe loaded a video and audio asset successfully.
- `scripts/inspect-hearsay-events.py` uses the local FMOD 2.3.6 DLLs and MicGame banks to read each scene event's length, `PromptNOn`/`PromptNOff` markers, and programmer-sound trigger times. The latest run found 96 timelines, 285 markers, and 233 trigger events. Some recorded sounds play more than once in a scene. The timing JSON is in ignored `work/hearsay-media/event-timelines.json` and is incorporated into the generated scene manifest. One event has an extra fade marker; one single-slot event has an unnamed programmer sound, normalized to `Prompt0` by the inspector.
- The proprietary Flash game logic was inspected locally with FFDec, exported only into ignored `work/hearsay-source`. **Do not commit the decompiled source.** `outputs/hearsay-parity-map.md` summarizes the relevant behavior without copying source code.

## Mechanics confirmed from the packaged game logic

- For 2–5 players, rounds 1 and 2 give everyone two scene prompts. For 6–8, the game splits the room across two scene prompts and rotates group membership in round 2. Round 3 uses a single three-slot scene. The original tables stop at 10 players; the new planner extends the split and slot assignments to 20.
- Each sound slot has a matchup. Competing recordings play, players vote for one, and likes are separate. In a two-person matchup with other players present, the competitors sit out voting. With larger matchups, a player's own recording is hidden when at least two other choices remain.
- A 1,500-point pool is shared by vote percentage, rounded to hundreds. Likes add 20 points each. Vote ties favor fewer previous video appearances. The winner's sound enters the video; eligible runners-up can enter the blooper reel.
- Voice intermissions run BOP, DOTS, then JUMP across rounds, normally 15 seconds. Each tally awards 10 points; players tied for top tally receive a 100-point bonus. The lobby personal sound is configured for 2 seconds.
- The FMOD video event provides the backing mix and schedules the recorded sounds. `soundStarts` in the scene manifest captures every trigger; `PromptNOn`/`Off` markers control the winner overlay on the host screen.

## Immediate status and checks

- The branch now has a new per-assignment D1 model, Hono API, and Preact host/player interface. The lobby records a two-second avatar sound; rounds use a 15-second voice intermission, scene-linked recordings, matchups, votes, likes, scoring, winning-sound video playback, final results, blooper clips, and a host soundboard. Host controls and player leave/rejoin remain available.
- The BOP, DOTS, and JUMP player screens now animate a ball, snake, and jumper. Tallies require a completed loud/quiet trip, collecting a dot, or jumping an obstacle. The host sees live tallies. The server enforces the packaged game's 150 ms tally cooldown. `shared/voice-games.ts` contains the simulation, with checks in `tests/voice-games.mjs`. Migration `0005` adds the last-tally timestamp and was applied locally.
- `server/hearsay.ts`, `src/main.tsx`, `src/HearSayScene.tsx`, and `src/VoiceIntermission.tsx` hold the new flow. `tests/hearsay-api.mjs` checks three rounds, soundboard replay, and a 20-player assignment. D1 migrations `0003` and `0004` were applied to local Wrangler.
- `npm run check`, `npm run build`, `npm run format:check`, `npm run test:hearsay`, `npm run test:hearsay-api`, `npm run test:voice-games`, `npm run test:recording`, and `npm run test:game-loop` have passed locally. The host/player lobby and host intermission, recording, matchup, voting, reveal, and video screens were checked in the browser. A local AAC test tone loaded in the sound-choice player and in a winning-sound scene without media errors. Actual microphone capture and meeting screen sharing are still unverified.

## Remaining work before the game can be called complete

1. Finish a visual end-to-end run of all three rounds and the final soundboard with real players. The API test uses fake audio bytes; a separate browser run checked one scene using an encoded test tone, but microphone capture and audible meeting output remain unverified.
2. Compare the new ball, snake, and jump simulations against a live Hear Say controller. The packaged host logic confirms timing, tally cooldown, and awards, but the controller physics are not in the local game files. Add original intermission sound effects and art.
3. Add the remaining original art and narration where needed. The release contains all scene videos and backing mixes but not the game's other interface media.
4. Improve the blooper reel presentation. Runner-up sounds with a vote or like are listed and playable by the host at final results, but there is no assembled reel animation.
5. Check mobile and desktop microphone permission/refusal, actual recording formats, late upload behavior, host reconnect, and 15–20 simultaneous players. Check screen and audio sharing in a real online meeting.
6. Commit and push this branch. Apply the two new migrations to the target database and deploy after the browser checks. The existing Sites deployment is private and still runs the old simplified game.

## Useful commands

```powershell
npm run test:hearsay
npm run check
npm run format:check
gh release view hearsay-media-v1 -R Deswandy/sound-party-game --json isDraft,assets,tagName
```

The Python media scripts are preparation tools; they require the local game installation and should not run in the deployed Worker.

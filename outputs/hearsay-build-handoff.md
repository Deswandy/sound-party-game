# Foley Fools / Hear Say build handoff

Updated 2026-11-17. This file records the current state so work can resume without repeating the investigation.

## Goal and decisions

- Build Foley Fools as a browser version of Hear Say for an online meeting, with room codes, player names, no accounts, and up to **20 players**.
- Match Hear Say's three-round flow, short sound slots, lobby sound, voice intermissions, head-to-head voting, likes, scoring, videos, and soundboard/blooper flow. The larger player limit is the requested gameplay change.
- Include the original Hear Say media. The user stated they have written permission to redistribute it in the public repository and hosted game; the license text itself has not been supplied.
- Keep the blue, non-gradient Foley Fools presentation and the simple “Join Game” entry requested earlier. Phones and computers should both work as controllers.

## Repository and deployed game

- Public repository: <https://github.com/Deswandy/sound-party-game>.
- Active implementation branch: `codex/hearsay-parity`. Pushed commit `36d8c2f` contains the first content map, 20-player round planner, parity notes, and planner test. More recent media/timing work is still local and must be committed and pushed.
- `main` and the private Sites deployment still run the **older simplified game**: one shared 30-second prompt per round, a single vote, no original video or intermissions. Do not describe the deployed game as Hear Say parity.
- Existing Sites URL: <https://sound-party-game.deswandywong-23.chatgpt.site>. Its private audience has not been changed.
- Project uses TypeScript, Preact, Hono, Cloudflare D1/R2, Vite, and Oxfmt. See `outputs/sound-party-game-technical-plan.md` and `package.json`.

## Investigation and assets completed

- Source game folder supplied by user: `C:\Users\Deswandy wong\Downloads\The.Jackbox.Party.Pack.11.v123\The.Jackbox.Party.Pack.11.v123\The Jackbox Party Pack 11`.
- `games/MicGame/content/en/MicGamePrompt.jet` and `MicGameVideo.jet` provide **137 prompt-scene combinations**, **96 videos**, and sound-slot durations of about **2–7.2 seconds**. There are 53 early, 61 middle, and 23 late prompts. Late scenes have three sound slots.
- `scripts/prepare-hearsay-content.mjs` generates `content/hearsay/scenes.json`, including prompt text, scene/video names, audio filenames, slot durations, and FMOD timeline information. `shared/hearsay.ts` contains the scene types, round assignment planner for 2–20 players, and matchup point/ranking helpers.
- All 96 `.usm` videos were converted with FFmpeg to MP4 in ignored `work/hearsay-media/video` (**80.4 MB**). All 96 scene FMOD events were rendered into browser M4A backing audio in ignored `work/hearsay-media/audio` (**14.2 MB**) using `scripts/render-hearsay-audio.py`. These audio files are the scene backing mixes; player recordings still need browser mixing at the correct triggers.
- A **draft** GitHub release `hearsay-media-v1` contains 192 assets (96 MP4 + 96 M4A), totaling 99,177,182 bytes. Draft URL: <https://github.com/Deswandy/sound-party-game/releases/tag/untagged-05715934ae6f1411106f>. The release is not public yet, so its asset URLs cannot be used by unauthenticated players.
- `scripts/inspect-hearsay-events.py` uses the local FMOD 2.3.6 DLLs and MicGame banks to read each scene event's length, `PromptNOn`/`PromptNOff` markers, and programmer-sound trigger times. The latest run found 96 timelines, 285 markers, and 233 trigger events. Some recorded sounds play more than once in a scene. The timing JSON is in ignored `work/hearsay-media/event-timelines.json` and is incorporated into the generated scene manifest. One event has an extra fade marker; one single-slot event has an unnamed programmer sound, normalized to `Prompt0` by the inspector.
- The proprietary Flash game logic was inspected locally with FFDec, exported only into ignored `work/hearsay-source`. **Do not commit the decompiled source.** `outputs/hearsay-parity-map.md` summarizes the relevant behavior without copying source code.

## Mechanics confirmed from the packaged game logic

- For 2–5 players, rounds 1 and 2 give everyone two scene prompts. For 6–8, the game splits the room across two scene prompts and rotates group membership in round 2. Round 3 uses a single three-slot scene. The original tables stop at 10 players; the new planner extends the split and slot assignments to 20.
- Each sound slot has a matchup. Competing recordings play, players vote for one, and likes are separate. In a two-person matchup with other players present, the competitors sit out voting. With larger matchups, a player's own recording is hidden when at least two other choices remain.
- A 1,500-point pool is shared by vote percentage, rounded to hundreds. Likes add 20 points each. Vote ties favor fewer previous video appearances. The winner's sound enters the video; eligible runners-up can enter the blooper reel.
- Voice intermissions run BOP, DOTS, then JUMP across rounds, normally 15 seconds. Each tally awards 10 points; players tied for top tally receive a 100-point bonus. The lobby personal sound is configured for 2 seconds.
- The FMOD video event provides the backing mix and schedules the recorded sounds. `soundStarts` in the scene manifest captures every trigger; `PromptNOn`/`Off` markers control the winner overlay on the host screen.

## Immediate status and checks

- `npm run test:hearsay` passes for every room size 2–20, all scene slot durations and trigger coverage; `npm run check` passes. The scene manifest has been regenerated from the latest timing extraction.
- Current working tree has uncommitted changes to `content/hearsay/scenes.json`, `outputs/hearsay-parity-map.md`, `scripts/prepare-hearsay-content.mjs`, `shared/hearsay.ts`, and `tests/hearsay-plan.mjs`, plus new `scripts/inspect-hearsay-events.py` and `scripts/render-hearsay-audio.py`.

## Remaining work before the game can be called complete

1. Commit and push the local timing, audio preparation, and handoff changes on `codex/hearsay-parity`.
2. Replace the old one-clip/one-vote database and API with per-player sound assignments, multiple recordings per round, matchups, votes, likes, score awards, scene winners, runner-ups, and replay state. Preserve secure room/player tokens and the ability to leave or reopen the host lobby.
3. Build the player flow: 2-second lobby sound, microphone calibration, assigned short recordings with re-record and preview, voice intermissions, matchup voting/likes, and soundboard.
4. Build the host flow: shared room/lobby, recording progress and timers, one matchup at a time, synchronized MP4 + M4A + winning player sound at every `soundStarts` cue, results, scores, and blooper reel. Check meeting screen/audio sharing.
5. Convert or recreate the remaining original art, narration, and intermission sound effects needed for the requested full flow. The draft release currently contains only scene videos and their backing mixes.
6. Publish the draft media release when the game can use it, wire stable public asset URLs into the app, and deploy the new version to Sites. The existing Sites deployment must stay private unless the user requests a public audience change.
7. Run end-to-end checks with both phone and desktop controllers, host reconnect, failed uploads, microphone permission refusal, and 15–20 players. Confirm all clips and media play in a real online-meeting screen-share setup.

## Useful commands

```powershell
npm run test:hearsay
npm run check
npm run format:check
gh release view hearsay-media-v1 -R Deswandy/sound-party-game --json isDraft,assets,tagName
```

The Python media scripts are preparation tools; they require the local game installation and should not run in the deployed Worker.

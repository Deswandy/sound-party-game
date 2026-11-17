# Hear Say parity map for Foley Fools

This records the observed behaviour and configuration needed to replace Foley Fools' current gameplay. It is based on the local Party Pack 11 game data and Jackbox's public game description. It does not contain game assets, prompts, code, or credentials.

## Confirmed flow

1. **Lobby:** players join a host room, record a short personal sound (configured at 2 seconds), and become ready. The host sees readiness and starts the game.
2. **Microphone warm-up:** voice level controls a short calibration challenge.
3. **Recording:** the first two rounds present two prompts per player; the final round has three sound prompts. Prompts are associated with video scenes. The video sound slots range from about 2 to 7.2 seconds. The overall recording timer scales with player count.
4. **Listening and voting:** recordings play for the group, one matchup at a time. Players vote for one competing sound and can then like any eligible sounds. A matchup has a 1,500 point pool divided by vote share, rounded to hundreds; each like adds 20 points. A tied vote count favors the player who has appeared in fewer videos so far.
5. **Intermissions:** three voice-level games use volume to move a ball, steer a snake, or jump. They award points.
6. **Reveal and scores:** winning sounds are placed in video scenes; rounds update a scoreboard. The game is configured for three rounds, then offers replay with the same or new players.

## Confirmed values

| Setting | Local game data |
| --- | --- |
| Rounds | 3 |
| Player count in the published game | 2–8 |
| Lobby personal sound | 2 seconds |
| Video sound slots | About 2–7.2 seconds |
| Intermission game | 15 seconds |
| Like points | 20 per like |
| Intermission winner points | 100 |
| Recording phase timer | 90–210 seconds depending on player count |

## Current Foley Fools differences to correct

- The lobby has a microphone meter and ready button instead of a recorded personal sound.
- Everyone receives one shared prompt and may record for 30 seconds. Hear Say assigns scene-linked prompts and short sound slots, sometimes three per scene.
- Foley Fools plays all clips, then allows one vote per player. Hear Say also allows likes and uses matchups; this needs its exact on-screen sequence mapped before implementation.
- Foley Fools has a simple animated result card instead of a video assembled with winning sounds.
- The voice-controlled intermissions are absent.
- Foley Fools totals votes rather than Hear Say's points.
- Foley Fools supports 20 players, while the published game is designed for 2–8.

## Agreed scope

- Include Hear Say's original prompts, video, art, and audio. The user states they have written permission for redistribution in the public repository and hosted browser game.
- Keep Hear Say's short sound-slot timing and three-round structure, with capacity raised to 20 players.
- The game logic inside `MicGame.swf` has now been inspected locally to establish the matchup, like, scoring, and round assignment rules. A visual walkthrough is still useful for animation and screen timing.

## Round assignment from the packaged game logic

- Rounds 1 and 2 each select two different scene prompts. With 2–5 players, everyone gets both. With 6–8 players, the game splits players into two groups and rotates their group membership in round 2, so each player gets one scene prompt per round.
- Round 3 selects one late scene prompt with three sound slots. The original slot table gives each player a subset of those slots. Each slot becomes its own matchup.
- For each sound slot, competing players record the same requested sound. The game plays their recordings, collects votes and likes, selects a winner, and inserts the winning sound into the associated video.
- The original slot assignment table stops at 10 players. The 20-player extension needs new balanced groups and slot assignments; blindly indexing the table would fail.
- When a matchup has exactly two competitors, those two normally sit out its vote if there are other players. In larger matchups a player can vote, but their own clip is omitted if at least two other choices remain.
- The original winner selection sorts by vote count, then by fewest prior video appearances. Runner-up clips with at least one vote or like can appear in the blooper reel.

## Asset and publication feasibility

- The local game contains 96 `.usm` videos totaling about 1.45 GB, plus five FMOD audio banks totaling about 80 MB. All 96 videos converted to browser-playable MP4, totaling 80.4 MB. The converted files are currently in ignored `work/hearsay-media/video`.
- `content/hearsay/scenes.json` maps all 137 prompt-scene combinations to the 96 converted videos and their exact slot durations. This includes 53 early, 61 middle, and 23 late prompts. Late prompts have three slots.
- The FMOD banks can be decoded into individual audio tracks. The original FMOD runtime reveals the length and `PromptNOn` / `PromptNOff` timeline markers for all 96 scene events. These cues are now in `content/hearsay/scenes.json`; mapping each event's audio mix and exact recorded-sound trigger still needs work.
- Large binary assets need a delivery path that works for the deployed browser game. The current Worker build embeds text assets, so it cannot serve the 80 MB video set as is.
- All 96 converted MP4s are uploaded to a draft GitHub release tagged `hearsay-media-v1`. It is not yet public or used by the live game.

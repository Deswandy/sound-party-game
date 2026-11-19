# Foley Fools release handoff

Foley Fools is a browser party game for 2 to 20 players. The host shares their game tab and audio in a meeting. Players use a phone or computer to join by room code and display name.

The game has three rounds, a microphone warm-up and score reveal before recording, short sound assignments, voting and likes, animated scenes with the winning recordings, and a final blooper reel and soundboard. The scene catalog and prompts are in shared/foley-scenes.ts. Scene playback uses the browser audio clock to align each recording with its animation. The host can ask the browser to read the warm-up instructions aloud.

## Test before a party

1. Build the app and apply local D1 migrations. Start Wrangler on port 8787 and run the checks listed in the README.
2. In a player-accessible test environment, use a phone and a desktop to join, grant or decline microphone access, record, preview, and upload a clip. Refresh both the host and player pages to check reconnects.
3. Invite 15 to 20 players and play all three rounds. Share the host browser tab with tab audio. Have a participant on another device confirm they can hear a matchup clip and a sound inside a scene. Check the final blooper and soundboard.
4. The production Sites audience is owner-only. Group play needs a separate environment accessible to the test players.

The automated API checks cover three rounds, scoring, replay, and room capacity. Real-device audio and meeting playback require a human playtest.

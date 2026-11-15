# Sound Party Game — Behaviour Specification

## Purpose

A lightweight online party game for up to 20 active players. Players use a phone or computer browser to record short sound effects and vote; a host shares one game screen in an online meeting so the group experiences prompts, playback, and results together.

The game is an original sound-effect party game. It does not use Jackbox branding, assets, prompts, or code.

## Roles

### Host

The host runs the game from a computer and shares the game browser tab/window in Zoom, Google Meet, Discord, or another meeting tool. The host should share computer/tab audio so all players can hear submitted clips.

The host can:

- Create a room.
- See a room code and QR code.
- Start a round and select or enter a sound prompt.
- See who has joined and who has submitted a recording, without revealing recordings before playback.
- End recording early once everybody is done.
- Play clips, move between clips, and reveal results.
- Start another round or end the game.

### Player

Players open the join link on a phone or computer, enter a display name, and enter the room code if they did not join through the QR code. They need no account, password, download, or installation.

Players can:

- Join a room using a display name.
- See the current round status.
- Grant microphone permission and record one short clip for the prompt.
- Re-record before submitting.
- Vote once during the voting phase.
- See the winning result on the shared host screen.

## Online-meeting setup

1. The host starts an online meeting and shares the game screen with audio enabled.
2. Players use a phone or a browser tab on their meeting computer as the game controller.
3. The host shares the QR code or room code in the meeting.
4. Each player joins the room from their chosen device.
5. During the recording phase, players mute their meeting microphone before recording in the game browser so their audio is not duplicated or echoed through the meeting.
6. During playback, all players listen to the host's shared audio. Headphones are recommended.

## Game flow

### 1. Lobby

- The host creates a new room.
- The game generates a short, hard-to-guess room code and a QR code containing the join link.
- Players join with a display name.
- The host sees a live player list and begins when ready.
- The room supports up to 20 active players.

### 2. Prompt and recording

- The host chooses a built-in prompt or types a custom prompt.
- The host starts the round. All players see the same prompt in their browsers and a short recording timer.
- Example prompt: “Make the sound of a balloon slowly deflating.”
- A player taps Record, makes their sound, stops the recording, previews it, then submits it.
- A player may replace their clip until the recording phase ends.
- The host screen shows submission progress, such as `14 of 18 submitted`, but not clip contents.
- The host may end the phase early when everyone has submitted.

### 3. Anonymous playback

- The host plays each submitted clip through the shared screen.
- Player names remain hidden during playback.
- Players see which clip number is currently playing, for example `Clip 7 of 18`.
- The host can replay a clip.

### 4. Voting

- Once playback is complete, each player sees the list of clip numbers in their browser.
- Each player votes once for a clip. A player cannot vote for their own clip.
- Votes remain hidden until the host reveals results.
- The host can close voting early or wait for all eligible votes.

### 5. Reveal and next round

- The host screen reveals the winning clip, its creator's display name, and vote total.
- Optionally, second and third place are shown.
- The host can begin a new prompt, keeping the same room and players, or end the game.

## Constraints and privacy

- No accounts or persistent player profiles.
- A temporary browser/session identifier prevents multiple votes from the same joined device; it is not a user account.
- Audio clips belong only to the active game room and are not public or searchable.
- The host may end the room at any time.
- All room state and clips are automatically deleted when the game ends or after a short inactivity expiry.
- The game must clearly request microphone permission only when the player starts recording.
- Players should use a current Chrome or other modern browser on a phone or computer.

## Explicitly out of scope for the first version

- Chat, direct messages, friend lists, accounts, and profiles.
- Saved games, downloads, permanent leaderboards, and recording archives.
- Teams, complex scoring, moderation dashboards, and public game discovery.
- Individual video/screen playback for every player; the shared host screen is the game presentation.

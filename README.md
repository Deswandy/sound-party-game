# Sound Party Game

A browser game for online meetings with up to 20 active players. The host shares the game screen and audio; players join from a phone or computer, enter a display name, record short sound effects, and vote for their favorite clip. No accounts are required.

The implementation uses TypeScript with Preact and Vite for the browser interfaces, Hono for the API, and Cloudflare D1 and R2 for temporary game data and audio. Ticket 1 provides the host and player entry screens, shared types, schema, and API health endpoint; the game loop comes in later tickets.

## Development

Run `npm install`, then `npm run check` and `npm run build`. `npm run dev` starts the browser UI locally. The production build is a single Worker module at `dist/server/index.js` containing the browser assets and API.

## Plans

- [Game behaviour](outputs/sound-party-game-behaviour.md)
- [Technical plan](outputs/sound-party-game-technical-plan.md)

This is an original game concept and does not include Jackbox code or assets.

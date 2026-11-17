# Foley Fools

A browser game for online meetings with up to 20 active players. The host shares the game screen and audio; players join from a phone or computer, enter a display name, record short sound effects, and vote for their favorite clip. No accounts are required.

The implementation uses TypeScript with Preact and Vite for the browser interfaces, Hono for the API, and Cloudflare D1 and R2 for temporary game data and audio. Hosts can create a room and share a code, link, or QR code. Up to 20 players can join by name and return from the same browser. Players can warm up their microphone, record and replace a clip up to 30 seconds long, listen through the host's shared audio, and vote once. The host controls three rounds, reveals winners and scores, and can replay with the same players.

## Development

Run `npm install`, then `npm run check` and `npm run build`. `npm run dev` starts the browser UI locally. The production build is a single Worker module at `dist/server/index.js` containing the browser assets and API.

Run `npm run format` to format source files with Oxfmt, or `npm run format:check` to check them without changes. VS Code recommends the Oxc extension and enables format on save for this workspace.

Database migrations are generated from `db/schema.ts` with `npm run db:generate` and stored in `drizzle/`. Apply them before serving the Worker. For a local end-to-end check, run `npm run build`, `npx wrangler d1 migrations apply foley-local --local`, then `npx wrangler dev --local --port 8787`. The checked-in `wrangler.jsonc` binds local D1 and R2 resources.

With the local Worker running, `npm run test:recording` checks prompt authorization, clip replacement, the 30-second upload limit, submission counts, and late-upload rejection.
`npm run test:game-loop` checks the full three-round flow, including anonymous audio access, voting rules, ties, scores, and replay.

## Plans

- [Game behaviour](outputs/sound-party-game-behaviour.md)
- [Technical plan](outputs/sound-party-game-technical-plan.md)

This is an original game concept and does not include Jackbox code or assets.

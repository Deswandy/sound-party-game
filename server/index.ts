import { Hono } from 'hono';
import type { HealthResponse } from '../shared/game';

type Bindings = {
  DB: D1Database;
  BUCKET: R2Bucket;
};

const app = new Hono<{ Bindings: Bindings }>();

app.get('/api/health', (c) =>
  c.json<HealthResponse>({ status: 'ok', service: 'sound-party-game' }),
);

export default app;

import app from './index';
import { assets } from '../work/generated/assets';

const contentTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

export default {
  async fetch(request: Request, env: unknown, ctx: unknown): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      return app.fetch(request, env as never, ctx as never);
    }
    const path = Object.hasOwn(assets, url.pathname) ? url.pathname : '/index.html';
    const extension = path.slice(path.lastIndexOf('.'));
    return new Response(assets[path], {
      headers: {
        'content-type': contentTypes[extension] || 'text/plain; charset=utf-8',
        'cache-control':
          path === '/index.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
      },
    });
  },
};

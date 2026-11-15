import { build as viteBuild } from 'vite';
import { build as esbuild } from 'esbuild';
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, relative } from 'node:path';

await viteBuild();
const root = 'dist/client';
const files = {};

async function collect(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await collect(path);
    else files['/' + relative(root, path).replaceAll('\\', '/')] = await readFile(path, 'utf8');
  }
}

await collect(root);
await mkdir('work/generated', { recursive: true });
await writeFile('work/generated/assets.ts', `export const assets: Record<string, string> = ${JSON.stringify(files)};\n`);
await esbuild({
  entryPoints: ['server/deploy.ts'],
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: 'es2022',
  outfile: 'dist/server/index.js',
  minify: true,
});

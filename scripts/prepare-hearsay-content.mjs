import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';

const source = process.argv[2];
const videos = process.argv[3];
if (!source || !videos) {
  throw new Error(
    'Usage: node scripts/prepare-hearsay-content.mjs <MicGame/content/en> <converted-video-directory>',
  );
}

const prompts = JSON.parse(await readFile(join(source, 'MicGamePrompt.jet'), 'utf8')).content;
const scenes = JSON.parse(await readFile(join(source, 'MicGameVideo.jet'), 'utf8')).content;
const converted = new Map(
  (await readdir(videos))
    .filter((name) => name.endsWith('.mp4'))
    .map((name) => [basename(name, '.mp4').toLowerCase(), name]),
);
const byId = new Map(scenes.map((scene) => [scene.id, scene]));
const content = prompts.map((entry) => {
  const scene = byId.get(entry.videoId);
  if (!scene) throw new Error(`Missing scene ${entry.videoId}`);
  if (entry.soundsToRecord.length !== scene.durations.length) {
    throw new Error(`Slot mismatch for ${entry.id}`);
  }
  const video = converted.get(scene.name.toLowerCase());
  if (!video) throw new Error(`Missing converted video ${scene.name}`);
  return {
    id: entry.id,
    appearance: entry.appearance,
    videoId: scene.id,
    title: entry.videoTitle,
    description: scene.textDescription,
    video,
    backingTrack: scene.backingTrack,
    slots: entry.soundsToRecord.map((sound, index) => ({
      prompt: sound.prompt,
      direction: sound.direction ?? null,
      durationMs: Math.round(scene.durations[index] * 1000),
    })),
  };
});
await mkdir('content/hearsay', { recursive: true });
await writeFile('content/hearsay/scenes.json', JSON.stringify(content, null, 2) + '\n');
console.log(`Prepared ${content.length} prompt-scene combinations across ${converted.size} videos`);

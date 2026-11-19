import type { Scene } from './hearsay';

type Beat = [prompt: string, symbol: string];
type SceneIdea = [id: string, title: string, symbol: string, ...beats: Beat[]];

const sets: Record<Scene['appearance'], SceneIdea[]> = {
  EARLY: [
    [
      'moon-laundry',
      'Laundry on the Moon',
      '🌕',
      ['A spacesuit spinning in a washing machine', '🫧'],
    ],
    [
      'tiny-train',
      'The Very Small Express',
      '🚂',
      ['A tiny train braking for a giant crumb', '🍞'],
    ],
    ['umbrella-shop', 'Umbrella Repair Shop', '☔', ['An umbrella opening inside out', '💨']],
    ['toast-launch', 'Breakfast Launchpad', '🍳', ['Toast launching out of a toaster', '🍞']],
  ],
  'MID-GAME': [
    ['robot-kitchen', 'The Robot Kitchen', '🤖', ['A robot trying to whisk pancake batter', '🥞']],
    [
      'paper-boat',
      'Paper Boat Regatta',
      '⛵',
      ['A paper boat getting sucked down a bathtub drain', '🌀'],
    ],
    ['snail-mail', 'Snail Mail Express', '🐌', ['A snail stamping a mountain of letters', '✉️']],
    [
      'ice-delivery',
      'Ice Cube Delivery',
      '🧊',
      ['A cart full of ice cubes hitting a speed bump', '🛒'],
    ],
  ],
  LATE: [
    [
      'moon-market',
      'Midnight Market',
      '🌙',
      ['A metal stall rolling open', '🏪'],
      ['A stack of jars wobbling', '🫙'],
      ['A bicycle racing away with the last loaf', '🚲'],
    ],
    [
      'aquarium',
      'Aquarium After Hours',
      '🐠',
      ['A key turning in a rusty lock', '🔑'],
      ['An octopus squeezing into a bucket', '🐙'],
      ['A bucket sliding across wet tiles', '🪣'],
    ],
    [
      'garden-concert',
      'Garden Concert',
      '🌷',
      ['A sprinkler starting up', '💦'],
      ['A leaf blower swallowing a sock', '🧦'],
      ['A lawn chair folding itself', '🪑'],
    ],
  ],
};

export const FOLEY_SCENES = Object.entries(sets).flatMap(([appearance, ideas]) =>
  ideas.map(([id, title, symbol, ...beats]): Scene => ({
    id,
    videoId: id,
    appearance: appearance as Scene['appearance'],
    title,
    symbol,
    slots: beats.map(([prompt, action]) => ({ prompt, action, direction: null, durationMs: 2800 })),
  })),
);

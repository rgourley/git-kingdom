// ─── Synthetic test repos for city layout testing & title screen ──
// Used by ?test=N URL param and TitleScene background demo city.

import { KingdomMetrics } from './types';

export function generateTestRepos(count: number): KingdomMetrics[] {
  // Star counts that produce every building size in FOOTPRINT_PRESETS
  const starTiers = [
    200000, 150000, 100000, 80000, 60000, 50000,  // citadel (14-20 tiles)
    40000, 30000, 25000, 20000, 15000, 10000,      // castle (10-13 tiles)
    8000, 7000, 6000, 5000,                         // palace/keep (8-10)
    4000, 3000, 2000, 1500,                         // keep (6-7)
    1000, 800, 600, 500,                            // manor/keep (5-7)
    400, 300, 200, 150,                             // guild (4-6)
    100, 80, 60, 50, 30, 20, 10, 5,                // cottage/guild (3-5)
  ];

  // Fun fake repo names for the title screen demo
  const fakeNames = [
    'dragon-forge', 'castle-keep', 'mithril-db', 'elder-scroll',
    'rune-cli', 'tavern-api', 'knight-ui', 'quest-log',
    'enchant-js', 'grimoire', 'potion-mix', 'dungeon-gen',
    'shield-wall', 'blade-runner', 'crystal-shard', 'ember-spark',
    'iron-gate', 'shadow-realm', 'gold-mine', 'silver-stream',
    'oak-bridge', 'stone-tower', 'frost-bite', 'fire-bolt',
    'wind-walker', 'earth-shaker', 'star-fall', 'moon-rise',
    'sun-blade', 'dawn-light', 'dusk-shade', 'night-watch',
    'wolf-pack', 'eagle-eye', 'bear-claw', 'lion-heart',
  ];

  const metrics: KingdomMetrics[] = [];
  for (let i = 0; i < count; i++) {
    const stars = starTiers[i % starTiers.length];
    const variance = Math.floor(stars * 0.1 * (i / count));
    const actualStars = Math.max(2, stars - variance);
    const name = fakeNames[i % fakeNames.length] || `test-repo-${i + 1}`;
    metrics.push({
      repo: {
        full_name: `kingdom/${name}`,
        name,
        stargazers_count: actualStars,
        forks_count: Math.floor(actualStars * 0.1),
        open_issues_count: Math.floor(actualStars * 0.02),
        language: 'TypeScript',
        description: `A legendary ${name} project`,
        topics: [],
        created_at: '2020-01-01T00:00:00Z',
        pushed_at: '2024-01-01T00:00:00Z',
        size: 1000,
        default_branch: 'main',
        has_wiki: false,
        license: null,
      },
      contributors: [
        { login: `hero-${i}`, avatar_url: '', contributions: Math.floor(actualStars * 0.5) },
        { login: `sage-${i}`, avatar_url: '', contributions: Math.floor(actualStars * 0.3) },
        { login: `squire-${i}`, avatar_url: '', contributions: Math.floor(actualStars * 0.1) },
      ],
      totalCommits: Math.floor(actualStars * 0.9),
      mergedPRs: Math.floor(actualStars * 0.15),
      king: { login: `hero-${i}`, avatar_url: '', contributions: Math.floor(actualStars * 0.5) },
    });
  }
  return metrics;
}

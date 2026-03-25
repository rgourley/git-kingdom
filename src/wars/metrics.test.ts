import { describe, it, expect } from 'vitest';
import {
  aggregateKingdomMetrics,
  findEligibleBattlePairs,
  normalizeAndWeigh,
} from './metrics';

describe('aggregateKingdomMetrics', () => {
  const repos = [
    { language: 'TypeScript', stargazers: 100, recent_commits: 50, contributor_count: 5, created_recently: true },
    { language: 'TypeScript', stargazers: 200, recent_commits: 30, contributor_count: 3, created_recently: false },
    { language: 'Python', stargazers: 150, recent_commits: 80, contributor_count: 10, created_recently: true },
  ];

  it('sums stars per language as wealth', () => {
    const result = aggregateKingdomMetrics(repos);
    expect(result.get('TypeScript')?.wealth).toBe(300);
    expect(result.get('Python')?.wealth).toBe(150);
  });

  it('sums recent commits as military_strength', () => {
    const result = aggregateKingdomMetrics(repos);
    expect(result.get('TypeScript')?.military_strength).toBe(80);
    expect(result.get('Python')?.military_strength).toBe(80);
  });

  it('sums contributor count as population', () => {
    const result = aggregateKingdomMetrics(repos);
    expect(result.get('TypeScript')?.population).toBe(8);
    expect(result.get('Python')?.population).toBe(10);
  });

  it('counts recently created repos as expansion', () => {
    const result = aggregateKingdomMetrics(repos);
    expect(result.get('TypeScript')?.expansion).toBe(1);
    expect(result.get('Python')?.expansion).toBe(1);
  });
});

describe('normalizeAndWeigh', () => {
  it('computes kingdom_power as weighted blend', () => {
    const raw = { military_strength: 100, wealth: 50, population: 20, expansion: 5 };
    const allKingdoms = [
      { military_strength: 100, wealth: 100, population: 100, expansion: 100 },
      raw,
    ];
    const power = normalizeAndWeigh(raw, allKingdoms);
    expect(power).toBeCloseTo(59.5, 1);
  });
});

describe('findEligibleBattlePairs', () => {
  it('returns pairs within 10% of each other on any metric', () => {
    const rankings = [
      { language: 'TypeScript', metric: 'wealth', value: 100, rank: 1, previous_rank: 1 },
      { language: 'Python', metric: 'wealth', value: 95, rank: 2, previous_rank: 2 },
      { language: 'Rust', metric: 'wealth', value: 50, rank: 3, previous_rank: 3 },
    ];
    const adjacency = new Map([
      ['TypeScript', ['Python', 'Rust']],
      ['Python', ['TypeScript']],
      ['Rust', ['TypeScript']],
    ]);
    const activeKingdoms = new Set<string>();

    const pairs = findEligibleBattlePairs(rankings, adjacency, activeKingdoms);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toEqual({ a: 'TypeScript', b: 'Python', metric: 'wealth' });
  });

  it('excludes kingdoms already in active battles', () => {
    const rankings = [
      { language: 'TypeScript', metric: 'wealth', value: 100, rank: 1, previous_rank: 1 },
      { language: 'Python', metric: 'wealth', value: 95, rank: 2, previous_rank: 2 },
    ];
    const adjacency = new Map([['TypeScript', ['Python']], ['Python', ['TypeScript']]]);
    const activeKingdoms = new Set(['TypeScript']);

    const pairs = findEligibleBattlePairs(rankings, adjacency, activeKingdoms);
    expect(pairs).toHaveLength(0);
  });

  it('widens to 25% when fewer than 3 kingdoms', () => {
    const rankings = [
      { language: 'TypeScript', metric: 'wealth', value: 100, rank: 1, previous_rank: 1 },
      { language: 'Python', metric: 'wealth', value: 80, rank: 2, previous_rank: 2 },
    ];
    const adjacency = new Map([['TypeScript', ['Python']], ['Python', ['TypeScript']]]);
    const activeKingdoms = new Set<string>();

    const pairs = findEligibleBattlePairs(rankings, adjacency, activeKingdoms);
    expect(pairs).toHaveLength(1);
  });
});

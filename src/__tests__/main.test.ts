import { describe, it, expect, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: { Scene: class {}, GameObjects: {}, Scale: {}, Physics: {} },
}));

import { getBiome, isContentRepo, groupByLanguage } from '../main';
import type { KingdomMetrics, RepoData, ContributorData } from '../types';

function makeRepo(overrides: Partial<RepoData> = {}): RepoData {
  return {
    name: 'test-repo',
    full_name: 'user/test-repo',
    description: '',
    stargazers_count: 0,
    forks_count: 0,
    open_issues_count: 0,
    language: 'JavaScript',
    created_at: '2024-01-01T00:00:00Z',
    pushed_at: '2024-06-01T00:00:00Z',
    size: 100,
    default_branch: 'main',
    has_wiki: false,
    license: null,
    topics: [],
    ...overrides,
  };
}

function makeMetrics(overrides: Omit<Partial<KingdomMetrics>, 'repo'> & { repo?: Partial<RepoData> } = {}): KingdomMetrics {
  const { repo: repoOverrides, ...rest } = overrides;
  return {
    repo: makeRepo(repoOverrides),
    contributors: [{ login: 'alice', contributions: 10, avatar_url: '' }],
    totalCommits: 10,
    mergedPRs: 0,
    king: null,
    ...rest,
  };
}

describe('getBiome', () => {
  it('maps known languages to their biomes', () => {
    expect(getBiome('JavaScript')).toBe('grassland');
    expect(getBiome('Python')).toBe('forest');
    expect(getBiome('Rust')).toBe('volcanic');
    expect(getBiome('Go')).toBe('mountain');
    expect(getBiome('Ruby')).toBe('crystal');
    expect(getBiome('Java')).toBe('desert');
    expect(getBiome('C#')).toBe('tundra');
  });

  it('defaults to grassland for unknown languages', () => {
    expect(getBiome('Haskell')).toBe('grassland');
    expect(getBiome('Brainfuck')).toBe('grassland');
    expect(getBiome('')).toBe('grassland');
  });
});

describe('isContentRepo', () => {
  it('matches awesome-lists', () => {
    expect(isContentRepo(makeMetrics({ repo: { name: 'awesome-react' } }))).toBe(true);
    expect(isContentRepo(makeMetrics({ repo: { name: 'vue-awesome' } }))).toBe(true);
  });

  it('matches roadmaps and interview repos', () => {
    expect(isContentRepo(makeMetrics({ repo: { name: 'developer-roadmap' } }))).toBe(true);
    expect(isContentRepo(makeMetrics({ repo: { name: 'coding-interview' } }))).toBe(true);
    expect(isContentRepo(makeMetrics({ repo: { name: 'system-design-primer' } }))).toBe(true);
  });

  it('matches cheatsheets and best practices', () => {
    expect(isContentRepo(makeMetrics({ repo: { name: 'react-cheatsheet' } }))).toBe(true);
    expect(isContentRepo(makeMetrics({ repo: { name: 'node-best-practices' } }))).toBe(true);
  });

  it('rejects normal repo names', () => {
    expect(isContentRepo(makeMetrics({ repo: { name: 'react' } }))).toBe(false);
    expect(isContentRepo(makeMetrics({ repo: { name: 'express' } }))).toBe(false);
    expect(isContentRepo(makeMetrics({ repo: { name: 'my-cool-app' } }))).toBe(false);
  });
});

describe('groupByLanguage', () => {
  it('groups repos by language', () => {
    const metrics = [
      makeMetrics({ repo: { name: 'a', full_name: 'u/a', language: 'JavaScript' }, totalCommits: 5 }),
      makeMetrics({ repo: { name: 'b', full_name: 'u/b', language: 'JavaScript' }, totalCommits: 10 }),
      makeMetrics({ repo: { name: 'c', full_name: 'u/c', language: 'JavaScript' }, totalCommits: 3 }),
      makeMetrics({ repo: { name: 'd', full_name: 'u/d', language: 'Python' }, totalCommits: 7 }),
      makeMetrics({ repo: { name: 'e', full_name: 'u/e', language: 'Python' }, totalCommits: 2 }),
      makeMetrics({ repo: { name: 'f', full_name: 'u/f', language: 'Python' }, totalCommits: 1 }),
    ];

    const kingdoms = groupByLanguage(metrics);
    const jsKingdom = kingdoms.find(k => k.language === 'JavaScript');
    const pyKingdom = kingdoms.find(k => k.language === 'Python');

    expect(jsKingdom).toBeDefined();
    expect(jsKingdom!.repos).toHaveLength(3);
    expect(jsKingdom!.totalCommits).toBe(18);
    expect(jsKingdom!.biome).toBe('grassland');

    expect(pyKingdom).toBeDefined();
    expect(pyKingdom!.repos).toHaveLength(3);
    expect(pyKingdom!.totalCommits).toBe(10);
    expect(pyKingdom!.biome).toBe('forest');
  });

  it('filters out content repos', () => {
    const metrics = [
      makeMetrics({ repo: { name: 'react', full_name: 'u/react', language: 'JavaScript' } }),
      makeMetrics({ repo: { name: 'vue', full_name: 'u/vue', language: 'JavaScript' } }),
      makeMetrics({ repo: { name: 'svelte', full_name: 'u/svelte', language: 'JavaScript' } }),
      makeMetrics({ repo: { name: 'awesome-react', full_name: 'u/awesome-react', language: 'JavaScript' } }),
    ];

    const kingdoms = groupByLanguage(metrics);
    const js = kingdoms.find(k => k.language === 'JavaScript');
    expect(js!.repos).toHaveLength(3);
    expect(js!.repos.every(r => r.repo.name !== 'awesome-react')).toBe(true);
  });

  it('drops language groups with fewer than 3 repos', () => {
    const metrics = [
      makeMetrics({ repo: { name: 'a', full_name: 'u/a', language: 'JavaScript' } }),
      makeMetrics({ repo: { name: 'b', full_name: 'u/b', language: 'JavaScript' } }),
      makeMetrics({ repo: { name: 'c', full_name: 'u/c', language: 'JavaScript' } }),
      makeMetrics({ repo: { name: 'd', full_name: 'u/d', language: 'Haskell' } }),
      makeMetrics({ repo: { name: 'e', full_name: 'u/e', language: 'Haskell' } }),
    ];

    const kingdoms = groupByLanguage(metrics);
    expect(kingdoms.find(k => k.language === 'Haskell')).toBeUndefined();
    expect(kingdoms.find(k => k.language === 'JavaScript')).toBeDefined();
  });

  it('skips repos with no language', () => {
    const metrics = [
      makeMetrics({ repo: { name: 'a', full_name: 'u/a', language: null } }),
      makeMetrics({ repo: { name: 'b', full_name: 'u/b', language: 'Python' } }),
      makeMetrics({ repo: { name: 'c', full_name: 'u/c', language: 'Python' } }),
      makeMetrics({ repo: { name: 'd', full_name: 'u/d', language: 'Python' } }),
    ];

    const kingdoms = groupByLanguage(metrics);
    expect(kingdoms).toHaveLength(1);
    expect(kingdoms[0].language).toBe('Python');
  });

  it('sorts kingdoms by totalCommits descending', () => {
    const metrics = [
      makeMetrics({ repo: { name: 'a', full_name: 'u/a', language: 'Python' }, totalCommits: 1 }),
      makeMetrics({ repo: { name: 'b', full_name: 'u/b', language: 'Python' }, totalCommits: 1 }),
      makeMetrics({ repo: { name: 'c', full_name: 'u/c', language: 'Python' }, totalCommits: 1 }),
      makeMetrics({ repo: { name: 'd', full_name: 'u/d', language: 'JavaScript' }, totalCommits: 100 }),
      makeMetrics({ repo: { name: 'e', full_name: 'u/e', language: 'JavaScript' }, totalCommits: 100 }),
      makeMetrics({ repo: { name: 'f', full_name: 'u/f', language: 'JavaScript' }, totalCommits: 100 }),
    ];

    const kingdoms = groupByLanguage(metrics);
    expect(kingdoms[0].language).toBe('JavaScript');
    expect(kingdoms[1].language).toBe('Python');
  });
});

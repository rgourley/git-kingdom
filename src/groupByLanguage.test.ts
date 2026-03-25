import { describe, it, expect } from 'vitest';
import { groupByLanguage, isContentRepo, LANGUAGE_BLOCKLIST, MIN_REPOS_FOR_KINGDOM } from './groupByLanguage';
import type { KingdomMetrics } from './types';

/** Helper to create a minimal KingdomMetrics for testing */
function makeRepo(language: string | null, fullName: string, stars = 10, commits = 100): KingdomMetrics {
  const [owner, name] = (fullName || 'test/repo').split('/');
  return {
    repo: {
      full_name: fullName,
      name: name || 'repo',
      description: null,
      stargazers_count: stars,
      forks_count: 0,
      open_issues_count: 0,
      language,
      created_at: '2024-01-01',
      pushed_at: '2024-06-01',
      size: 100,
      default_branch: 'main',
      has_wiki: false,
      license: null,
      topics: [],
    },
    contributors: [
      { login: owner, contributions: commits, avatar_url: '' },
    ],
    totalCommits: commits,
    mergedPRs: 0,
    king: { login: owner, contributions: commits, avatar_url: '' },
  };
}

describe('groupByLanguage', () => {
  it('groups repos by language into kingdoms', () => {
    const repos = [
      makeRepo('TypeScript', 'a/one'),
      makeRepo('TypeScript', 'b/two'),
      makeRepo('TypeScript', 'c/three'),
      makeRepo('Python', 'd/four'),
      makeRepo('Python', 'e/five'),
      makeRepo('Python', 'f/six'),
    ];
    const kingdoms = groupByLanguage(repos);
    expect(kingdoms.find(k => k.language === 'TypeScript')?.repos.length).toBe(3);
    expect(kingdoms.find(k => k.language === 'Python')?.repos.length).toBe(3);
  });

  it('puts null-language repos into Uncharted', () => {
    const repos = [
      makeRepo(null, 'a/one'),
      makeRepo(null, 'b/two'),
      makeRepo(null, 'c/three'),
    ];
    const kingdoms = groupByLanguage(repos);
    expect(kingdoms.find(k => k.language === 'Uncharted')?.repos.length).toBe(3);
  });

  it('merges blocklisted languages into Uncharted', () => {
    const repos = [
      makeRepo('HTML', 'a/one'),
      makeRepo('HTML', 'b/two'),
      makeRepo('HTML', 'c/three'),
      makeRepo('HTML', 'd/four'),
      makeRepo('Dockerfile', 'e/five'),
    ];
    const kingdoms = groupByLanguage(repos);
    expect(kingdoms.find(k => k.language === 'HTML')).toBeUndefined();
    expect(kingdoms.find(k => k.language === 'Dockerfile')).toBeUndefined();
    expect(kingdoms.find(k => k.language === 'Uncharted')?.repos.length).toBe(5);
  });

  it('merges languages below threshold into Uncharted', () => {
    const repos = [
      makeRepo('Zig', 'a/one'),
      makeRepo('Zig', 'b/two'), // only 2 Zig repos — below threshold of 3
      makeRepo('TypeScript', 'c/three'),
      makeRepo('TypeScript', 'd/four'),
      makeRepo('TypeScript', 'e/five'),
    ];
    const kingdoms = groupByLanguage(repos);
    expect(kingdoms.find(k => k.language === 'Zig')).toBeUndefined();
    expect(kingdoms.find(k => k.language === 'TypeScript')?.repos.length).toBe(3);
    const uncharted = kingdoms.find(k => k.language === 'Uncharted');
    expect(uncharted?.repos.length).toBe(2);
  });

  it('keeps languages at exactly the threshold', () => {
    const repos = Array.from({ length: MIN_REPOS_FOR_KINGDOM }, (_, i) =>
      makeRepo('Lua', `lua/repo-${i}`)
    );
    const kingdoms = groupByLanguage(repos);
    expect(kingdoms.find(k => k.language === 'Lua')?.repos.length).toBe(MIN_REPOS_FOR_KINGDOM);
  });

  it('does not lose repos when merging multiple sub-threshold languages', () => {
    const repos = [
      makeRepo('Zig', 'a/one'),
      makeRepo('Scala', 'b/two'),
      makeRepo('Elixir', 'c/three'),
    ];
    const kingdoms = groupByLanguage(repos);
    // All three should end up in Uncharted
    expect(kingdoms.length).toBe(1);
    expect(kingdoms[0].language).toBe('Uncharted');
    expect(kingdoms[0].repos.length).toBe(3);
  });

  it('calculates king correctly from contributors', () => {
    const repos = [
      makeRepo('Go', 'a/one', 10, 500),
      makeRepo('Go', 'b/two', 10, 200),
      makeRepo('Go', 'c/three', 10, 100),
    ];
    const kingdoms = groupByLanguage(repos);
    const go = kingdoms.find(k => k.language === 'Go');
    expect(go?.king?.login).toBe('a');
    expect(go?.totalCommits).toBe(800);
  });

  it('calculates totalStars correctly', () => {
    const repos = [
      makeRepo('Rust', 'a/one', 1000),
      makeRepo('Rust', 'b/two', 500),
      makeRepo('Rust', 'c/three', 250),
    ];
    const kingdoms = groupByLanguage(repos);
    expect(kingdoms.find(k => k.language === 'Rust')?.totalStars).toBe(1750);
  });

  it('sorts kingdoms by total commits descending', () => {
    const repos = [
      makeRepo('Go', 'a/one', 10, 100),
      makeRepo('Go', 'b/two', 10, 100),
      makeRepo('Go', 'c/three', 10, 100),
      makeRepo('Rust', 'd/four', 10, 1000),
      makeRepo('Rust', 'e/five', 10, 1000),
      makeRepo('Rust', 'f/six', 10, 1000),
    ];
    const kingdoms = groupByLanguage(repos);
    expect(kingdoms[0].language).toBe('Rust');
    expect(kingdoms[1].language).toBe('Go');
  });
});

describe('isContentRepo', () => {
  it('filters awesome-lists', () => {
    expect(isContentRepo(makeRepo('TypeScript', 'user/awesome-typescript'))).toBe(true);
    expect(isContentRepo(makeRepo('Python', 'user/python-awesome'))).toBe(true);
  });

  it('filters roadmaps', () => {
    expect(isContentRepo(makeRepo('TypeScript', 'user/developer-roadmap'))).toBe(true);
  });

  it('filters interview repos', () => {
    expect(isContentRepo(makeRepo('Python', 'user/coding-interview'))).toBe(true);
  });

  it('does not filter normal repos', () => {
    expect(isContentRepo(makeRepo('TypeScript', 'facebook/react'))).toBe(false);
    expect(isContentRepo(makeRepo('Rust', 'tokio-rs/tokio'))).toBe(false);
  });

  it('content repos are excluded from kingdoms', () => {
    const repos = [
      makeRepo('TypeScript', 'user/awesome-typescript'),
      makeRepo('TypeScript', 'a/real-repo'),
      makeRepo('TypeScript', 'b/another'),
      makeRepo('TypeScript', 'c/third'),
    ];
    const kingdoms = groupByLanguage(repos);
    const ts = kingdoms.find(k => k.language === 'TypeScript');
    expect(ts?.repos.length).toBe(3); // awesome-typescript excluded
    expect(ts?.repos.find(r => r.repo.name === 'awesome-typescript')).toBeUndefined();
  });
});

describe('LANGUAGE_BLOCKLIST', () => {
  it('includes HTML, CSS, Dockerfile', () => {
    expect(LANGUAGE_BLOCKLIST.has('HTML')).toBe(true);
    expect(LANGUAGE_BLOCKLIST.has('CSS')).toBe(true);
    expect(LANGUAGE_BLOCKLIST.has('Dockerfile')).toBe(true);
  });

  it('does not include real programming languages', () => {
    expect(LANGUAGE_BLOCKLIST.has('TypeScript')).toBe(false);
    expect(LANGUAGE_BLOCKLIST.has('Python')).toBe(false);
    expect(LANGUAGE_BLOCKLIST.has('Rust')).toBe(false);
    expect(LANGUAGE_BLOCKLIST.has('Lua')).toBe(false);
    expect(LANGUAGE_BLOCKLIST.has('Shell')).toBe(false);
  });
});

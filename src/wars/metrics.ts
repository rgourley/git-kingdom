export interface RawMetrics {
  military_strength: number;
  wealth: number;
  population: number;
  expansion: number;
}

export interface RepoRow {
  language: string;
  stargazers: number;
  recent_commits: number;
  contributor_count: number;
  created_recently: boolean;
}

export function aggregateKingdomMetrics(repos: RepoRow[]): Map<string, RawMetrics> {
  const map = new Map<string, RawMetrics>();
  for (const repo of repos) {
    const lang = repo.language;
    if (!lang) continue;
    const existing = map.get(lang) ?? { military_strength: 0, wealth: 0, population: 0, expansion: 0 };
    existing.military_strength += repo.recent_commits;
    existing.wealth += repo.stargazers;
    existing.population += repo.contributor_count;
    existing.expansion += repo.created_recently ? 1 : 0;
    map.set(lang, existing);
  }
  return map;
}

export function normalizeAndWeigh(raw: RawMetrics, allKingdoms: RawMetrics[]): number {
  const maxes = {
    military_strength: Math.max(1, ...allKingdoms.map(k => k.military_strength)),
    wealth: Math.max(1, ...allKingdoms.map(k => k.wealth)),
    population: Math.max(1, ...allKingdoms.map(k => k.population)),
    expansion: Math.max(1, ...allKingdoms.map(k => k.expansion)),
  };
  return (
    40 * (raw.military_strength / maxes.military_strength) +
    30 * (raw.wealth / maxes.wealth) +
    20 * (raw.population / maxes.population) +
    10 * (raw.expansion / maxes.expansion)
  );
}

interface RankingRow {
  language: string;
  metric: string;
  value: number;
  rank: number;
  previous_rank: number;
}

interface BattlePair {
  a: string;
  b: string;
  metric: string;
}

export function findEligibleBattlePairs(
  rankings: RankingRow[],
  adjacency: Map<string, string[]>,
  activeKingdoms: Set<string>,
): BattlePair[] {
  const uniqueLanguages = new Set(rankings.map(r => r.language));
  const threshold = uniqueLanguages.size < 3 ? 0.25 : 0.10;

  const byMetric = new Map<string, RankingRow[]>();
  for (const r of rankings) {
    if (r.metric === 'kingdom_power') continue;
    const arr = byMetric.get(r.metric) ?? [];
    arr.push(r);
    byMetric.set(r.metric, arr);
  }

  const pairs: BattlePair[] = [];
  const seen = new Set<string>();

  for (const [metric, rows] of byMetric) {
    for (let i = 0; i < rows.length; i++) {
      for (let j = i + 1; j < rows.length; j++) {
        const a = rows[i];
        const b = rows[j];
        if (activeKingdoms.has(a.language) || activeKingdoms.has(b.language)) continue;
        const neighbors = adjacency.get(a.language) ?? [];
        if (!neighbors.includes(b.language)) continue;
        const max = Math.max(a.value, b.value);
        if (max === 0) continue;
        const diff = Math.abs(a.value - b.value) / max;
        if (diff > threshold) continue;
        const key = [a.language, b.language].sort().join(':') + ':' + metric;
        if (seen.has(key)) continue;
        seen.add(key);
        const pair = a.rank <= b.rank
          ? { a: a.language, b: b.language, metric }
          : { a: b.language, b: a.language, metric };
        pairs.push(pair);
      }
    }
  }

  return pairs;
}

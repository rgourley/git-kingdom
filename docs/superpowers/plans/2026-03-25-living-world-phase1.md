# Phase 1: Living World — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a live event feed, citizen thought bubbles, and kingdom wars/battles to make GitKingdom feel like a living, competitive world.

**Architecture:** Three features layered onto the existing Phaser + Vercel serverless + Supabase stack. A new `world_events` table acts as the event backbone. A new cron job (`/api/cron/kingdom-wars`) handles ranking aggregation, battle progression, and event generation. Frontend adds an event feed panel, thought bubble system, and leaderboard panel to the existing scenes.

**Tech Stack:** TypeScript, Phaser 3, Supabase PostgreSQL, Vercel serverless functions, Vitest

**Spec:** `docs/superpowers/specs/2026-03-25-living-world-phase1-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `api/events.ts` | GET /api/events — returns recent world events |
| `api/cron/kingdom-wars.ts` | Cron endpoint — rankings, battles, event generation, pruning |
| `src/events/EventFeed.ts` | Frontend event feed panel (fetch, replay, render, navigate) |
| `src/events/types.ts` | WorldEvent interface and event type constants |
| `src/citizens/ThoughtBubble.ts` | Thought bubble rendering (ambient, hover, fallback lines) |
| `src/wars/LeaderboardPanel.ts` | Rankings + active battles panel UI |
| `src/wars/types.ts` | KingdomRanking, KingdomBattle interfaces |
| `src/wars/metrics.ts` | Pure functions: metric aggregation, adjacency, battle eligibility |
| `src/wars/metrics.test.ts` | Unit tests for metric aggregation and battle logic |
| `src/events/EventFeed.test.ts` | Unit tests for event formatting and replay queue logic |
| `api/rankings.ts` | GET /api/rankings — returns kingdom rankings and battles |
| `src/events/initEventFeed.ts` | Shared event feed initialization (used by both scenes) |

### Modified Files

| File | What Changes |
|------|-------------|
| `src/types.ts` | Add `last_commit_message` to `ContributorData` |
| `src/scenes/CityScene.ts` | Integrate ThoughtBubble + EventFeed |
| `src/scenes/WorldScene.ts` | Integrate EventFeed + LeaderboardPanel + crown icon |
| `api/world/join.ts` | Write `citizen_joined` event after successful join |
| `api/repo/add.ts` | Write `repo_added` event after successful add |
| `api/citizen.ts` | Include `last_commit_message` in response |
| `api/lib/github-server.ts` | Fetch last commit message during contributor fetch |
| `vercel.json` | Add kingdom-wars cron schedule |

---

## Task 1: Database Schema — world_events table

**Files:**
- No code files — Supabase SQL migration

- [ ] **Step 1: Create world_events table in Supabase**

Run this SQL in the Supabase SQL editor (or via migration):

```sql
CREATE TABLE world_events (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_world_events_created_at ON world_events (created_at DESC);

-- Add RLS policy (public read, service-role write)
ALTER TABLE world_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read" ON world_events FOR SELECT USING (true);
CREATE POLICY "Service write" ON world_events FOR INSERT WITH CHECK (true);
CREATE POLICY "Service delete" ON world_events FOR DELETE USING (true);
```

- [ ] **Step 2: Verify table exists**

Query the table from Supabase dashboard or via:
```bash
curl -s "https://<project>.supabase.co/rest/v1/world_events?select=id&limit=1" \
  -H "apikey: <anon-key>"
```
Expected: empty array `[]`

- [ ] **Step 3: Commit** (no code change — document the migration)

```bash
git commit --allow-empty -m "chore: add world_events table to Supabase"
```

---

## Task 2: Database Schema — kingdom_rankings and kingdom_battles tables

**Files:**
- No code files — Supabase SQL migration

- [ ] **Step 1: Create kingdom_rankings table**

```sql
CREATE TABLE kingdom_rankings (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  language text NOT NULL,
  metric text NOT NULL,
  value numeric NOT NULL DEFAULT 0,
  rank integer NOT NULL DEFAULT 0,
  previous_rank integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(language, metric)
);
```

- [ ] **Step 2: Create kingdom_battles table**

```sql
CREATE TABLE kingdom_battles (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  kingdom_a text NOT NULL,
  kingdom_b text NOT NULL,
  metric text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'active',
  rounds jsonb NOT NULL DEFAULT '[]',
  winner text
);

CREATE INDEX idx_kingdom_battles_status ON kingdom_battles (status) WHERE status = 'active';
```

- [ ] **Step 3: Add RLS policies**

```sql
ALTER TABLE kingdom_rankings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read" ON kingdom_rankings FOR SELECT USING (true);
CREATE POLICY "Service write" ON kingdom_rankings FOR ALL USING (true);

ALTER TABLE kingdom_battles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read" ON kingdom_battles FOR SELECT USING (true);
CREATE POLICY "Service write" ON kingdom_battles FOR ALL USING (true);
```

- [ ] **Step 4: Verify both tables**

Query both tables from Supabase dashboard. Expected: empty arrays.

- [ ] **Step 5: Commit**

```bash
git commit --allow-empty -m "chore: add kingdom_rankings and kingdom_battles tables to Supabase"
```

---

## Task 3: Add last_commit_message to contributor data pipeline

**Files:**
- Modify: `api/lib/github-server.ts:128-179` (fetchRepoMetrics)
- Modify: `src/types.ts:18-22` (ContributorData interface)

- [ ] **Step 1: Add last_commit_message to ContributorData interface**

In `src/types.ts`, update:

```typescript
export interface ContributorData {
  login: string;
  contributions: number;
  avatar_url: string;
  last_commit_message?: string;
}
```

- [ ] **Step 2: Fetch last commit message in github-server.ts**

In `api/lib/github-server.ts`, inside `fetchRepoMetrics()`, after fetching contributors, add a call to fetch the most recent commit for each top contributor. Add this helper above `fetchRepoMetrics`:

```typescript
async function fetchLastCommitMessage(
  owner: string,
  repo: string,
  author: string,
  token: string
): Promise<string | undefined> {
  try {
    const res = await fetch(
      `${GH_API}/repos/${owner}/${repo}/commits?author=${author}&per_page=1`,
      { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.v3+json' } }
    );
    if (!res.ok) return undefined;
    const commits = await res.json();
    if (commits.length > 0 && commits[0].commit?.message) {
      const msg = commits[0].commit.message.split('\n')[0]; // first line only
      return msg.length > 80 ? msg.slice(0, 77) + '...' : msg;
    }
  } catch { /* silent */ }
  return undefined;
}
```

Then in `fetchRepoMetrics`, after building the contributors array, enrich the top 5 contributors with their last commit messages (balances API calls vs coverage for ambient thoughts):

```typescript
const topContributors = contributors.slice(0, 5);
await Promise.all(
  topContributors.map(async (c) => {
    c.last_commit_message = await fetchLastCommitMessage(owner, repo, c.login, token);
  })
);
```

This ensures enough citizens have commit messages for the ambient thought system to draw from, while keeping API calls bounded (max 5 per repo).

- [ ] **Step 3: Run existing tests to verify no regression**

```bash
npx vitest run
```
Expected: All existing tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/types.ts api/lib/github-server.ts
git commit -m "feat: add last_commit_message to contributor data pipeline"
```

---

## Task 4: Events API endpoint

**Files:**
- Create: `api/events.ts`
- Create: `src/events/types.ts`

- [ ] **Step 1: Create event types**

Create `src/events/types.ts`:

```typescript
export type WorldEventType =
  | 'citizen_joined'
  | 'repo_added'
  | 'kingdom_rank_changed'
  | 'battle_started'
  | 'battle_round'
  | 'battle_resolved';
  | 'building_upgraded';

export interface WorldEvent {
  id: string;
  event_type: WorldEventType;
  payload: Record<string, unknown>;
  created_at: string;
}
```

- [ ] **Step 2: Create events API endpoint**

Create `api/events.ts`:

```typescript
/**
 * GET /api/events?since=<ISO timestamp>
 * Returns recent world events for the live feed.
 * Public — no auth required.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createServiceClient } from './lib/supabase';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const since = typeof req.query.since === 'string'
    ? req.query.since
    : new Date(Date.now() - 60 * 60 * 1000).toISOString(); // default: 1 hour ago

  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from('world_events')
      .select('id, event_type, payload, created_at')
      .gte('created_at', since)
      .order('created_at', { ascending: true })
      .limit(50);

    if (error) {
      console.error('[api/events] Query failed:', error.message);
      return res.status(500).json({ error: 'Query failed' });
    }

    res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');
    return res.json(data ?? []);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[api/events] Fatal:', msg);
    return res.status(500).json({ error: msg });
  }
}
```

- [ ] **Step 3: Test locally**

```bash
npx vercel dev
# In another terminal:
curl http://localhost:3000/api/events
```
Expected: `[]` (empty array, no events yet)

- [ ] **Step 4: Commit**

```bash
git add api/events.ts src/events/types.ts
git commit -m "feat: add /api/events endpoint for live event feed"
```

---

## Task 5: Write events from existing endpoints (join + add)

**Files:**
- Modify: `api/world/join.ts`
- Modify: `api/repo/add.ts`

- [ ] **Step 1: Add event helper function**

Create `api/lib/events.ts`:

```typescript
import { createServiceClient } from './supabase';

export async function writeEvent(
  event_type: string,
  payload: Record<string, unknown>
): Promise<void> {
  try {
    const supabase = createServiceClient();
    await supabase.from('world_events').insert({ event_type, payload });
  } catch (err) {
    // Fire-and-forget — never block the main operation
    console.error('[events] Failed to write event:', err);
  }
}
```

- [ ] **Step 2: Write citizen_joined event in join.ts**

In `api/world/join.ts`, after the successful upsert (near the end of the try block, before the response), add:

```typescript
import { writeEvent } from '../lib/events';

// ... after successful join logic:
await writeEvent('citizen_joined', {
  username: login,
  repo_count: metrics.length,
});
```

- [ ] **Step 3: Write repo_added event in add.ts**

In `api/repo/add.ts`, after the successful upsert (before the success response), add:

```typescript
import { writeEvent } from '../lib/events';

// ... after successful add logic:
await writeEvent('repo_added', {
  repo: `${owner}/${repo}`,
  language: metrics.repo.language,
  stars: metrics.repo.stargazers_count,
});
```

- [ ] **Step 4: Test by adding a repo locally and checking events**

```bash
# Add a repo via the form, then check:
curl http://localhost:3000/api/events
```
Expected: Array with one `repo_added` event

- [ ] **Step 5: Commit**

```bash
git add api/lib/events.ts api/world/join.ts api/repo/add.ts
git commit -m "feat: write world events from join and add-repo endpoints"
```

---

## Task 6: Kingdom wars metrics — pure functions + tests

**Files:**
- Create: `src/wars/types.ts`
- Create: `src/wars/metrics.ts`
- Create: `src/wars/metrics.test.ts`

- [ ] **Step 1: Create war types**

Create `src/wars/types.ts`:

```typescript
export interface KingdomRanking {
  language: string;
  metric: string;
  value: number;
  rank: number;
  previous_rank: number;
}

export type WarMetric = 'military_strength' | 'wealth' | 'population' | 'expansion' | 'kingdom_power';

export interface BattleRound {
  day: number;
  a_delta: number;
  b_delta: number;
}

export interface KingdomBattle {
  id: string;
  kingdom_a: string;
  kingdom_b: string;
  metric: WarMetric;
  started_at: string;
  ends_at: string;
  status: 'active' | 'resolved';
  rounds: BattleRound[];
  winner: string | null;
}
```

- [ ] **Step 2: Write failing tests for metric aggregation**

Create `src/wars/metrics.test.ts`:

```typescript
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
    // 40% * (100/100) + 30% * (50/100) + 20% * (20/100) + 10% * (5/100)
    // = 0.4 + 0.15 + 0.04 + 0.005 = 0.595 → 59.5
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
    const activeKingdoms = new Set<string>(); // none in active battles

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
    expect(pairs).toHaveLength(1); // 20% diff, within widened 25% threshold
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
npx vitest run src/wars/metrics.test.ts
```
Expected: FAIL — module not found

- [ ] **Step 4: Implement metrics.ts**

Create `src/wars/metrics.ts`:

```typescript
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

  // Group rankings by metric
  const byMetric = new Map<string, RankingRow[]>();
  for (const r of rankings) {
    if (r.metric === 'kingdom_power') continue; // only individual metrics
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

        // Check adjacency
        const neighbors = adjacency.get(a.language) ?? [];
        if (!neighbors.includes(b.language)) continue;

        // Check within threshold
        const max = Math.max(a.value, b.value);
        if (max === 0) continue;
        const diff = Math.abs(a.value - b.value) / max;
        if (diff > threshold) continue;

        const key = [a.language, b.language].sort().join(':') + ':' + metric;
        if (seen.has(key)) continue;
        seen.add(key);

        // Higher rank (lower number) is kingdom_a (defender)
        const pair = a.rank <= b.rank
          ? { a: a.language, b: b.language, metric }
          : { a: b.language, b: a.language, metric };
        pairs.push(pair);
      }
    }
  }

  return pairs;
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx vitest run src/wars/metrics.test.ts
```
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/wars/types.ts src/wars/metrics.ts src/wars/metrics.test.ts
git commit -m "feat: add kingdom war metrics aggregation and battle eligibility logic"
```

---

## Task 7: Kingdom wars cron endpoint

**Files:**
- Create: `api/cron/kingdom-wars.ts`
- Modify: `vercel.json:4-8`

- [ ] **Step 1: Create the cron endpoint**

Create `api/cron/kingdom-wars.ts`:

```typescript
/**
 * GET /api/cron/kingdom-wars
 *
 * Runs every 6 hours. Aggregates kingdom metrics, updates rankings,
 * progresses active battles, resolves finished battles, sparks new battles,
 * and prunes old events.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createServiceClient } from '../lib/supabase';
import { writeEvent } from '../lib/events';

const METRICS = ['military_strength', 'wealth', 'population', 'expansion'] as const;
const BATTLE_DURATION_DAYS = { min: 3, max: 5 };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.authorization;
  const isCron = cronSecret && authHeader === `Bearer ${cronSecret}`;
  const isQuerySecret = cronSecret && req.query.secret === cronSecret;

  if (!isCron && !isQuerySecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const supabase = createServiceClient();
  const stats = { rankings_updated: 0, battles_progressed: 0, battles_resolved: 0, battles_started: 0, events_pruned: 0 };

  try {
    // ── Step 1: Aggregate metrics from repos + contributors ──
    const { data: repos } = await supabase
      .from('repos')
      .select('language, stargazers, full_name, owner_login, created_at, pushed_at');

    const { data: contributors } = await supabase
      .from('contributors')
      .select('repo_id, login, contributions');

    if (!repos) {
      return res.status(500).json({ error: 'Failed to fetch repos' });
    }

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    // Build per-language metrics
    const langMetrics = new Map<string, { military_strength: number; wealth: number; population: number; expansion: number }>();

    for (const repo of repos) {
      const lang = repo.language;
      if (!lang) continue;
      const m = langMetrics.get(lang) ?? { military_strength: 0, wealth: 0, population: 0, expansion: 0 };
      m.wealth += repo.stargazers ?? 0;
      if (repo.pushed_at && repo.pushed_at >= thirtyDaysAgo) {
        // Count contributor commits for recently active repos
        const repoContribs = (contributors ?? []).filter(c =>
          c.repo_id === repo.full_name || c.repo_id === repo.full_name?.toLowerCase()
        );
        m.military_strength += repoContribs.reduce((sum, c) => sum + (c.contributions ?? 0), 0);
        m.population += repoContribs.length;
      }
      if (repo.created_at && repo.created_at >= thirtyDaysAgo) {
        m.expansion += 1;
      }
      langMetrics.set(lang, m);
    }

    // ── Step 2: Compute rankings per metric + kingdom_power ──
    // Normalize for kingdom_power
    const allMetrics = Array.from(langMetrics.values());
    const maxes = {
      military_strength: Math.max(1, ...allMetrics.map(m => m.military_strength)),
      wealth: Math.max(1, ...allMetrics.map(m => m.wealth)),
      population: Math.max(1, ...allMetrics.map(m => m.population)),
      expansion: Math.max(1, ...allMetrics.map(m => m.expansion)),
    };

    const allRankings: { language: string; metric: string; value: number }[] = [];

    for (const [lang, m] of langMetrics) {
      for (const metric of METRICS) {
        allRankings.push({ language: lang, metric, value: m[metric] });
      }
      // Kingdom power
      const power =
        40 * (m.military_strength / maxes.military_strength) +
        30 * (m.wealth / maxes.wealth) +
        20 * (m.population / maxes.population) +
        10 * (m.expansion / maxes.expansion);
      allRankings.push({ language: lang, metric: 'kingdom_power', value: Math.round(power * 10) / 10 });
    }

    // Sort by value desc per metric to assign ranks
    const byMetric = new Map<string, typeof allRankings>();
    for (const r of allRankings) {
      const arr = byMetric.get(r.metric) ?? [];
      arr.push(r);
      byMetric.set(r.metric, arr);
    }

    // Fetch previous rankings
    const { data: prevRankings } = await supabase
      .from('kingdom_rankings')
      .select('language, metric, rank');

    const prevRankMap = new Map<string, number>();
    for (const pr of prevRankings ?? []) {
      prevRankMap.set(`${pr.language}:${pr.metric}`, pr.rank);
    }

    // Upsert new rankings
    const upsertRows: { language: string; metric: string; value: number; rank: number; previous_rank: number; updated_at: string }[] = [];

    for (const [metric, rows] of byMetric) {
      rows.sort((a, b) => b.value - a.value);
      rows.forEach((row, i) => {
        const rank = i + 1;
        const prevRank = prevRankMap.get(`${row.language}:${metric}`) ?? rank;
        upsertRows.push({
          language: row.language,
          metric,
          value: row.value,
          rank,
          previous_rank: prevRank,
          updated_at: new Date().toISOString(),
        });

        // Write rank change events
        if (prevRank !== rank && metric === 'kingdom_power') {
          const direction = rank < prevRank ? 'rises' : 'falls';
          writeEvent('kingdom_rank_changed', {
            kingdom: row.language,
            metric: 'Kingdom Power',
            old_rank: prevRank,
            new_rank: rank,
            message: `${row.language} ${direction} to #${rank} in Kingdom Power`,
          });
        }
      });
    }

    if (upsertRows.length > 0) {
      await supabase.from('kingdom_rankings').upsert(upsertRows, { onConflict: 'language,metric' });
      stats.rankings_updated = upsertRows.length;
    }

    // ── Step 3: Progress active battles ──
    const { data: activeBattles } = await supabase
      .from('kingdom_battles')
      .select('*')
      .eq('status', 'active');

    for (const battle of activeBattles ?? []) {
      const now = new Date();
      const ends = new Date(battle.ends_at);
      const aMetrics = langMetrics.get(battle.kingdom_a);
      const bMetrics = langMetrics.get(battle.kingdom_b);
      const metric = battle.metric as keyof typeof maxes;
      const aValue = aMetrics?.[metric] ?? 0;
      const bValue = bMetrics?.[metric] ?? 0;

      const rounds: { day: number; a_delta: number; b_delta: number }[] = battle.rounds ?? [];
      const dayNum = rounds.length + 1;

      // Compute deltas since last round (or since battle start)
      const prevATotal = rounds.reduce((s, r) => s + r.a_delta, 0);
      const prevBTotal = rounds.reduce((s, r) => s + r.b_delta, 0);
      const aDelta = Math.max(0, aValue - prevATotal);
      const bDelta = Math.max(0, bValue - prevBTotal);

      rounds.push({ day: dayNum, a_delta: aDelta, b_delta: bDelta });

      if (now >= ends) {
        // ── Step 4: Resolve battle ──
        const aTotalGain = rounds.reduce((s, r) => s + r.a_delta, 0);
        const bTotalGain = rounds.reduce((s, r) => s + r.b_delta, 0);
        // Tie goes to defender (kingdom_a)
        const winner = aTotalGain >= bTotalGain ? battle.kingdom_a : battle.kingdom_b;
        const loser = winner === battle.kingdom_a ? battle.kingdom_b : battle.kingdom_a;

        await supabase
          .from('kingdom_battles')
          .update({ status: 'resolved', rounds, winner })
          .eq('id', battle.id);

        await writeEvent('battle_resolved', {
          battle_id: battle.id,
          winner,
          loser,
          metric: battle.metric,
          message: `${winner} triumphs over ${loser} in the battle for ${battle.metric}!`,
        });

        stats.battles_resolved++;
      } else {
        // Just update rounds
        await supabase
          .from('kingdom_battles')
          .update({ rounds })
          .eq('id', battle.id);

        await writeEvent('battle_round', {
          battle_id: battle.id,
          kingdom_a: battle.kingdom_a,
          kingdom_b: battle.kingdom_b,
          day: dayNum,
          a_delta: aDelta,
          b_delta: bDelta,
          message: `Day ${dayNum}: ${battle.kingdom_a} ${aDelta > bDelta ? 'pushes forward' : 'falls behind'} (+${aDelta} vs +${bDelta})`,
        });

        stats.battles_progressed++;
      }
    }

    // ── Step 5: Spark new battles ──
    const activeKingdoms = new Set<string>();
    for (const b of activeBattles ?? []) {
      activeKingdoms.add(b.kingdom_a);
      activeKingdoms.add(b.kingdom_b);
    }

    // Build adjacency from world data.
    // Fetch the pre-baked default-world.json which contains repo language data.
    // Derive adjacency from the WorldGenerator's flood-fill ownership grid:
    // two kingdoms are neighbors if their territories share a border.
    // Since the cron runs server-side without Phaser, we compute adjacency from
    // the language list — languages that co-occur in the same user's repos are
    // considered "adjacent" (they share citizens who move between kingdoms).
    // This is a pragmatic server-side proxy for visual adjacency.
    const langUsers = new Map<string, Set<string>>();
    for (const c of contributors ?? []) {
      const repo = repos.find(r => r.full_name === c.repo_id);
      if (!repo?.language) continue;
      const set = langUsers.get(repo.language) ?? new Set();
      set.add(c.login);
      langUsers.set(repo.language, set);
    }

    const adjacency = new Map<string, string[]>();
    const languages = Array.from(langMetrics.keys());
    for (const langA of languages) {
      const neighbors: string[] = [];
      const usersA = langUsers.get(langA) ?? new Set();
      for (const langB of languages) {
        if (langA === langB) continue;
        const usersB = langUsers.get(langB) ?? new Set();
        // Adjacent if they share at least one contributor
        const shared = [...usersA].some(u => usersB.has(u));
        if (shared) neighbors.push(langB);
      }
      // Fallback: if no shared users, consider all kingdoms adjacent (small worlds)
      adjacency.set(langA, neighbors.length > 0 ? neighbors : languages.filter(l => l !== langA));
    }

    // Find eligible pairs
    const uniqueLanguages = new Set(upsertRows.map(r => r.language));
    const threshold = uniqueLanguages.size < 3 ? 0.25 : 0.10;

    const eligiblePairs: { a: string; b: string; metric: string }[] = [];
    for (const metric of METRICS) {
      const rows = upsertRows
        .filter(r => r.metric === metric)
        .sort((a, b) => b.value - a.value);

      for (let i = 0; i < rows.length; i++) {
        for (let j = i + 1; j < rows.length; j++) {
          const a = rows[i];
          const b = rows[j];
          if (activeKingdoms.has(a.language) || activeKingdoms.has(b.language)) continue;
          const neighbors = adjacency.get(a.language) ?? [];
          if (!neighbors.includes(b.language)) continue;
          const max = Math.max(a.value, b.value);
          if (max === 0) continue;
          if (Math.abs(a.value - b.value) / max > threshold) continue;
          eligiblePairs.push({ a: a.language, b: b.language, metric });
        }
      }
    }

    // Start at most 1 new battle
    if (eligiblePairs.length > 0) {
      const pick = eligiblePairs[Math.floor(Math.random() * eligiblePairs.length)];
      const durationDays = BATTLE_DURATION_DAYS.min + Math.floor(Math.random() * (BATTLE_DURATION_DAYS.max - BATTLE_DURATION_DAYS.min + 1));
      const endsAt = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString();

      const metricDisplayNames: Record<string, string> = {
        military_strength: 'Military Strength',
        wealth: 'Wealth',
        population: 'Population',
        expansion: 'Expansion',
      };

      await supabase.from('kingdom_battles').insert({
        kingdom_a: pick.a,
        kingdom_b: pick.b,
        metric: pick.metric,
        ends_at: endsAt,
        status: 'active',
        rounds: [],
      });

      await writeEvent('battle_started', {
        kingdom_a: pick.a,
        kingdom_b: pick.b,
        metric: pick.metric,
        duration_days: durationDays,
        message: `Border skirmish erupts between ${pick.a} and ${pick.b} over ${metricDisplayNames[pick.metric] ?? pick.metric}!`,
      });

      stats.battles_started++;
    }

    // ── Step 6: Prune old events ──
    const thirtyDaysAgoStr = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { count } = await supabase
      .from('world_events')
      .delete()
      .lt('created_at', thirtyDaysAgoStr)
      .select('id', { count: 'exact', head: true });

    stats.events_pruned = count ?? 0;

    console.log('[cron/kingdom-wars]', stats);
    return res.json({ ok: true, ...stats });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[cron/kingdom-wars] Fatal:', msg);
    return res.status(500).json({ error: msg });
  }
}
```

- [ ] **Step 2: Register cron in vercel.json**

In `vercel.json`, add the new cron to the `crons` array:

```json
{
  "path": "/api/cron/kingdom-wars",
  "schedule": "0 */6 * * *"
}
```

- [ ] **Step 3: Test locally**

```bash
curl "http://localhost:3000/api/cron/kingdom-wars?secret=$CRON_SECRET"
```
Expected: `{ "ok": true, "rankings_updated": N, ... }`

- [ ] **Step 4: Commit**

```bash
git add api/cron/kingdom-wars.ts vercel.json
git commit -m "feat: add kingdom wars cron for rankings, battles, and event generation"
```

---

## Task 8: Event feed frontend panel

**Files:**
- Create: `src/events/EventFeed.ts`
- Create: `src/events/EventFeed.test.ts`
- Modify: `src/scenes/WorldScene.ts`
- Modify: `src/scenes/CityScene.ts`

- [ ] **Step 1: Write failing tests for event formatting**

Create `src/events/EventFeed.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { formatEventMessage } from './EventFeed';

describe('formatEventMessage', () => {
  it('formats citizen_joined events', () => {
    const msg = formatEventMessage({
      id: '1', event_type: 'citizen_joined', created_at: new Date().toISOString(),
      payload: { username: 'alice', repo_count: 5 },
    });
    expect(msg).toContain('alice');
    expect(msg).toContain('joined');
  });

  it('formats battle_started events using payload message', () => {
    const msg = formatEventMessage({
      id: '2', event_type: 'battle_started', created_at: new Date().toISOString(),
      payload: { message: 'Border skirmish erupts between TypeScript and Python over Wealth!' },
    });
    expect(msg).toBe('Border skirmish erupts between TypeScript and Python over Wealth!');
  });

  it('formats building_upgraded events', () => {
    const msg = formatEventMessage({
      id: '4', event_type: 'building_upgraded', created_at: new Date().toISOString(),
      payload: { repo: 'facebook/react', new_rank: 'castle', kingdom: 'TypeScript' },
    });
    expect(msg).toContain('react');
    expect(msg).toContain('castle');
  });

  it('falls back to generic message for unknown types', () => {
    const msg = formatEventMessage({
      id: '3', event_type: 'unknown_type' as any, created_at: new Date().toISOString(),
      payload: {},
    });
    expect(typeof msg).toBe('string');
    expect(msg.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/events/EventFeed.test.ts
```
Expected: FAIL

- [ ] **Step 3: Implement EventFeed.ts**

Create `src/events/EventFeed.ts`. This is a Phaser-agnostic module that handles:
- Fetching events from `/api/events`
- Formatting event messages
- Managing the replay queue (staggered timing)

```typescript
import type { WorldEvent } from './types';

const API_BASE = '/api/events';
const REPLAY_INTERVAL_MS = 4000; // 4 seconds between events
const MAX_VISIBLE = 5;

export function formatEventMessage(event: WorldEvent): string {
  const p = event.payload as Record<string, unknown>;

  // If the event has a pre-formatted message, use it
  if (typeof p.message === 'string') return p.message;

  switch (event.event_type) {
    case 'citizen_joined':
      return `${p.username ?? 'A new citizen'} joined the realm with ${p.repo_count ?? 0} repos`;
    case 'repo_added':
      return `${p.repo ?? 'A new repo'} was discovered in the ${p.language ?? 'unknown'} kingdom`;
    case 'kingdom_rank_changed':
      return `${p.kingdom ?? 'A kingdom'} shifted to #${p.new_rank ?? '?'} in Kingdom Power`;
    case 'battle_started':
      return `A battle has begun between ${p.kingdom_a ?? '?'} and ${p.kingdom_b ?? '?'}`;
    case 'battle_round':
      return `Battle update: ${p.kingdom_a ?? '?'} vs ${p.kingdom_b ?? '?'} — Day ${p.day ?? '?'}`;
    case 'battle_resolved':
      return `${p.winner ?? 'A kingdom'} triumphs over ${p.loser ?? 'their rival'}!`;
    case 'building_upgraded':
      return `${p.repo ?? 'A building'} upgraded to ${p.new_rank ?? 'a higher rank'} in ${p.kingdom ?? 'the realm'}!`;
    default:
      return 'Something happened in the realm...';
  }
}

export async function fetchRecentEvents(sinceHoursAgo = 1): Promise<WorldEvent[]> {
  const since = new Date(Date.now() - sinceHoursAgo * 60 * 60 * 1000).toISOString();
  try {
    const res = await fetch(`${API_BASE}?since=${encodeURIComponent(since)}`);
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

export class EventReplayQueue {
  private queue: WorldEvent[] = [];
  private visible: WorldEvent[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private onEvent: (event: WorldEvent, message: string) => void;

  constructor(onEvent: (event: WorldEvent, message: string) => void) {
    this.onEvent = onEvent;
  }

  load(events: WorldEvent[]) {
    this.queue = [...events];
    this.start();
  }

  private start() {
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => this.tick(), REPLAY_INTERVAL_MS);
    // Show first event immediately
    this.tick();
  }

  private tick() {
    const next = this.queue.shift();
    if (!next) {
      this.stop();
      return;
    }
    this.visible.push(next);
    if (this.visible.length > MAX_VISIBLE) {
      this.visible.shift();
    }
    this.onEvent(next, formatEventMessage(next));
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  getVisible(): WorldEvent[] {
    return [...this.visible];
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/events/EventFeed.test.ts
```
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/events/EventFeed.ts src/events/EventFeed.test.ts
git commit -m "feat: add event feed module with formatting, fetching, and replay queue"
```

---

## Task 9: Integrate event feed into scenes (DOM-based panel)

**Files:**
- Modify: `index.html` (add event feed container)
- Modify: `src/scenes/WorldScene.ts`
- Modify: `src/scenes/CityScene.ts`

- [ ] **Step 1: Add event feed HTML container to index.html**

Add a fixed-position panel to `index.html`, after the existing info panel divs:

```html
<!-- Event Feed -->
<div id="event-feed" class="rpg-panel" style="
  position: fixed; bottom: 16px; right: 16px; width: 340px; max-height: 200px;
  overflow: hidden; z-index: 100; display: none;
  font-family: 'Silkscreen', monospace; font-size: 10px;
">
  <div id="event-feed-header" style="
    display: flex; justify-content: space-between; align-items: center;
    padding: 4px 8px; cursor: pointer;
  ">
    <span style="color: #c8b89a;">World Events</span>
    <span id="event-feed-toggle" style="color: #c8b89a; font-size: 8px;">▼</span>
  </div>
  <div id="event-feed-list" style="padding: 4px 8px;"></div>
</div>
```

- [ ] **Step 2: Add event feed initialization to WorldScene**

In `src/scenes/WorldScene.ts`, in the `create()` method (after header setup), add event feed initialization:

```typescript
import { fetchRecentEvents, EventReplayQueue, formatEventMessage } from '../events/EventFeed';

// In create() method, after setupWorldHeader():
this.initEventFeed();
```

Add the `initEventFeed` method:

```typescript
private async initEventFeed() {
  const feedEl = document.getElementById('event-feed');
  const listEl = document.getElementById('event-feed-list');
  const toggleEl = document.getElementById('event-feed-toggle');
  if (!feedEl || !listEl) return;

  feedEl.style.display = 'block';

  // Collapse toggle
  const collapsed = localStorage.getItem('event-feed-collapsed') === 'true';
  if (collapsed) listEl.style.display = 'none';
  toggleEl?.addEventListener('click', () => {
    const isHidden = listEl.style.display === 'none';
    listEl.style.display = isHidden ? 'block' : 'none';
    if (toggleEl) toggleEl.textContent = isHidden ? '▼' : '▶';
    localStorage.setItem('event-feed-collapsed', String(!isHidden));
  });

  const events = await fetchRecentEvents();
  const queue = new EventReplayQueue((event, message) => {
    const div = document.createElement('div');
    div.textContent = message;
    div.style.cssText = 'color: #a0a0a0; padding: 2px 0; opacity: 0; transition: opacity 0.5s;';
    listEl.appendChild(div);
    requestAnimationFrame(() => { div.style.opacity = '1'; });

    // Remove old entries
    while (listEl.children.length > 5) {
      listEl.firstChild?.remove();
    }
  });
  queue.load(events);

  // Store queue reference for cleanup on scene destroy
  this.events.on('shutdown', () => queue.stop());
}
```

- [ ] **Step 3: Add same event feed initialization to CityScene**

Add the same `initEventFeed` method to `src/scenes/CityScene.ts` (identical logic). Consider extracting to a shared mixin or calling from both scenes.

- [ ] **Step 4: Test manually**

Load the world map and city scenes. Event feed panel should appear bottom-right with events replaying. Toggle collapse should work. Events should fade in.

- [ ] **Step 5: Commit**

```bash
git add index.html src/scenes/WorldScene.ts src/scenes/CityScene.ts
git commit -m "feat: integrate live event feed panel into world and city scenes"
```

---

## Task 10: Citizen thought bubbles — hover and card

**Files:**
- Create: `src/citizens/ThoughtBubble.ts`
- Modify: `src/scenes/CityScene.ts`

- [ ] **Step 1: Create ThoughtBubble module**

Create `src/citizens/ThoughtBubble.ts`:

```typescript
const FALLBACK_THOUGHTS = [
  'The realm is peaceful today...',
  'I serve the {kingdom} kingdom faithfully',
  'Another day in {city}...',
  'These are prosperous times...',
  'I wonder what lies beyond the border...',
  'The buildings grow taller every day',
  'So many stars in the sky tonight...',
  'I heard a new citizen arrived recently',
  'The kingdom grows stronger each day',
  'What a time to be alive in {kingdom}...',
  'I should commit more often...',
  'The code compiles. Life is good.',
];

export function getThought(
  commitMessage: string | undefined | null,
  kingdom: string,
  city: string,
): string {
  if (commitMessage && commitMessage.trim().length > 0) {
    return commitMessage.length > 40
      ? commitMessage.slice(0, 37) + '...'
      : commitMessage;
  }
  const template = FALLBACK_THOUGHTS[Math.floor(Math.random() * FALLBACK_THOUGHTS.length)];
  return template.replace('{kingdom}', kingdom).replace('{city}', city);
}

export function getFullThought(
  commitMessage: string | undefined | null,
  kingdom: string,
  city: string,
): string {
  if (commitMessage && commitMessage.trim().length > 0) {
    return commitMessage;
  }
  const template = FALLBACK_THOUGHTS[Math.floor(Math.random() * FALLBACK_THOUGHTS.length)];
  return template.replace('{kingdom}', kingdom).replace('{city}', city);
}
```

- [ ] **Step 2: Add hover thought bubble to CityScene**

In `src/scenes/CityScene.ts`, add a Phaser text object that follows the hovered citizen. In the citizen sprite setup (where walking citizens are created), add pointer events:

```typescript
// For each citizen sprite, add hover handlers:
sprite.setInteractive({ useHandCursor: true });
sprite.on('pointerover', () => {
  this.showHoverThought(citizen, sprite);
});
sprite.on('pointerout', () => {
  this.hideHoverThought();
});
```

Add the hover thought methods:

```typescript
private hoverBubble: Phaser.GameObjects.Container | null = null;

private showHoverThought(citizen: WalkingCitizen, sprite: Phaser.GameObjects.Sprite) {
  this.hideHoverThought();
  const thought = getThought(citizen.lastCommitMessage, this.language, this.language);

  const bg = this.add.graphics();
  const text = this.add.text(0, 0, thought, {
    fontFamily: 'Silkscreen',
    fontSize: '8px',
    color: '#1a1a2e',
    wordWrap: { width: 150 },
  }).setOrigin(0.5, 1);

  const padding = 6;
  const bounds = text.getBounds();
  bg.fillStyle(0xffffff, 0.95);
  bg.fillRoundedRect(
    bounds.x - padding, bounds.y - padding,
    bounds.width + padding * 2, bounds.height + padding * 2,
    4
  );
  bg.lineStyle(1, 0x1a1a2e, 1);
  bg.strokeRoundedRect(
    bounds.x - padding, bounds.y - padding,
    bounds.width + padding * 2, bounds.height + padding * 2,
    4
  );

  this.hoverBubble = this.add.container(sprite.x, sprite.y - 24, [bg, text]);
  this.hoverBubble.setDepth(9999);
}

private hideHoverThought() {
  if (this.hoverBubble) {
    this.hoverBubble.destroy();
    this.hoverBubble = null;
  }
}
```

- [ ] **Step 3: Add "Thoughts" section to citizen card**

In `src/scenes/CityScene.ts`, in the `showCitizenInfo()` method (around line 1486), add the thought to the info panel HTML:

```typescript
// After existing citizen info content:
const fullThought = getFullThought(citizen.lastCommitMessage, this.language, this.language);
infoHtml += `
  <div style="margin-top: 8px; padding: 6px 8px; background: rgba(0,0,0,0.2); border-radius: 4px; border-left: 2px solid #c8b89a;">
    <span style="font-size: 9px; color: #888;">💭 Thoughts</span><br/>
    <em style="font-size: 10px; color: #c8b89a;">"${fullThought}"</em>
  </div>
`;
```

- [ ] **Step 4: Test manually**

Hover over citizens in a city — bubble should appear. Click a citizen — card should show "Thoughts" section. Citizens without commit messages should show fallback RPG lines.

- [ ] **Step 5: Commit**

```bash
git add src/citizens/ThoughtBubble.ts src/scenes/CityScene.ts
git commit -m "feat: add citizen thought bubbles (hover + card)"
```

---

## Task 11: Citizen thought bubbles — ambient pop-ups

**Files:**
- Modify: `src/scenes/CityScene.ts`

- [ ] **Step 1: Add ambient thought system to CityScene**

In `src/scenes/CityScene.ts`, add an ambient thought manager that runs on a timer:

```typescript
private ambientBubbles: Phaser.GameObjects.Container[] = [];
private ambientTimer: Phaser.Time.TimerEvent | null = null;

private startAmbientThoughts() {
  this.ambientTimer = this.time.addEvent({
    delay: 7000, // every 7 seconds
    callback: () => this.showRandomAmbientThought(),
    loop: true,
  });
}

private showRandomAmbientThought() {
  // Remove excess bubbles
  while (this.ambientBubbles.length >= 2) {
    const old = this.ambientBubbles.shift();
    if (old) {
      this.tweens.add({
        targets: old,
        alpha: 0,
        duration: 500,
        onComplete: () => old.destroy(),
      });
    }
  }

  // Pick a random on-screen citizen with a commit message
  const cam = this.cameras.main;
  const visible = this.citizenSprites.filter(c => {
    const sprite = c.sprite;
    return sprite.x >= cam.scrollX && sprite.x <= cam.scrollX + cam.width
      && sprite.y >= cam.scrollY && sprite.y <= cam.scrollY + cam.height;
  });

  if (visible.length === 0) return;
  const citizen = visible[Math.floor(Math.random() * visible.length)];
  const thought = getThought(citizen.lastCommitMessage, this.language, this.language);

  // Create bubble (same style as hover but with fade-in/out)
  const text = this.add.text(0, 0, thought, {
    fontFamily: 'Silkscreen',
    fontSize: '8px',
    color: '#1a1a2e',
    wordWrap: { width: 140 },
  }).setOrigin(0.5, 1);

  const padding = 5;
  const bounds = text.getBounds();
  const bg = this.add.graphics();
  bg.fillStyle(0xffffff, 0.9);
  bg.fillRoundedRect(bounds.x - padding, bounds.y - padding, bounds.width + padding * 2, bounds.height + padding * 2, 4);
  bg.lineStyle(1, 0x1a1a2e, 0.8);
  bg.strokeRoundedRect(bounds.x - padding, bounds.y - padding, bounds.width + padding * 2, bounds.height + padding * 2, 4);

  const container = this.add.container(citizen.sprite.x, citizen.sprite.y - 24, [bg, text]);
  container.setDepth(9998);
  container.setAlpha(0);

  this.tweens.add({ targets: container, alpha: 1, duration: 400 });

  // Auto-fade after 4.5 seconds
  this.time.delayedCall(4500, () => {
    this.tweens.add({
      targets: container,
      alpha: 0,
      duration: 500,
      onComplete: () => {
        container.destroy();
        this.ambientBubbles = this.ambientBubbles.filter(b => b !== container);
      },
    });
  });

  this.ambientBubbles.push(container);
}
```

- [ ] **Step 2: Start ambient thoughts after city loads**

In the `create()` method of CityScene, after citizens are spawned:

```typescript
this.startAmbientThoughts();
```

And in the shutdown handler:

```typescript
this.events.on('shutdown', () => {
  this.ambientTimer?.destroy();
  this.ambientBubbles.forEach(b => b.destroy());
});
```

- [ ] **Step 3: Test manually**

Open a city with multiple citizens. Wait 7 seconds. A random thought bubble should appear above a visible citizen, fade in, stay for 4.5s, then fade out. Max 2 visible at once.

- [ ] **Step 4: Commit**

```bash
git add src/scenes/CityScene.ts
git commit -m "feat: add ambient citizen thought bubble pop-ups"
```

---

## Task 12: Leaderboard panel — rankings tab

**Files:**
- Create: `src/wars/LeaderboardPanel.ts`
- Modify: `src/scenes/WorldScene.ts`

- [ ] **Step 1: Create LeaderboardPanel module**

Create `src/wars/LeaderboardPanel.ts`:

```typescript
import type { KingdomRanking, KingdomBattle } from './types';

const METRIC_DISPLAY: Record<string, string> = {
  military_strength: 'Military Strength',
  wealth: 'Wealth',
  population: 'Population',
  expansion: 'Expansion',
  kingdom_power: 'Kingdom Power',
};

export async function fetchLeaderboardData(): Promise<{ rankings: KingdomRanking[]; battles: KingdomBattle[] }> {
  try {
    const res = await fetch('/api/rankings');
    if (!res.ok) return { rankings: [], battles: [] };
    return await res.json();
  } catch {
    return { rankings: [], battles: [] };
  }
}

export function renderLeaderboardHTML(
  rankings: KingdomRanking[],
  battles: KingdomBattle[],
  activeTab: 'rankings' | 'battles' = 'rankings',
): string {
  const tabs = `
    <div style="display:flex;gap:8px;margin-bottom:8px;">
      <button class="leaderboard-tab ${activeTab === 'rankings' ? 'active' : ''}" data-tab="rankings"
        style="font-family:'Press Start 2P';font-size:8px;padding:4px 8px;background:${activeTab === 'rankings' ? '#c8b89a' : '#333'};color:${activeTab === 'rankings' ? '#1a1a2e' : '#888'};border:1px solid #555;cursor:pointer;">
        Rankings
      </button>
      <button class="leaderboard-tab ${activeTab === 'battles' ? 'active' : ''}" data-tab="battles"
        style="font-family:'Press Start 2P';font-size:8px;padding:4px 8px;background:${activeTab === 'battles' ? '#c8b89a' : '#333'};color:${activeTab === 'battles' ? '#1a1a2e' : '#888'};border:1px solid #555;cursor:pointer;">
        Battles
      </button>
    </div>
  `;

  if (activeTab === 'rankings') {
    // Group by metric
    const byMetric = new Map<string, KingdomRanking[]>();
    for (const r of rankings) {
      const arr = byMetric.get(r.metric) ?? [];
      arr.push(r);
      byMetric.set(r.metric, arr);
    }

    // Default to kingdom_power
    const powerRankings = byMetric.get('kingdom_power') ?? [];
    powerRankings.sort((a, b) => a.rank - b.rank);

    const rows = powerRankings.map(r => {
      const change = r.previous_rank - r.rank;
      const arrow = change > 0
        ? `<span style="color:#4ade80;">▲${change}</span>`
        : change < 0
        ? `<span style="color:#f87171;">▼${Math.abs(change)}</span>`
        : `<span style="color:#888;">—</span>`;
      return `
        <div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid rgba(200,184,154,0.1);">
          <span style="color:#c8b89a;">#${r.rank} ${r.language}</span>
          <span>${Math.round(r.value)} ${arrow}</span>
        </div>
      `;
    }).join('');

    return tabs + `<div style="color:#a0a0a0;font-size:10px;">${rows || 'No rankings yet'}</div>`;
  }

  // Battles tab
  const activeBattles = battles.filter(b => b.status === 'active');
  const recentResolved = battles.filter(b => b.status === 'resolved').slice(0, 3);

  const battleRows = activeBattles.map(b => {
    const aTotal = b.rounds.reduce((s, r) => s + r.a_delta, 0);
    const bTotal = b.rounds.reduce((s, r) => s + r.b_delta, 0);
    const total = Math.max(1, aTotal + bTotal);
    const aPct = Math.round((aTotal / total) * 100);
    return `
      <div style="margin-bottom:8px;padding:4px;background:rgba(0,0,0,0.2);border-radius:4px;">
        <div style="font-size:9px;color:#c8b89a;margin-bottom:4px;">
          ⚔️ ${b.kingdom_a} vs ${b.kingdom_b} — ${METRIC_DISPLAY[b.metric] ?? b.metric}
        </div>
        <div style="display:flex;height:8px;border-radius:2px;overflow:hidden;background:#333;">
          <div style="width:${aPct}%;background:#4ade80;"></div>
          <div style="width:${100 - aPct}%;background:#f87171;"></div>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:8px;color:#888;margin-top:2px;">
          <span>${b.kingdom_a}: +${aTotal}</span>
          <span>Day ${b.rounds.length}</span>
          <span>${b.kingdom_b}: +${bTotal}</span>
        </div>
      </div>
    `;
  }).join('');

  const resolvedRows = recentResolved.map(b => `
    <div style="font-size:9px;color:#888;padding:2px 0;">
      🏆 ${b.winner} defeated ${b.winner === b.kingdom_a ? b.kingdom_b : b.kingdom_a} (${METRIC_DISPLAY[b.metric] ?? b.metric})
    </div>
  `).join('');

  return tabs + `
    <div style="color:#a0a0a0;font-size:10px;">
      ${battleRows || '<div style="color:#888;">No active battles</div>'}
      ${resolvedRows ? `<div style="margin-top:8px;border-top:1px solid rgba(200,184,154,0.1);padding-top:4px;"><div style="font-size:8px;color:#666;margin-bottom:4px;">Recent Results</div>${resolvedRows}</div>` : ''}
    </div>
  `;
}
```

- [ ] **Step 2: Add rankings API endpoint**

Create `api/rankings.ts`:

```typescript
/**
 * GET /api/rankings
 * Returns current kingdom rankings and active/recent battles.
 * Public — no auth required.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createServiceClient } from './lib/supabase';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const supabase = createServiceClient();

    const [rankingsRes, battlesRes] = await Promise.all([
      supabase.from('kingdom_rankings').select('*').order('rank', { ascending: true }),
      supabase.from('kingdom_battles').select('*').order('started_at', { ascending: false }).limit(10),
    ]);

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');
    return res.json({
      rankings: rankingsRes.data ?? [],
      battles: battlesRes.data ?? [],
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: msg });
  }
}
```

- [ ] **Step 3: Add leaderboard button and panel to WorldScene**

In `src/scenes/WorldScene.ts`, in `setupWorldHeader()`, add a Rankings button to the header. When clicked, show/hide a DOM panel (similar to existing info panels) populated by `renderLeaderboardHTML()`.

```typescript
import { renderLeaderboardHTML } from '../wars/LeaderboardPanel';
```

Add the panel HTML to `index.html`:

```html
<!-- Leaderboard Panel -->
<div id="leaderboard-panel" class="rpg-panel" style="
  position: fixed; top: 60px; right: 16px; width: 320px; max-height: 400px;
  overflow-y: auto; z-index: 100; display: none;
  font-family: 'Silkscreen', monospace; padding: 12px;
">
  <div id="leaderboard-content"></div>
</div>
```

- [ ] **Step 4: Test manually**

Open the world map. Click the Rankings button. Leaderboard panel should appear with rankings and battles tabs. Both tabs should render correctly (even if empty).

- [ ] **Step 5: Commit**

```bash
git add src/wars/LeaderboardPanel.ts api/rankings.ts index.html src/scenes/WorldScene.ts
git commit -m "feat: add kingdom rankings leaderboard panel with battles tab"
```

---

## Task 13: World map crown icon + battle indicators

**Files:**
- Modify: `src/scenes/WorldScene.ts`

- [ ] **Step 1: Add crown icon to #1 kingdom label**

In `src/scenes/WorldScene.ts`, after rendering kingdom labels, fetch rankings and add a crown emoji/text next to the top-ranked kingdom:

```typescript
// After kingdom labels are rendered:
try {
  const res = await fetch('/api/rankings');
  const { rankings } = await res.json();
  const topKingdom = rankings
    .filter((r: any) => r.metric === 'kingdom_power')
    .sort((a: any, b: any) => a.rank - b.rank)[0];

  if (topKingdom) {
    const label = this.kingdomLabels.find(l => l.getData('language') === topKingdom.language);
    if (label) {
      const crown = this.add.text(label.x + label.width / 2 + 8, label.y, '👑', {
        fontSize: '14px',
      }).setOrigin(0, 0.5).setDepth(label.depth);
    }
  }
} catch { /* silent — crown is optional */ }
```

- [ ] **Step 2: Test manually**

Load the world map. The #1 kingdom should have a crown icon next to its label.

- [ ] **Step 3: Commit**

```bash
git add src/scenes/WorldScene.ts
git commit -m "feat: add crown icon to top-ranked kingdom on world map"
```

---

## Task 14: Wire last_commit_message through to citizen API + frontend

**Files:**
- Modify: `api/citizen.ts`
- Modify: `src/scenes/CityScene.ts:100-109` (WalkingCitizen interface)

- [ ] **Step 1: Add last_commit_message to citizen API response**

In `api/citizen.ts`, the contributor data already comes from Supabase. Add `last_commit_message` to the response object. If it's stored in the DB alongside contributor data, select it. If not, fetch it from GitHub for the top contributor.

For the immediate implementation, add it to the API response:

```typescript
// In the response building section, add to each repo's contributor data:
last_commit_message: contributor.last_commit_message ?? null,
```

- [ ] **Step 2: Add lastCommitMessage to WalkingCitizen interface**

In `src/scenes/CityScene.ts`, update the `WalkingCitizen` interface:

```typescript
interface WalkingCitizen {
  sprite: Phaser.GameObjects.Sprite;
  nameLabel: Phaser.GameObjects.Text;
  titleLabel?: Phaser.GameObjects.Text;
  login: string;
  avatar_url: string;
  contributions: number;
  targetX: number;
  targetY: number;
  waitTimer: number;
  lastCommitMessage?: string; // NEW
}
```

- [ ] **Step 3: Pass commit message when creating citizen sprites**

Where citizens are created from API data, pass the `last_commit_message` field:

```typescript
lastCommitMessage: contributorData.last_commit_message,
```

- [ ] **Step 4: Test end-to-end**

Open a city, hover over a citizen who has commits. Their thought bubble should show their actual commit message. Citizens without messages should show fallback RPG lines.

- [ ] **Step 5: Commit**

```bash
git add api/citizen.ts src/scenes/CityScene.ts
git commit -m "feat: wire last_commit_message through citizen API to frontend thought bubbles"
```

---

## Task 15: Add last_commit_message column to Supabase + refresh cron

**Files:**
- Modify: `api/cron/refresh-pushed.ts` (add commit message fetch)

- [ ] **Step 1: Add column to contributors table**

Run in Supabase SQL editor:

```sql
ALTER TABLE contributors ADD COLUMN IF NOT EXISTS last_commit_message text;
```

- [ ] **Step 2: Update refresh-pushed cron to detect building upgrades and fetch commit messages**

In `api/cron/refresh-pushed.ts`, import the event writer and add building rank detection. Also fetch and store commit messages for citizens. Add this inside the repo update loop:

First, add the building rank helper at the top of the file:

```typescript
import { writeEvent } from '../lib/events';

const STAR_RANKS = [
  { min: 10000, rank: 'citadel' },
  { min: 5000, rank: 'castle' },
  { min: 2000, rank: 'palace' },
  { min: 1000, rank: 'keep' },
  { min: 500, rank: 'manor' },
  { min: 100, rank: 'guild' },
  { min: 20, rank: 'cottage' },
  { min: 5, rank: 'hovel' },
  { min: 0, rank: 'camp' },
];

function getBuildingRank(stars: number): string {
  return (STAR_RANKS.find(r => stars >= r.min) ?? STAR_RANKS[STAR_RANKS.length - 1]).rank;
}
```

Then after updating `pushed_at` for a repo, check if the star count changed enough to trigger a rank change:

```typescript
// Check for building upgrades (star count → building rank change)
const ghRepo = ghRepos.find(r => r.full_name?.toLowerCase() === fullName.toLowerCase());
if (ghRepo && existing) {
  const oldStars = existing.stargazers ?? 0;
  const newStars = ghRepo.stargazers_count ?? 0;
  const oldRank = getBuildingRank(oldStars);
  const newRank = getBuildingRank(newStars);
  if (oldRank !== newRank && newStars > oldStars) {
    await writeEvent('building_upgraded', {
      repo: fullName,
      old_rank: oldRank,
      new_rank: newRank,
      stars: newStars,
      kingdom: ghRepo.language,
      message: `${fullName} upgraded to ${newRank} with ${newStars} stars!`,
    });
  }
}
```

Then fetch commit messages:

```typescript
// After updating pushed_at for a repo, fetch recent commits to populate citizen thoughts
// Fetch last 10 commits to cover multiple contributors
const commitsRes = await fetch(
  `${GH_API}/repos/${fullName}/commits?per_page=10`,
  { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.v3+json' } }
);
if (commitsRes.ok) {
  const commits = await commitsRes.json();
  const seen = new Set<string>();
  for (const commit of commits) {
    const author = commit.author?.login;
    if (!author || seen.has(author)) continue;
    seen.add(author);
    const msg = commit.commit?.message?.split('\n')[0]?.slice(0, 80);
    if (msg) {
      await supabase
        .from('contributors')
        .update({ last_commit_message: msg })
        .eq('login', author)
        .eq('repo_id', fullName);
    }
  }
}
```

- [ ] **Step 3: Test by triggering the cron locally**

```bash
curl "http://localhost:3000/api/cron/refresh-pushed?secret=$CRON_SECRET"
```
Then check the contributors table — some rows should have `last_commit_message` populated.

- [ ] **Step 4: Commit**

```bash
git add api/cron/refresh-pushed.ts
git commit -m "feat: fetch and store last commit messages in refresh-pushed cron"
```

---

## Task 16: Final integration testing + cleanup

**Files:**
- All modified files

- [ ] **Step 1: Run all tests**

```bash
npx vitest run
```
Expected: All tests pass

- [ ] **Step 2: Manual smoke test — full flow**

1. Open gitkingdom.com (or localhost)
2. World map: event feed panel visible bottom-right, crown on #1 kingdom, rankings button in header
3. Click Rankings: leaderboard shows kingdoms, battles tab shows active/recent battles
4. Enter a city: event feed still visible, ambient thought bubbles appear after ~7s
5. Hover a citizen: thought bubble appears immediately
6. Click a citizen: card shows "Thoughts" section
7. Add a repo: `repo_added` event appears in feed
8. Check `/api/events`: returns recent events
9. Check `/api/rankings`: returns rankings and battles

- [ ] **Step 3: Commit any final fixes**

```bash
git add -A
git commit -m "fix: integration fixes for living world phase 1"
```

- [ ] **Step 4: Deploy**

```bash
vercel --prod
```

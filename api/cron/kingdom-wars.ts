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

// Languages that get merged into "Uncharted" — mirrors groupByLanguage.ts
const LANGUAGE_BLOCKLIST = new Set([
  'HTML', 'CSS', 'SCSS', 'Less', 'Markdown', 'Dockerfile',
  'Makefile', 'Nix', 'HCL', 'Vue', 'Blade', 'FreeMarker',
  'Vim Script', 'LLVM', 'Wren', 'BASIC', 'Batchfile',
  'PowerShell', 'Nunjucks', 'EJS', 'Handlebars', 'Pug',
  'Smarty', 'Twig', 'Mustache', 'XSLT', 'Jsonnet',
]);
const MIN_REPOS_FOR_KINGDOM = 3;

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

    const langMetrics = new Map<string, { military_strength: number; wealth: number; population: number; expansion: number }>();

    // First pass: count repos per language to enforce MIN_REPOS_FOR_KINGDOM
    const langRepoCounts = new Map<string, number>();
    for (const repo of repos) {
      let lang = repo.language;
      if (!lang || LANGUAGE_BLOCKLIST.has(lang)) lang = 'Uncharted';
      langRepoCounts.set(lang, (langRepoCounts.get(lang) ?? 0) + 1);
    }

    for (const repo of repos) {
      let lang = repo.language;
      if (!lang || LANGUAGE_BLOCKLIST.has(lang)) lang = 'Uncharted';
      // Languages with fewer than MIN_REPOS get merged into Uncharted
      if (lang !== 'Uncharted' && (langRepoCounts.get(lang) ?? 0) < MIN_REPOS_FOR_KINGDOM) lang = 'Uncharted';
      const m = langMetrics.get(lang) ?? { military_strength: 0, wealth: 0, population: 0, expansion: 0 };
      m.wealth += repo.stargazers ?? 0;
      if (repo.pushed_at && repo.pushed_at >= thirtyDaysAgo) {
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
      const power =
        40 * (m.military_strength / maxes.military_strength) +
        30 * (m.wealth / maxes.wealth) +
        20 * (m.population / maxes.population) +
        10 * (m.expansion / maxes.expansion);
      allRankings.push({ language: lang, metric: 'kingdom_power', value: Math.round(power * 10) / 10 });
    }

    const byMetric = new Map<string, typeof allRankings>();
    for (const r of allRankings) {
      const arr = byMetric.get(r.metric) ?? [];
      arr.push(r);
      byMetric.set(r.metric, arr);
    }

    const { data: prevRankings } = await supabase
      .from('kingdom_rankings')
      .select('language, metric, rank');

    const prevRankMap = new Map<string, number>();
    for (const pr of prevRankings ?? []) {
      prevRankMap.set(`${pr.language}:${pr.metric}`, pr.rank);
    }

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

      const rounds: { day: number; a_delta: number; b_delta: number; a_hero?: string; b_hero?: string }[] = battle.rounds ?? [];
      const dayNum = rounds.length + 1;

      const prevATotal = rounds.reduce((s, r) => s + r.a_delta, 0);
      const prevBTotal = rounds.reduce((s, r) => s + r.b_delta, 0);
      const aDelta = Math.max(0, aValue - prevATotal);
      const bDelta = Math.max(0, bValue - prevBTotal);

      // Find hero for each side — top contributor by commits in repos of that language
      // Only count registered users (exist in users table)
      const findHero = async (language: string): Promise<string | undefined> => {
        const langRepoIds = repos.filter(r => r.language === language).map(r => r.full_name);
        if (langRepoIds.length === 0) return undefined;
        // Get contributors for this language's repos, sorted by contributions
        const langContribs = (contributors ?? [])
          .filter(c => langRepoIds.some(id => c.repo_id === id || c.repo_id === id?.toLowerCase()))
          .reduce((acc, c) => {
            acc.set(c.login, (acc.get(c.login) ?? 0) + (c.contributions ?? 0));
            return acc;
          }, new Map<string, number>());

        // Sort by contributions desc
        const sorted = [...langContribs.entries()].sort((a, b) => b[1] - a[1]);
        // Check if top contributors are registered users
        for (const [login] of sorted.slice(0, 5)) {
          const { data: user } = await supabase.from('users').select('login').ilike('login', login).limit(1);
          if (user && user.length > 0) return login;
        }
        // Fallback to top contributor even if not registered
        return sorted[0]?.[0];
      };

      const aHero = await findHero(battle.kingdom_a);
      const bHero = await findHero(battle.kingdom_b);

      rounds.push({ day: dayNum, a_delta: aDelta, b_delta: bDelta, a_hero: aHero, b_hero: bHero });

      if (now >= ends) {
        // ── Step 4: Resolve battle ──
        const aTotalGain = rounds.reduce((s, r) => s + r.a_delta, 0);
        const bTotalGain = rounds.reduce((s, r) => s + r.b_delta, 0);
        const winner = aTotalGain >= bTotalGain ? battle.kingdom_a : battle.kingdom_b;
        const loser = winner === battle.kingdom_a ? battle.kingdom_b : battle.kingdom_a;

        // Find the overall hero — most frequent hero on winning side
        const heroKey = winner === battle.kingdom_a ? 'a_hero' : 'b_hero';
        const heroCounts = new Map<string, number>();
        for (const r of rounds) {
          const h = r[heroKey];
          if (h) heroCounts.set(h, (heroCounts.get(h) ?? 0) + 1);
        }
        const hero = heroCounts.size > 0
          ? [...heroCounts.entries()].sort((a, b) => b[1] - a[1])[0][0]
          : undefined;

        await supabase
          .from('kingdom_battles')
          .update({ status: 'resolved', rounds, winner, hero: hero ?? null })
          .eq('id', battle.id);

        const heroMsg = hero ? ` ${hero} named Champion of ${winner}!` : '';
        await writeEvent('battle_resolved', {
          battle_id: battle.id,
          winner,
          loser,
          hero,
          metric: battle.metric,
          message: `${winner} triumphs over ${loser} in the battle for ${battle.metric}!${heroMsg}`,
        });

        stats.battles_resolved++;
      } else {
        await supabase
          .from('kingdom_battles')
          .update({ rounds })
          .eq('id', battle.id);

        const leadHero = aDelta > bDelta ? aHero : bHero;
        const heroCallout = leadHero ? ` ${leadHero} leads the charge!` : '';
        await writeEvent('battle_round', {
          battle_id: battle.id,
          kingdom_a: battle.kingdom_a,
          kingdom_b: battle.kingdom_b,
          day: dayNum,
          a_delta: aDelta,
          b_delta: bDelta,
          a_hero: aHero,
          b_hero: bHero,
          message: dayNum === 1
            ? `First skirmish! ${battle.kingdom_a} ${aDelta > bDelta ? 'draws first blood' : 'is caught off guard'} (+${aDelta} vs +${bDelta})${heroCallout}`
            : `Round ${dayNum}: ${battle.kingdom_a} ${aDelta > bDelta ? 'pushes forward' : 'falls behind'} (+${aDelta} vs +${bDelta})${heroCallout}`,
        });

        stats.battles_progressed++;
      }
    }

    // ── Step 5: Spark new battles ──
    // Check ALL active battles (re-fetch to avoid race conditions with concurrent cron runs)
    const { data: currentActiveBattles } = await supabase
      .from('kingdom_battles')
      .select('kingdom_a, kingdom_b')
      .eq('status', 'active');

    const activeKingdoms = new Set<string>();
    for (const b of currentActiveBattles ?? []) {
      activeKingdoms.add(b.kingdom_a);
      activeKingdoms.add(b.kingdom_b);
    }

    // Build adjacency: languages that share contributors are "adjacent"
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
        const shared = [...usersA].some(u => usersB.has(u));
        if (shared) neighbors.push(langB);
      }
      adjacency.set(langA, neighbors.length > 0 ? neighbors : languages.filter(l => l !== langA));
    }

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
      .delete({ count: 'exact' })
      .lt('created_at', thirtyDaysAgoStr);

    stats.events_pruned = count ?? 0;

    console.log('[cron/kingdom-wars]', stats);
    return res.json({ ok: true, ...stats });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[cron/kingdom-wars] Fatal:', msg);
    return res.status(500).json({ error: msg });
  }
}

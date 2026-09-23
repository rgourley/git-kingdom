/**
 * GET /api/cron/refresh-pushed
 *
 * Lightweight cron that refreshes `pushed_at`, stars, forks, open issues, and size
 * for all repos in the DB. It queries GitHub's repos API once per owner.
 * That one response has all of these fields for each repo of the owner.
 *
 * Designed for Vercel Cron — runs every 6 hours.
 * Also callable manually (admin-only).
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createServiceClient } from '../lib/supabase';
import { getNextToken } from '../lib/github-tokens';
import { writeEvent } from '../lib/events';
import { selectAll } from '../lib/select-all';

const GH_API = 'https://api.github.com';

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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Vercel Cron sends Authorization: Bearer <CRON_SECRET>
  // Manual calls must also provide it as a query param or header
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.authorization;
  const isCron = cronSecret && authHeader === `Bearer ${cronSecret}`;
  const isQuerySecret = cronSecret && req.query.secret === cronSecret;

  if (!isCron && !isQuerySecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  let token: string;
  try {
    token = getNextToken();
  } catch {
    return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
  }

  try {
    const supabase = createServiceClient();

    // Get all distinct owners from our repos table
    const repos = await selectAll<{
      id: number; full_name: string; owner_login: string | null; pushed_at: string | null;
      stargazers: number | null; forks: number | null; open_issues: number | null; size_kb: number | null;
    }>((from, to) => supabase
      .from('repos')
      .select('id, full_name, owner_login, pushed_at, stargazers, forks, open_issues, size_kb')
      .gte('stargazers', 1)
      .order('id')
      .range(from, to));

    // Group repos by owner
    const byOwner = new Map<string, string[]>();
    for (const r of repos) {
      const owner = r.owner_login?.toLowerCase();
      if (!owner) continue;
      if (!byOwner.has(owner)) byOwner.set(owner, []);
      byOwner.get(owner)!.push(r.full_name);
    }

    let updated = 0;
    let checked = 0;
    const errors: string[] = [];

    // For each owner, fetch their repos from GitHub (1 API call per owner)
    for (const [owner, repoNames] of byOwner) {
      try {
        // Try user endpoint first, then org
        let ghRepos: any[] = [];
        for (const endpoint of [`/users/${owner}/repos`, `/orgs/${owner}/repos`]) {
          const ghRes = await fetch(
            `${GH_API}${endpoint}?per_page=100&sort=pushed&direction=desc`,
            {
              headers: {
                Authorization: `Bearer ${token}`,
                Accept: 'application/vnd.github.v3+json',
              },
            },
          );
          if (ghRes.ok) {
            ghRepos = await ghRes.json();
            break;
          }
        }

        // Build a map of full_name → GitHub repo
        const ghByName = new Map<string, any>();
        for (const r of ghRepos) {
          if (r.full_name) ghByName.set(r.full_name.toLowerCase(), r);
        }

        // Update our DB for matching repos
        for (const fullName of repoNames) {
          const ghRepo = ghByName.get(fullName.toLowerCase());
          if (!ghRepo?.pushed_at) continue;
          checked++;

          const existing = repos.find(r => r.full_name === fullName);
          const next = {
            pushed_at: ghRepo.pushed_at as string,
            stargazers: (ghRepo.stargazers_count ?? 0) as number,
            forks: (ghRepo.forks_count ?? 0) as number,
            open_issues: (ghRepo.open_issues_count ?? 0) as number,
            size_kb: (ghRepo.size ?? 0) as number,
          };
          // Supabase returns timestamps as "+00:00" and GitHub returns "Z", so compare as times.
          const pushedChanged = !existing?.pushed_at
            || new Date(existing.pushed_at).getTime() !== new Date(next.pushed_at).getTime();
          const statsChanged = existing?.stargazers !== next.stargazers
            || existing?.forks !== next.forks
            || existing?.open_issues !== next.open_issues
            || existing?.size_kb !== next.size_kb;
          if (!pushedChanged && !statsChanged) continue;

          const { error: updateErr } = await supabase
            .from('repos')
            .update({ ...next, updated_at: new Date().toISOString() })
            .eq('full_name', fullName);

          if (updateErr) {
            errors.push(`${fullName}: ${updateErr.message}`);
          } else {
            updated++;
            console.log(`[cron] Updated ${fullName}: pushed_at=${next.pushed_at} stars=${next.stargazers}`);
          }

          // Check for building upgrades. Skip the event if the update failed,
          // because the next run would then announce the same upgrade again.
          if (!updateErr && existing) {
            const oldStars = existing.stargazers ?? 0;
            const newStars = next.stargazers;
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

          // Fetch recent commits to populate citizen thoughts (only when there are new pushes)
          if (!pushedChanged) continue;
          if (!existing) continue;
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
                  .eq('repo_id', existing.id);  // contributors.repo_id is the numeric repos.id
              }
            }
          }
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${owner}: ${msg}`);
      }
    }

    console.log(`[cron/refresh-pushed] Checked ${checked} repos, updated ${updated}, errors: ${errors.length}`);

    res.json({
      ok: true,
      owners: byOwner.size,
      checked,
      updated,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[cron/refresh-pushed] Fatal:', msg);
    res.status(500).json({ error: msg });
  }
}

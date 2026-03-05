/**
 * GET /api/cron/refresh-pushed
 *
 * Lightweight cron that refreshes `pushed_at` for all repos in the DB.
 * Queries GitHub's repos API once per owner (returns pushed_at for all repos),
 * then batch-updates the DB.
 *
 * Designed for Vercel Cron — runs every 6 hours.
 * Also callable manually (admin-only).
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createServiceClient } from '../lib/supabase';

const GH_API = 'https://api.github.com';

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

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
  }

  try {
    const supabase = createServiceClient();

    // Get all distinct owners from our repos table
    const { data: repos, error: fetchErr } = await supabase
      .from('repos')
      .select('full_name, owner_login, pushed_at')
      .gte('stargazers', 1);

    if (fetchErr || !repos) {
      console.error('[cron/refresh-pushed] Failed to fetch repos:', fetchErr?.message);
      return res.status(500).json({ error: 'DB query failed' });
    }

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

        // Build a map of full_name → pushed_at from GitHub
        const ghPushed = new Map<string, string>();
        for (const r of ghRepos) {
          if (r.pushed_at) {
            ghPushed.set(r.full_name.toLowerCase(), r.pushed_at);
          }
        }

        // Update our DB for matching repos
        for (const fullName of repoNames) {
          const ghDate = ghPushed.get(fullName.toLowerCase());
          if (!ghDate) continue;
          checked++;

          // Find existing pushed_at for this repo
          const existing = repos.find(r => r.full_name === fullName);
          if (existing?.pushed_at === ghDate) continue; // no change

          const { error: updateErr } = await supabase
            .from('repos')
            .update({ pushed_at: ghDate, updated_at: new Date().toISOString() })
            .eq('full_name', fullName);

          if (updateErr) {
            errors.push(`${fullName}: ${updateErr.message}`);
          } else {
            updated++;
            console.log(`[cron] Updated pushed_at for ${fullName}: ${ghDate}`);
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

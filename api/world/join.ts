/**
 * POST /api/world/join
 * Authenticated user joins the universal world.
 * Fetches their repos from GitHub, upserts into Supabase Postgres.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createServerClient, createServiceClient } from '../lib/supabase';
import { fetchUserReposAsMetrics } from '../lib/github-server';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Check auth via Supabase session
  const supabase = createServerClient(req, res);
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return res.status(401).json({ error: 'Not signed in' });
  }

  const meta = user.user_metadata;
  const login = meta.user_name || meta.preferred_username;
  if (!login) {
    return res.status(400).json({ error: 'Invalid user metadata' });
  }

  try {
    const service = createServiceClient();

    // Use server-side GitHub token for API calls
    const githubToken = process.env.GITHUB_TOKEN;
    if (!githubToken) {
      return res.status(500).json({ error: 'Server GitHub token not configured' });
    }

    // Fetch user's repos from GitHub (with contributor data)
    const metrics = await fetchUserReposAsMetrics(login, githubToken, 100, 1);
    console.log(`[join] ${login}: found ${metrics.length} repos`);

    let addedRepos = 0;

    for (const m of metrics) {
      // Upsert each repo
      const { data: repo, error: repoErr } = await service.from('repos').upsert({
        full_name: m.repo.full_name.toLowerCase(),
        name: m.repo.name,
        owner_login: m.repo.owner?.login || login,
        owner_avatar: m.repo.owner?.avatar_url || meta.avatar_url,
        description: m.repo.description,
        language: m.repo.language,
        stargazers: m.repo.stargazers_count,
        forks: m.repo.forks_count,
        open_issues: m.repo.open_issues_count,
        size_kb: m.repo.size || 0,
        created_at: m.repo.created_at,
        pushed_at: m.repo.pushed_at || m.repo.updated_at,
        topics: m.repo.topics || [],
        total_commits: m.totalCommits,
        merged_prs: Math.floor(m.totalCommits * 0.3),
        king_login: m.king?.login || null,
        king_avatar: m.king?.avatar_url || null,
        king_contributions: m.king?.contributions || 0,
        fetched_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'full_name' }).select('id').single();

      if (repoErr || !repo) {
        console.warn(`[join] Failed to upsert ${m.repo.full_name}:`, repoErr?.message);
        continue;
      }

      // Upsert contributors for this repo
      if (m.contributors.length > 0) {
        const { error: contribErr } = await service.from('contributors').upsert(
          m.contributors.slice(0, 20).map((c) => ({
            repo_id: repo.id,
            login: c.login,
            avatar_url: c.avatar_url,
            contributions: c.contributions || 0,
          })),
          { onConflict: 'repo_id,login' }
        );
        if (contribErr) {
          console.warn(`[join] Contributors upsert failed for ${m.repo.full_name}:`, contribErr.message);
        }
      }

      // Link user to repo
      try {
        await service.from('user_repos').upsert({
          user_id: user.id,
          repo_id: repo.id,
        }, { onConflict: 'user_id,repo_id' });
      } catch { /* ignore duplicate */ }

      addedRepos++;
    }

    // Count totals for response
    const { count: totalRepos } = await service.from('repos').select('*', { count: 'exact', head: true });
    const { count: totalUsers } = await service.from('users').select('*', { count: 'exact', head: true });

    res.json({
      ok: true,
      addedRepos,
      totalWorldRepos: totalRepos || 0,
      totalWorldUsers: totalUsers || 0,
    });
  } catch (err: any) {
    console.error(`[join] Error for ${login}:`, err?.message);
    res.status(500).json({ error: 'Failed to join world' });
  }
}

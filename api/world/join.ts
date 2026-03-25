/**
 * POST /api/world/join
 * Authenticated user joins the universal world.
 * Fetches their repos from GitHub, upserts into Supabase Postgres.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createServerClient, createServiceClient } from '../lib/supabase';
import { fetchUserReposAsMetrics, metricsToRepoRow } from '../lib/github-server';
import { getNextToken } from '../lib/github-tokens';
import { writeEvent } from '../lib/events';

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

    // Use pooled GitHub token for API calls
    let githubToken: string;
    try {
      githubToken = getNextToken();
    } catch {
      return res.status(500).json({ error: 'Server GitHub token not configured' });
    }

    // Fetch user's repos from GitHub (with contributor data)
    const MAX_REPOS_PER_JOIN = 50;
    const metrics = await fetchUserReposAsMetrics(login, githubToken, MAX_REPOS_PER_JOIN, 1);
    console.log(`[join] ${login}: found ${metrics.length} repos`);

    // Batch all DB operations instead of sequential per-repo
    const repoRows = metrics.map(m => metricsToRepoRow(m, login, meta.avatar_url));

    // 1. Batch upsert all repos (one DB call)
    const { data: upsertedRepos, error: repoErr } = await service.from('repos')
      .upsert(repoRows, { onConflict: 'full_name' })
      .select('id, full_name');

    if (repoErr) {
      console.warn(`[join] Batch repo upsert failed:`, repoErr.message);
      return res.status(500).json({ error: 'Failed to save repos' });
    }

    // Build a map of full_name → repo id for contributor + user_repos linking
    const repoIdMap = new Map<string, number>();
    for (const r of (upsertedRepos || [])) {
      repoIdMap.set(r.full_name, r.id);
    }

    // 2. Batch upsert all contributors (chunked at 500 to stay under PostgREST row limit)
    const allContributors: { repo_id: number; login: string; avatar_url: string; contributions: number }[] = [];
    for (const m of metrics) {
      const repoId = repoIdMap.get(m.repo.full_name.toLowerCase());
      if (!repoId) continue;
      for (const c of m.contributors.slice(0, 20)) {
        allContributors.push({
          repo_id: repoId,
          login: c.login,
          avatar_url: c.avatar_url,
          contributions: c.contributions || 0,
        });
      }
    }

    const CHUNK_SIZE = 500;
    for (let i = 0; i < allContributors.length; i += CHUNK_SIZE) {
      const chunk = allContributors.slice(i, i + CHUNK_SIZE);
      const { error: contribErr } = await service.from('contributors')
        .upsert(chunk, { onConflict: 'repo_id,login' });
      if (contribErr) {
        console.warn(`[join] Contributor upsert chunk ${i / CHUNK_SIZE + 1} failed:`, contribErr.message);
      }
    }

    // 3. Batch upsert all user_repos links (one DB call)
    const userRepoLinks = Array.from(repoIdMap.values()).map(repoId => ({
      user_id: user.id,
      repo_id: repoId,
    }));

    if (userRepoLinks.length > 0) {
      const { error: linkErr } = await service.from('user_repos')
        .upsert(userRepoLinks, { onConflict: 'user_id,repo_id' });
      if (linkErr) {
        console.warn(`[join] Batch user_repos upsert failed:`, linkErr.message);
      }
    }

    const addedRepos = repoIdMap.size;
    const addedRepoNames = Array.from(repoIdMap.keys());

    // Log activity for admin visibility
    console.log(`[join] ${login}: added ${addedRepos} repos: ${addedRepoNames.join(', ')}`);

    await writeEvent('citizen_joined', {
      username: login,
      repo_count: metrics.length,
    });

    // Count totals for response
    const { count: totalRepos } = await service.from('repos').select('*', { count: 'exact', head: true });
    const { count: totalUsers } = await service.from('users').select('*', { count: 'exact', head: true });

    res.json({
      ok: true,
      login,
      addedRepos,
      addedRepoNames,
      totalWorldRepos: totalRepos || 0,
      totalWorldUsers: totalUsers || 0,
    });
  } catch (err: any) {
    console.error(`[join] Error for ${login}:`, err?.message);
    res.status(500).json({ error: 'Failed to join world' });
  }
}

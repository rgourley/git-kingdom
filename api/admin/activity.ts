/**
 * GET /api/admin/activity
 * Returns recent repo additions and user joins for the admin dashboard.
 * Protected: only ADMIN_LOGINS (env var) can access.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createServerClient, createServiceClient } from '../lib/supabase';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Auth check
  const supabase = createServerClient(req, res);
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return res.status(401).json({ error: 'Not signed in' });
  }

  const meta = user.user_metadata;
  const login = meta.user_name || meta.preferred_username;

  // Only allow configured admin users
  const adminLogins = (process.env.ADMIN_LOGINS || 'rgourley').split(',').map(s => s.trim().toLowerCase());
  if (!adminLogins.includes(login?.toLowerCase())) {
    return res.status(403).json({ error: 'Not authorized' });
  }

  try {
    const service = createServiceClient();
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);

    // Recently added/updated repos (sorted by fetched_at = when they were last synced to our DB)
    const { data: recentRepos, error: reposErr } = await service
      .from('repos')
      .select('full_name, owner_login, owner_avatar, language, stargazers, total_commits, fetched_at, updated_at')
      .order('fetched_at', { ascending: false })
      .limit(limit);

    if (reposErr) {
      console.error('[admin/activity] Repos query error:', reposErr.message);
      return res.status(500).json({ error: 'Failed to fetch activity' });
    }

    // All registered users
    const { data: users, error: usersErr } = await service
      .from('users')
      .select('login, avatar_url')
      .order('login');

    if (usersErr) {
      console.error('[admin/activity] Users query error:', usersErr.message);
    }

    // World stats
    const { count: totalRepos } = await service.from('repos').select('*', { count: 'exact', head: true });
    const { count: totalUsers } = await service.from('users').select('*', { count: 'exact', head: true });
    const { count: totalContributors } = await service.from('contributors').select('login', { count: 'exact', head: true });

    // Language breakdown
    const { data: allRepos } = await service.from('repos').select('language, stargazers').gte('stargazers', 1);
    const langMap: Record<string, { repos: number; stars: number }> = {};
    for (const r of allRepos || []) {
      const lang = r.language || 'null';
      if (!langMap[lang]) langMap[lang] = { repos: 0, stars: 0 };
      langMap[lang].repos++;
      langMap[lang].stars += r.stargazers || 0;
    }
    const languages = Object.entries(langMap)
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.repos - a.repos);

    // GitHub API quota
    let githubQuota = null;
    try {
      const healthRes = await fetch(`https://${req.headers.host}/api/health`);
      if (healthRes.ok) {
        const health = await healthRes.json();
        githubQuota = health.checks?.github;
      }
    } catch { /* non-critical */ }

    // Group repos by fetched_at date to show "batches" (each join creates a batch)
    const activity: { date: string; owner: string; avatar: string; repos: any[] }[] = [];
    const batchMap = new Map<string, { owner: string; avatar: string; repos: any[] }>();

    for (const r of recentRepos || []) {
      // Group by owner + fetched minute (repos from same join are fetched within the same minute)
      const fetchedMin = r.fetched_at ? r.fetched_at.substring(0, 16) : 'unknown'; // YYYY-MM-DDTHH:MM
      const key = `${r.owner_login}|${fetchedMin}`;

      if (!batchMap.has(key)) {
        batchMap.set(key, { owner: r.owner_login, avatar: r.owner_avatar, repos: [] });
      }
      batchMap.get(key)!.repos.push({
        full_name: r.full_name,
        language: r.language,
        stargazers: r.stargazers,
        total_commits: r.total_commits,
      });
    }

    for (const [key, batch] of batchMap) {
      const date = key.split('|')[1] || '';
      activity.push({ date, ...batch });
    }

    res.setHeader('Cache-Control', 'private, no-cache');
    res.json({
      stats: {
        totalRepos: totalRepos || 0,
        totalUsers: totalUsers || 0,
        totalContributors: totalContributors || 0,
      },
      languages,
      githubQuota,
      users: users || [],
      activity,
    });
  } catch (err: any) {
    console.error('[admin/activity] Error:', err?.message);
    res.status(500).json({ error: 'Internal error' });
  }
}

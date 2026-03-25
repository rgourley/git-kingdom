/**
 * GET /api/citizens
 * Returns recent citizens and total citizen count.
 *
 * Query params:
 *   ?page=1&limit=20  — paginated list (default: page 1, limit 20)
 *
 * Response includes:
 *   - citizens: array of { login, avatar_url, top_repos[] }
 *   - total: total unique citizen count (contributors + registered users)
 *   - page, limit, totalPages
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createServiceClient } from './lib/supabase';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const supabase = createServiceClient();
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string, 10) || 20));
    const offset = (page - 1) * limit;

    // Get total unique contributor count
    const { count: totalContributors } = await supabase
      .from('contributors')
      .select('login', { count: 'exact', head: true });

    // Get registered users count
    const { count: totalUsers } = await supabase
      .from('users')
      .select('*', { count: 'exact', head: true });

    // Total unique citizens across all repos (contributors table)
    // Used for the title screen count — padded to 200 minimum on the frontend
    const total = totalContributors || 0;

    // Get recently registered users with their top repos
    const { data: users, error } = await supabase
      .from('users')
      .select('login, avatar_url, id')
      .order('id', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('[/api/citizens] Error:', error.message);
      return res.status(500).json({ error: 'Failed to fetch citizens' });
    }

    // Fetch repos for all users in one query (avoids N+1)
    const userIds = (users || []).map(u => u.id);
    const { data: allUserRepos } = await supabase
      .from('user_repos')
      .select('user_id, repos(full_name, name, language, stargazers)')
      .in('user_id', userIds);

    // Group repos by user
    const reposByUser = new Map<string, any[]>();
    for (const ur of (allUserRepos || [])) {
      if (!ur.repos || ur.repos.stargazers < 1) continue;
      const list = reposByUser.get(ur.user_id) || [];
      list.push(ur.repos);
      reposByUser.set(ur.user_id, list);
    }

    const citizens = (users || []).map(u => {
      const userRepos = (reposByUser.get(u.id) || [])
        .sort((a: any, b: any) => b.stargazers - a.stargazers)
        .slice(0, 3)
        .map((r: any) => ({
          full_name: r.full_name,
          name: r.name,
          language: r.language,
          stars: r.stargazers,
        }));

      return {
        login: u.login,
        avatar_url: u.avatar_url,
        top_repos: userRepos,
      };
    });

    // Cache for 5 minutes
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
    res.json({
      citizens,
      total,
      page,
      limit,
      totalPages: Math.ceil((totalUsers || 0) / limit),
    });
  } catch (err: any) {
    console.error('[/api/citizens] Error:', err?.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

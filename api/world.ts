/**
 * GET /api/world
 * Returns repos from Supabase Postgres in KingdomMetrics[] format.
 *
 * Without params: returns ALL repos (full world). Cached 1 hour at edge.
 * With ?since=ISO: returns only repos added/updated after that timestamp.
 *   Used by client to merge delta on top of pre-baked default-world.json.
 *   Short 60s edge cache so new claims show up quickly.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createServiceClient } from './lib/supabase';

function mapRepoRow(r: any) {
  return {
    repo: {
      full_name: r.full_name,
      name: r.name,
      description: r.description,
      stargazers_count: r.stargazers,
      forks_count: r.forks,
      open_issues_count: r.open_issues,
      language: r.language,
      created_at: r.created_at,
      pushed_at: r.pushed_at,
      size: r.size_kb,
      default_branch: r.default_branch || 'main',
      has_wiki: r.has_wiki || false,
      license: r.license_spdx ? { spdx_id: r.license_spdx } : null,
      topics: r.topics || [],
    },
    contributors: (r.contributors || []).map((c: any) => ({
      login: c.login,
      contributions: c.contributions,
      avatar_url: c.avatar_url,
    })),
    totalCommits: r.total_commits,
    mergedPRs: r.merged_prs,
    king: r.king_login ? {
      login: r.king_login,
      contributions: r.king_contributions,
      avatar_url: r.king_avatar,
    } : null,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const supabase = createServiceClient();
    const since = req.query.since as string | undefined;

    let query = supabase
      .from('repos')
      .select('*, contributors(*)')
      .gte('stargazers', 1)  // Only repos with at least 1 star
      .order('stargazers', { ascending: false });

    // Delta mode: only repos added/updated after the given timestamp
    if (since) {
      query = query.gt('updated_at', since);
    }

    const { data: repos, error } = await query;

    if (error) {
      console.error('[/api/world] Supabase error:', error.message);
      return res.status(200).json({ repos: [], users: [], updatedAt: new Date().toISOString() });
    }

    const metrics = (repos || []).map(mapRepoRow);

    // Fetch registered users
    const { data: users } = await supabase.from('users').select('login');

    // Delta queries get short cache (new claims show up fast)
    // Full queries get long cache (bulk data doesn't change often)
    const maxAge = since ? 60 : 3600;
    const swr = since ? 120 : 7200;
    res.setHeader('Cache-Control', `public, s-maxage=${maxAge}, stale-while-revalidate=${swr}`);
    res.json({
      repos: metrics,
      users: (users || []).map((u: any) => u.login),
      updatedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error('[/api/world] Error:', err?.message);
    res.status(200).json({ repos: [], users: [], updatedAt: new Date().toISOString() });
  }
}

/**
 * GET /api/health
 * Quick health check: DB connectivity + GitHub API quota remaining.
 * Use for monitoring during traffic spikes.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createServiceClient } from './lib/supabase';
import { getAllTokens } from './lib/github-tokens';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const checks: Record<string, any> = {};

  // 1. Database check
  try {
    const supabase = createServiceClient();
    const { count, error } = await supabase
      .from('repos')
      .select('*', { count: 'exact', head: true });
    checks.database = { ok: !error, repoCount: count };
  } catch (err: any) {
    checks.database = { ok: false, error: err?.message };
  }

  // 2. GitHub API quota check (one call per token)
  try {
    const tokens = getAllTokens();
    const quotas = await Promise.all(
      tokens.map(async (token, i) => {
        const ghRes = await fetch('https://api.github.com/rate_limit', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!ghRes.ok) return { token: i + 1, ok: false };
        const data = await ghRes.json();
        const core = data.resources?.core;
        return {
          token: i + 1,
          ok: true,
          remaining: core?.remaining,
          limit: core?.limit,
          resetsAt: core?.reset ? new Date(core.reset * 1000).toISOString() : null,
        };
      }),
    );
    checks.github = { ok: quotas.every(q => q.ok), tokens: quotas };
  } catch (err: any) {
    checks.github = { ok: false, error: err?.message };
  }

  const allOk = Object.values(checks).every((c: any) => c.ok);

  res.setHeader('Cache-Control', 'no-store');
  res.status(allOk ? 200 : 503).json({
    status: allOk ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    checks,
  });
}

/**
 * POST /api/repo/add
 * Public endpoint — anyone can submit a GitHub repo URL to add it to the world.
 * No auth required. Rate-limited per IP via Redis. CAPTCHA-protected.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createServiceClient } from '../lib/supabase';
import { fetchRepoMetrics } from '../lib/github-server';
import { checkMinuteLimit, checkDailyLimit } from '../lib/rate-limit';
import { getNextToken } from '../lib/github-tokens';
import { verifyTurnstile } from '../lib/turnstile';

/** Extract owner/repo from a GitHub URL or "owner/repo" string */
function parseRepoInput(input: string): { owner: string; repo: string } | null {
  const trimmed = input.trim();
  try {
    const url = new URL(trimmed);
    if (url.hostname === 'github.com' || url.hostname === 'www.github.com') {
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts.length >= 2) return { owner: parts[0], repo: parts[1] };
    }
  } catch { /* not a URL */ }
  const slashMatch = trimmed.match(/^([a-zA-Z0-9][\w-]{0,37}[a-zA-Z0-9]?)\/([a-zA-Z0-9._-]{1,100})$/);
  if (slashMatch) return { owner: slashMatch[1], repo: slashMatch[2] };
  return null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
    || req.socket?.remoteAddress || 'unknown';

  // 1. Turnstile CAPTCHA verification FIRST — before rate-limit increments
  //    so bots failing CAPTCHA don't burn legitimate users' rate-limit slots
  const { turnstileToken } = req.body || {};
  if (process.env.TURNSTILE_SECRET_KEY && !turnstileToken) {
    return res.status(400).json({ error: 'CAPTCHA verification required.' });
  }
  if (turnstileToken) {
    const verification = await verifyTurnstile(turnstileToken, ip);
    if (!verification.success) {
      return res.status(403).json({ error: 'CAPTCHA verification failed.' });
    }
  }

  // 2. Per-minute rate limit (5 req/min per IP) and daily cap (20 repos/day per IP) — checked in parallel
  const [minuteLimit, dailyLimit] = await Promise.all([
    checkMinuteLimit(ip),
    checkDailyLimit(ip),
  ]);
  if (minuteLimit.limited) {
    return res.status(429).json({
      error: 'Too many requests. Try again in a minute.',
      retryAfter: Math.ceil(minuteLimit.resetInMs / 1000),
    });
  }
  if (dailyLimit.limited) {
    return res.status(429).json({
      error: 'Daily limit reached. Come back tomorrow!',
      retryAfter: Math.ceil(dailyLimit.resetInMs / 1000),
    });
  }

  // 4. Parse input
  const { url, owner, repo } = req.body || {};
  const parsed = url ? parseRepoInput(url) : (owner && repo ? { owner, repo } : null);
  if (!parsed) {
    return res.status(400).json({ error: 'Provide a GitHub URL or owner/repo.' });
  }

  try {
    const service = createServiceClient();
    const fullName = `${parsed.owner}/${parsed.repo}`.toLowerCase();

    // 5. Check if repo was recently fetched (skip re-fetch within 24h)
    const { data: existing } = await service.from('repos')
      .select('id, fetched_at')
      .eq('full_name', fullName)
      .single();

    if (existing?.fetched_at) {
      const fetchedAge = Date.now() - new Date(existing.fetched_at).getTime();
      if (fetchedAge < 24 * 60 * 60 * 1000) {
        return res.json({ ok: true, repo: fullName, already: true, message: 'Repo already in the world!' });
      }
    }

    // 6. Fetch from GitHub using pooled token
    const token = getNextToken();
    const metrics = await fetchRepoMetrics(parsed.owner, parsed.repo, token);
    if (!metrics) {
      return res.status(404).json({ error: 'Repo not found on GitHub.' });
    }

    // Reject repos with 0 stars (they don't appear on the map)
    if (metrics.repo.stargazers_count < 1) {
      return res.status(400).json({ error: 'Repo needs at least 1 star to join the kingdom.' });
    }

    // 7. Upsert repo
    const { data: repoRow, error: repoErr } = await service.from('repos').upsert({
      full_name: metrics.repo.full_name.toLowerCase(),
      name: metrics.repo.name,
      owner_login: metrics.repo.owner?.login || parsed.owner,
      owner_avatar: metrics.repo.owner?.avatar_url || '',
      description: metrics.repo.description,
      language: metrics.repo.language,
      stargazers: metrics.repo.stargazers_count,
      forks: metrics.repo.forks_count,
      open_issues: metrics.repo.open_issues_count,
      size_kb: metrics.repo.size || 0,
      created_at: metrics.repo.created_at,
      pushed_at: metrics.repo.pushed_at || metrics.repo.updated_at,
      topics: metrics.repo.topics || [],
      total_commits: metrics.totalCommits,
      merged_prs: Math.floor(metrics.totalCommits * 0.3),
      king_login: metrics.king?.login || null,
      king_avatar: metrics.king?.avatar_url || null,
      king_contributions: metrics.king?.contributions || 0,
      fetched_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'full_name' }).select('id').single();

    if (repoErr || !repoRow) {
      console.warn(`[add] Failed to upsert ${fullName}:`, repoErr?.message);
      return res.status(500).json({ error: 'Failed to save repo.' });
    }

    if (metrics.contributors.length > 0) {
      await service.from('contributors').upsert(
        metrics.contributors.slice(0, 20).map(c => ({
          repo_id: repoRow.id,
          login: c.login,
          avatar_url: c.avatar_url,
          contributions: c.contributions || 0,
        })),
        { onConflict: 'repo_id,login' },
      );
    }

    console.log(`[add] ${fullName} added (${metrics.repo.language || 'no lang'}, ${metrics.repo.stargazers_count}★)`);

    res.json({
      ok: true,
      repo: metrics.repo.full_name,
      language: metrics.repo.language || 'Uncharted',
      stars: metrics.repo.stargazers_count,
    });
  } catch (err: any) {
    console.error(`[add] Error:`, err?.message);
    res.status(500).json({ error: 'Failed to add repo.' });
  }
}

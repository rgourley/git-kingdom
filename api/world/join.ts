/**
 * POST /api/world/join
 * Authenticated user joins the universal world.
 * Fetches their qualifying repos from GitHub and adds them to the world snapshot.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSession } from '../lib/session';
import { registerUser, setUserRepos, rebuildWorldSnapshot } from '../lib/kv';
import { fetchUserReposAsMetrics } from '../lib/github-server';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const session = getSession(req);
  if (!session) {
    return res.status(401).json({ error: 'Not signed in' });
  }

  try {
    // Register the user
    await registerUser({
      login: session.login,
      github_id: session.github_id,
      avatar_url: session.avatar_url,
      joined_at: new Date().toISOString(),
    });

    // Fetch repos directly from listing — 1 API call, no per-repo fetches.
    // Contributors are left empty and fetched lazily when entering a city.
    const metrics = await fetchUserReposAsMetrics(session.login, session.token, 100, 0);
    console.log(`[join] ${session.login}: found ${metrics.length} repos (1 API call)`);

    if (metrics.length > 0) {
      await setUserRepos(session.login, metrics);
    }

    // Rebuild the universal world snapshot (deduplicates by full_name)
    const snapshot = await rebuildWorldSnapshot();

    res.json({
      ok: true,
      addedRepos: metrics.length,
      totalWorldRepos: snapshot.repos.length,
      totalWorldUsers: snapshot.users.length,
    });
  } catch (err: any) {
    console.error(`[join] Error for ${session.login}:`, err);
    res.status(500).json({ error: 'Failed to join world' });
  }
}

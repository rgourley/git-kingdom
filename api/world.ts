/**
 * GET /api/world
 * Returns the universal world snapshot — all repos from all registered users.
 * Cached at Vercel's edge for 5 minutes.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getWorldSnapshot } from './lib/kv';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const snapshot = await getWorldSnapshot();

    if (!snapshot || snapshot.repos.length === 0) {
      // No world data yet — return empty (client will fall back to DEFAULT_REPOS)
      return res.status(200).json({
        repos: [],
        users: [],
        updatedAt: new Date().toISOString(),
      });
    }

    // Cache at Vercel edge for 5 minutes, stale-while-revalidate for 10 min
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
    res.json(snapshot);
  } catch (err: any) {
    console.error('[/api/world] Error:', err);
    // Return empty world on error — client will gracefully fall back
    res.status(200).json({
      repos: [],
      users: [],
      updatedAt: new Date().toISOString(),
    });
  }
}

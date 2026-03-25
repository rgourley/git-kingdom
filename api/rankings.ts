/**
 * GET /api/rankings
 * Returns current kingdom rankings and active/recent battles.
 * Public — no auth required.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createServiceClient } from './lib/supabase';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const supabase = createServiceClient();

    const [rankingsRes, battlesRes] = await Promise.all([
      supabase.from('kingdom_rankings').select('*').order('rank', { ascending: true }),
      supabase.from('kingdom_battles').select('*').order('started_at', { ascending: false }).limit(10),
    ]);

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');
    return res.json({
      rankings: rankingsRes.data ?? [],
      battles: battlesRes.data ?? [],
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: msg });
  }
}

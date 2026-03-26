/**
 * GET /api/events?since=<ISO timestamp>
 * Returns recent world events for the live feed.
 * Public — no auth required.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createServiceClient } from './lib/supabase';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const since = typeof req.query.since === 'string' ? req.query.since : undefined;
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string, 10) || 20));

  try {
    const supabase = createServiceClient();
    let query = supabase
      .from('world_events')
      .select('id, event_type, payload, created_at');

    if (since) {
      // Time-based: events after a timestamp (ascending for replay)
      query = query.gte('created_at', since).order('created_at', { ascending: true });
    } else {
      // Latest N: most recent events (descending, then reversed client-side for display)
      query = query.order('created_at', { ascending: false });
    }

    const { data, error } = await query.limit(limit);

    if (error) {
      console.error('[api/events] Query failed:', error.message);
      return res.status(500).json({ error: 'Query failed' });
    }

    res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');
    return res.json(data ?? []);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[api/events] Fatal:', msg);
    return res.status(500).json({ error: msg });
  }
}

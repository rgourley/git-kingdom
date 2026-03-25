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

  const since = typeof req.query.since === 'string'
    ? req.query.since
    : new Date(Date.now() - 60 * 60 * 1000).toISOString(); // default: 1 hour ago

  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from('world_events')
      .select('id, event_type, payload, created_at')
      .gte('created_at', since)
      .order('created_at', { ascending: true })
      .limit(50);

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

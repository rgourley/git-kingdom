/**
 * GET /api/sitemap/repos?page=1 — Repo pages sitemap.
 *
 * Returns up to 40 000 /{owner}/{repo} URLs per page, ordered by stars
 * descending so the most important repos appear in earlier pages.
 * Cached at Vercel edge for 24 hours.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const BASE_URL = 'https://gitkingdom.com';
const PAGE_SIZE = 40_000;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).end('Method not allowed');

  const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  try {
    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    const { data: repos } = await supabase
      .from('repos')
      .select('full_name')
      .order('stargazers', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);

    const today = new Date().toISOString().split('T')[0];

    let xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
`;

    if (repos) {
      for (const repo of repos) {
        // Encode each path segment separately (full_name contains a slash)
        const [owner, ...nameParts] = repo.full_name.split('/');
        const name = nameParts.join('/');
        xml += `  <url>
    <loc>${BASE_URL}/${encodeURIComponent(owner)}/${encodeURIComponent(name)}</loc>
    <changefreq>weekly</changefreq>
    <priority>0.6</priority>
    <lastmod>${today}</lastmod>
  </url>
`;
      }
    }

    xml += `</urlset>`;

    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=172800');
    return res.send(xml);
  } catch (err: any) {
    console.error('[sitemap/repos] Error:', err?.message);
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=60');
    return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>`);
  }
}

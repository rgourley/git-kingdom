/**
 * GET /api/sitemap/users?page=1 — User + citizen pages sitemap.
 *
 * For each unique repo owner produces two URLs:
 *   /{username}          — world map highlighting the user's repos
 *   /citizen/{username}  — character sheet page
 *
 * Up to 20 000 users (40 000 URLs) per page.
 * Cached at Vercel edge for 24 hours.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const BASE_URL = 'https://gitkingdom.com';
const MAX_URLS = 40_000;
const USERS_PER_PAGE = Math.floor(MAX_URLS / 2); // 2 URLs per user

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).end('Method not allowed');

  const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);

  try {
    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    // Fetch all owner logins and deduplicate in JS
    // (Supabase JS client doesn't support SELECT DISTINCT directly)
    const { data: ownerRows } = await supabase
      .from('repos')
      .select('owner_login')
      .limit(100_000);

    const allOwners = ownerRows
      ? [...new Set(ownerRows.map(r => r.owner_login))].sort()
      : [];

    const offset = (page - 1) * USERS_PER_PAGE;
    const pageOwners = allOwners.slice(offset, offset + USERS_PER_PAGE);

    const today = new Date().toISOString().split('T')[0];

    let xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
`;

    for (const owner of pageOwners) {
      const encoded = encodeURIComponent(owner);
      // User profile page
      xml += `  <url>
    <loc>${BASE_URL}/${encoded}</loc>
    <changefreq>weekly</changefreq>
    <priority>0.5</priority>
    <lastmod>${today}</lastmod>
  </url>
`;
      // Citizen character sheet
      xml += `  <url>
    <loc>${BASE_URL}/citizen/${encoded}</loc>
    <changefreq>weekly</changefreq>
    <priority>0.5</priority>
    <lastmod>${today}</lastmod>
  </url>
`;
    }

    xml += `</urlset>`;

    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=172800');
    return res.send(xml);
  } catch (err: any) {
    console.error('[sitemap/users] Error:', err?.message);
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=60');
    return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>`);
  }
}

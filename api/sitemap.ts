/**
 * GET /sitemap.xml — Sitemap index.
 *
 * Lists sub-sitemaps for static pages, repos, and users/citizens.
 * Each sub-sitemap is paginated at 40 000 URLs to stay well under the
 * 50 000-URL / 50 MB limits per sitemap file.
 * Cached at Vercel edge for 24 hours.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const BASE_URL = 'https://gitkingdom.com';
const MAX_URLS_PER_SITEMAP = 40_000;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).end('Method not allowed');

  try {
    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    // Count total repos
    const { count: repoCount } = await supabase
      .from('repos')
      .select('*', { count: 'exact', head: true });

    // Count unique owners (each owner produces 2 URLs: /{user} + /citizen/{user})
    const { data: ownerRows } = await supabase
      .from('repos')
      .select('owner_login')
      .limit(100_000);

    const uniqueOwnerCount = ownerRows
      ? new Set(ownerRows.map(r => r.owner_login)).size
      : 0;

    const totalRepos = repoCount || 0;
    const repoPages = Math.max(1, Math.ceil(totalRepos / MAX_URLS_PER_SITEMAP));
    const usersPerPage = Math.floor(MAX_URLS_PER_SITEMAP / 2); // 2 URLs per user
    const userPages = Math.max(1, Math.ceil(uniqueOwnerCount / usersPerPage));

    const today = new Date().toISOString().split('T')[0];

    let xml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap>
    <loc>${BASE_URL}/api/sitemap/static</loc>
    <lastmod>${today}</lastmod>
  </sitemap>
`;

    for (let i = 1; i <= repoPages; i++) {
      xml += `  <sitemap>
    <loc>${BASE_URL}/api/sitemap/repos?page=${i}</loc>
    <lastmod>${today}</lastmod>
  </sitemap>
`;
    }

    for (let i = 1; i <= userPages; i++) {
      xml += `  <sitemap>
    <loc>${BASE_URL}/api/sitemap/users?page=${i}</loc>
    <lastmod>${today}</lastmod>
  </sitemap>
`;
    }

    xml += `</sitemapindex>`;

    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=172800');
    return res.send(xml);
  } catch (err: any) {
    console.error('[sitemap index] Error:', err?.message);
    const today = new Date().toISOString().split('T')[0];
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=60');
    return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap>
    <loc>${BASE_URL}/api/sitemap/static</loc>
    <lastmod>${today}</lastmod>
  </sitemap>
</sitemapindex>`);
  }
}

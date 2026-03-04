/**
 * GET /sitemap.xml — Dynamic XML sitemap.
 *
 * Queries Supabase for all languages and top repos,
 * generates a sitemap for search engine crawlers.
 * Cached at Vercel edge for 24 hours.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const BASE_URL = 'https://gitkingdom.dev';

// Languages that form kingdoms (lowercase slugs)
const LANGUAGE_SLUGS = [
  'javascript', 'typescript', 'python', 'rust', 'go', 'ruby', 'java',
  'c', 'c++', 'c#', 'php', 'swift', 'kotlin', 'shell',
];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).end('Method not allowed');
  }

  try {
    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    // Fetch top repos by stars (limit to most significant ones)
    const { data: repos } = await supabase
      .from('repos')
      .select('full_name, language')
      .order('stargazers', { ascending: false })
      .limit(200);

    const today = new Date().toISOString().split('T')[0];

    let xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${BASE_URL}/</loc>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
    <lastmod>${today}</lastmod>
  </url>
`;

    // Language kingdom pages
    for (const slug of LANGUAGE_SLUGS) {
      xml += `  <url>
    <loc>${BASE_URL}/${encodeURIComponent(slug)}</loc>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
    <lastmod>${today}</lastmod>
  </url>
`;
    }

    // Top repo pages
    if (repos) {
      for (const repo of repos) {
        xml += `  <url>
    <loc>${BASE_URL}/${encodeURIComponent(repo.full_name)}</loc>
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
    console.error('[/api/sitemap] Error:', err?.message);
    // Return minimal sitemap on error
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=60');
    return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${BASE_URL}/</loc><priority>1.0</priority></url>
</urlset>`);
  }
}

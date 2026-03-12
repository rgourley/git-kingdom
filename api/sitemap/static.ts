/**
 * GET /api/sitemap/static — Static pages + language kingdoms.
 *
 * ~20 URLs that never need pagination.
 * Cached at Vercel edge for 24 hours.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';

const BASE_URL = 'https://gitkingdom.com';

const STATIC_PAGES = [
  { loc: '/', changefreq: 'daily', priority: '1.0' },
  { loc: '/about', changefreq: 'monthly', priority: '0.5' },
  { loc: '/how-it-works', changefreq: 'monthly', priority: '0.5' },
  { loc: '/faq', changefreq: 'monthly', priority: '0.5' },
  { loc: '/changelog', changefreq: 'weekly', priority: '0.4' },
  { loc: '/privacy', changefreq: 'yearly', priority: '0.3' },
];

const LANGUAGE_SLUGS = [
  'javascript', 'typescript', 'python', 'rust', 'go', 'ruby', 'java',
  'c', 'c++', 'c#', 'php', 'swift', 'kotlin', 'shell',
];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).end('Method not allowed');

  const today = new Date().toISOString().split('T')[0];

  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
`;

  for (const page of STATIC_PAGES) {
    xml += `  <url>
    <loc>${BASE_URL}${page.loc}</loc>
    <changefreq>${page.changefreq}</changefreq>
    <priority>${page.priority}</priority>
    <lastmod>${today}</lastmod>
  </url>
`;
  }

  for (const slug of LANGUAGE_SLUGS) {
    xml += `  <url>
    <loc>${BASE_URL}/${encodeURIComponent(slug)}</loc>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
    <lastmod>${today}</lastmod>
  </url>
`;
  }

  xml += `</urlset>`;

  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=172800');
  return res.send(xml);
}

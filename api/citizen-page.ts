/**
 * GET /api/citizen-page?username={username}
 * Serves citizen.html with server-side-rendered meta tags so social crawlers
 * see real character data (title, description, OG image) instead of defaults.
 * The page's client-side JS still runs for rendering the full character sheet.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { readFileSync } from 'fs';
import { join } from 'path';

// Read the static HTML template once at cold-start.
// Vercel's @vercel/node builder traces this readFileSync and bundles citizen.html.
let htmlTemplate: string;
try {
  htmlTemplate = readFileSync(join(__dirname, '..', 'citizen.html'), 'utf-8');
} catch {
  htmlTemplate = '';
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).send('Method not allowed');
  }

  const username = req.query.username as string;

  // If no template loaded or no username, just redirect to static page
  if (!htmlTemplate || !username) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(htmlTemplate || '<html><body>Not found</body></html>');
  }

  let html = htmlTemplate;

  try {
    // Fetch citizen data from the API
    const host = req.headers.host || 'www.gitkingdom.com';
    const protocol = host.includes('localhost') || host.includes('127.0.0.1') ? 'http' : 'https';
    const apiRes = await fetch(
      `${protocol}://${host}/api/citizen?username=${encodeURIComponent(username)}`,
    );

    if (apiRes.ok) {
      const d = await apiRes.json();

      const title = `${d.login} — Level ${d.level} ${d.title.name} of ${d.title.kingdom} | Git Kingdom`;
      const badgeList = d.badges.slice(0, 4).map((b: { label: string }) => b.label).join(', ');
      const desc = `${d.login}'s RPG character sheet: Level ${d.level} ${d.title.name} in the ${d.title.kingdom} Kingdom. ${d.totalContributions.toLocaleString()} contributions, ${d.repos.length} repos. Badges: ${badgeList}.`;
      const ogImage = `https://www.gitkingdom.com/api/citizen-og?username=${encodeURIComponent(d.login)}`;
      const pageUrl = `https://www.gitkingdom.com/citizen/${d.login}`;

      // Replace <title>
      html = html.replace(
        /<title>[^<]*<\/title>/,
        `<title>${esc(title)}</title>`,
      );

      // Replace meta description
      html = html.replace(
        /(<meta\s+name="description"\s+content=")[^"]*(")/,
        `$1${esc(desc)}$2`,
      );

      // Replace OG tags
      html = html.replace(
        /(<meta\s+property="og:title"\s+id="og-title"\s+content=")[^"]*(")/,
        `$1${esc(title)}$2`,
      );
      html = html.replace(
        /(<meta\s+property="og:description"\s+id="og-desc"\s+content=")[^"]*(")/,
        `$1${esc(desc)}$2`,
      );
      html = html.replace(
        /(<meta\s+property="og:image"\s+id="og-image"\s+content=")[^"]*(")/,
        `$1${esc(ogImage)}$2`,
      );
      html = html.replace(
        /(<meta\s+property="og:url"\s+id="og-url")/,
        `$1 content="${esc(pageUrl)}"`,
      );

      // Replace Twitter tags
      html = html.replace(
        /(<meta\s+name="twitter:card"\s+content=")[^"]*(")/,
        `$1summary_large_image$2`,
      );
      html = html.replace(
        /(<meta\s+name="twitter:title"\s+id="tw-title"\s+content=")[^"]*(")/,
        `$1${esc(title)}$2`,
      );
      html = html.replace(
        /(<meta\s+name="twitter:description"\s+id="tw-desc"\s+content=")[^"]*(")/,
        `$1${esc(desc)}$2`,
      );
      html = html.replace(
        /(<meta\s+name="twitter:image"\s+id="tw-image"\s+content=")[^"]*(")/,
        `$1${esc(ogImage)}$2`,
      );

      // Set canonical
      html = html.replace(
        /<link\s+rel="canonical"\s+id="canonical-link"\s*\/?\s*>/,
        `<link rel="canonical" id="canonical-link" href="${esc(pageUrl)}" />`,
      );

      // Inject JSON-LD structured data right before </head>
      const jsonLd = {
        '@context': 'https://schema.org',
        '@type': 'ProfilePage',
        name: title,
        description: desc,
        url: pageUrl,
        image: ogImage,
        mainEntity: {
          '@type': 'Person',
          name: d.login,
          image: d.avatar_url || `https://github.com/${d.login}.png?size=400`,
          url: `https://github.com/${d.login}`,
        },
      };
      html = html.replace(
        '</head>',
        `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>\n</head>`,
      );
    }
  } catch {
    // On error, serve with default meta tags — page JS will update them client-side
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
  res.status(200).send(html);
}

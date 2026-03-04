/**
 * GET /:path — Serverless HTML wrapper for SEO.
 *
 * Reads the built index.html, injects route-specific <title>, meta description,
 * Open Graph, Twitter Card, and JSON-LD based on the URL path.
 * Vercel CDN caches each unique URL for 1 hour — repeat requests are free.
 *
 * Route patterns:
 *   /                  → homepage (default meta)
 *   /typescript        → language kingdom page (if matches known language)
 *   /facebook          → user page (fallback)
 *   /facebook/react    → repo page (query Supabase for metadata)
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

// ─── Known languages (lowercase → display name) ─────────────
const LANGUAGES: Record<string, string> = {
  javascript: 'JavaScript', typescript: 'TypeScript', python: 'Python',
  rust: 'Rust', go: 'Go', ruby: 'Ruby', java: 'Java',
  'c++': 'C++', c: 'C', 'c#': 'C#', php: 'PHP',
  swift: 'Swift', kotlin: 'Kotlin', shell: 'Shell',
};

// ─── Default SEO values (must match index.html exactly for replacement) ──
const DEFAULTS = {
  title: 'Git Kingdom | Explore GitHub as a Fantasy RPG World',
  description: 'Visualize any GitHub profile as a pixel-art fantasy kingdom. Repos become buildings, contributors become walking citizens, and programming languages become kingdoms.',
  url: 'https://gitkingdom.dev/',
};

// ─── Read built index.html once, reuse across invocations ────
let cachedHtml: string | null = null;

function getBaseHtml(): string {
  if (cachedHtml) return cachedHtml;

  // ESM-compatible __dirname
  let dir: string;
  try { dir = dirname(fileURLToPath(import.meta.url)); } catch { dir = process.cwd(); }

  const candidates = [
    join(process.cwd(), 'dist', 'index.html'),
    join(process.cwd(), 'index.html'),
    join(dir, '..', 'dist', 'index.html'),
    join(dir, '..', 'index.html'),
  ];
  for (const p of candidates) {
    try {
      const content = readFileSync(p, 'utf-8');
      if (content.includes('<!DOCTYPE html') || content.includes('<html')) {
        cachedHtml = content;
        return cachedHtml;
      }
    } catch { /* try next */ }
  }

  throw new Error(`Could not load index.html from any candidate path`);
}

// ─── Supabase client (lazy, reused across invocations) ───────
let supabase: ReturnType<typeof createClient> | null = null;

function getSupabase() {
  if (supabase) return supabase;
  supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  return supabase;
}

// ─── SEO data types ──────────────────────────────────────────
interface SeoMeta {
  title: string;
  description: string;
  url: string;
  ogImage?: string;
  jsonLd?: object;
}

// ─── Inject meta tags into HTML ──────────────────────────────
function injectMeta(html: string, meta: SeoMeta): string {
  let result = html;

  // Replace <title>
  result = result.replace(
    `<title>${DEFAULTS.title}</title>`,
    `<title>${esc(meta.title)}</title>`,
  );

  // Replace meta description
  result = result.replace(
    `<meta name="description" content="${DEFAULTS.description}" />`,
    `<meta name="description" content="${esc(meta.description)}" />`,
  );

  // Replace canonical URL
  result = result.replace(
    `<link rel="canonical" href="${DEFAULTS.url}" />`,
    `<link rel="canonical" href="${esc(meta.url)}" />`,
  );

  // Replace OG tags
  result = result.replace(
    `<meta property="og:title" content="${DEFAULTS.title}" />`,
    `<meta property="og:title" content="${esc(meta.title)}" />`,
  );
  result = result.replace(
    `<meta property="og:description" content="${DEFAULTS.description}" />`,
    `<meta property="og:description" content="${esc(meta.description)}" />`,
  );
  result = result.replace(
    `<meta property="og:url" content="${DEFAULTS.url}" />`,
    `<meta property="og:url" content="${esc(meta.url)}" />`,
  );

  // Replace OG image
  if (meta.ogImage) {
    result = result.replace(
      `<meta property="og:image" content="https://gitkingdom.dev/api/og" />`,
      `<meta property="og:image" content="${esc(meta.ogImage)}" />`,
    );
    result = result.replace(
      `<meta name="twitter:image" content="https://gitkingdom.dev/api/og" />`,
      `<meta name="twitter:image" content="${esc(meta.ogImage)}" />`,
    );
  }

  // Replace Twitter tags
  result = result.replace(
    `<meta name="twitter:title" content="${DEFAULTS.title}" />`,
    `<meta name="twitter:title" content="${esc(meta.title)}" />`,
  );
  result = result.replace(
    `<meta name="twitter:description" content="${DEFAULTS.description}" />`,
    `<meta name="twitter:description" content="${esc(meta.description)}" />`,
  );

  // Replace JSON-LD structured data if provided
  if (meta.jsonLd) {
    const defaultLdStart = '<script type="application/ld+json">';
    const defaultLdEnd = '</script>';
    const ldStartIdx = result.indexOf(defaultLdStart);
    const ldEndIdx = result.indexOf(defaultLdEnd, ldStartIdx);
    if (ldStartIdx !== -1 && ldEndIdx !== -1) {
      result = result.substring(0, ldStartIdx)
        + `<script type="application/ld+json">\n${JSON.stringify(meta.jsonLd, null, 2)}\n</script>`
        + result.substring(ldEndIdx + defaultLdEnd.length);
    }
  }

  return result;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatStars(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return n.toString();
}

// ─── Minimal fallback HTML (if index.html can't be loaded) ───
const FALLBACK_HTML = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta http-equiv="refresh" content="0;url=/index.html"><title>Git Kingdom</title></head><body></body></html>`;

// ─── Route handler ───────────────────────────────────────────
export default async function handler(req: VercelRequest, res: VercelResponse) {
  let html: string;
  try {
    html = getBaseHtml();
  } catch (e: any) {
    console.error('[/api/page] Failed to load index.html:', e?.message);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(FALLBACK_HTML);
  }
  const path = (req.url || '/').split('?')[0].replace(/\/+$/, '') || '/';
  const segments = path.split('/').filter(Boolean);

  // Homepage — serve with default meta
  if (segments.length === 0) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=7200');
    return res.send(html);
  }

  const first = segments[0].toLowerCase();

  // Skip static assets — let Vercel serve them directly
  if (['assets', 'data', 'vendor', 'favicon.ico'].includes(first)) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(html);
  }

  try {
    const db = getSupabase();
    const baseUrl = 'https://gitkingdom.dev';

    // ── Two-segment path: /owner/repo ──
    if (segments.length >= 2) {
      const fullName = `${segments[0]}/${segments[1]}`.toLowerCase();

      const { data: repo } = await db.from('repos')
        .select('full_name, name, description, stargazers, language, owner_login')
        .eq('full_name', fullName)
        .single();

      if (repo) {
        const stars = formatStars(repo.stargazers);
        const lang = repo.language || 'Unknown';
        const desc = repo.description
          ? `${repo.description} | ${stars} stars in the ${lang} Kingdom on Git Kingdom.`
          : `${repo.full_name} has ${stars} stars in the ${lang} Kingdom on Git Kingdom.`;

        const ogParams = new URLSearchParams({
          title: repo.full_name,
          stars: formatStars(repo.stargazers),
          lang: lang,
          ...(repo.description ? { desc: repo.description.substring(0, 120) } : {}),
        });
        const meta: SeoMeta = {
          title: `${repo.full_name} | Git Kingdom`,
          description: desc.substring(0, 160),
          url: `${baseUrl}/${repo.full_name}`,
          ogImage: `${baseUrl}/api/og?${ogParams}`,
          jsonLd: {
            '@context': 'https://schema.org',
            '@type': 'SoftwareSourceCode',
            'name': repo.name,
            'codeRepository': `https://github.com/${repo.full_name}`,
            'programmingLanguage': lang,
            'description': repo.description || `${repo.full_name} on Git Kingdom`,
            'isPartOf': {
              '@type': 'WebApplication',
              'name': 'Git Kingdom',
              'url': baseUrl,
            },
          },
        };

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=7200');
        return res.send(injectMeta(html, meta));
      }
    }

    // ── Single-segment path: /language or /username ──
    if (segments.length === 1) {
      // Check if it's a known language
      const langDisplay = LANGUAGES[first];
      if (langDisplay) {
        // Count repos and find top repo for this language
        const { data: langRepos } = await db.from('repos')
          .select('full_name, stargazers')
          .eq('language', langDisplay)
          .order('stargazers', { ascending: false })
          .limit(1);

        const topRepo = langRepos?.[0];
        const { count } = await db.from('repos')
          .select('*', { count: 'exact', head: true })
          .eq('language', langDisplay);

        const repoCount = count || 0;
        const topInfo = topRepo
          ? ` Top castle: ${topRepo.full_name} with ${formatStars(topRepo.stargazers)} stars.`
          : '';

        const langOgParams = new URLSearchParams({
          title: `${langDisplay} Kingdom`,
          subtitle: `${repoCount} repos`,
          ...(topRepo ? { desc: `Top castle: ${topRepo.full_name} (${formatStars(topRepo.stargazers)} stars)` } : {}),
        });
        const meta: SeoMeta = {
          title: `${langDisplay} Kingdom | Git Kingdom`,
          description: `Explore ${repoCount} ${langDisplay} repos as pixel-art buildings in a fantasy RPG city.${topInfo}`.substring(0, 160),
          url: `${baseUrl}/${first}`,
          ogImage: `${baseUrl}/api/og?${langOgParams}`,
          jsonLd: {
            '@context': 'https://schema.org',
            '@type': 'CollectionPage',
            'name': `${langDisplay} Kingdom`,
            'description': `${repoCount} ${langDisplay} repositories visualized as a pixel-art RPG city`,
            'isPartOf': {
              '@type': 'WebApplication',
              'name': 'Git Kingdom',
              'url': baseUrl,
            },
          },
        };

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=7200');
        return res.send(injectMeta(html, meta));
      }

      // Check if it's a known user/org (has repos in our DB)
      const { data: userRepos } = await db.from('repos')
        .select('full_name, stargazers, language')
        .ilike('owner_login', first)
        .order('stargazers', { ascending: false })
        .limit(5);

      if (userRepos && userRepos.length > 0) {
        const topRepoNames = userRepos.slice(0, 3).map(r => r.full_name.split('/')[1]).join(', ');
        const totalStars = userRepos.reduce((s, r) => s + r.stargazers, 0);

        const userOgParams = new URLSearchParams({
          title: segments[0],
          subtitle: `${formatStars(totalStars)} total stars`,
          desc: `Top repos: ${topRepoNames}`,
        });
        const meta: SeoMeta = {
          title: `${segments[0]} | Git Kingdom`,
          description: `Explore ${segments[0]}'s repos on Git Kingdom: ${topRepoNames}. ${formatStars(totalStars)} total stars across ${userRepos.length}+ projects.`.substring(0, 160),
          url: `${baseUrl}/${segments[0]}`,
          ogImage: `${baseUrl}/api/og?${userOgParams}`,
          jsonLd: {
            '@context': 'https://schema.org',
            '@type': 'ProfilePage',
            'name': segments[0],
            'description': `${segments[0]}'s repositories on Git Kingdom`,
            'isPartOf': {
              '@type': 'WebApplication',
              'name': 'Git Kingdom',
              'url': baseUrl,
            },
          },
        };

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=7200');
        return res.send(injectMeta(html, meta));
      }
    }

    // ── Fallback: unknown path — serve default HTML ──
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=7200');
    return res.send(html);

  } catch (err: any) {
    console.error('[/api/page] Error:', err?.message);
    // On any error, still serve the page with default meta
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=60');
    return res.send(html || FALLBACK_HTML);
  }
}

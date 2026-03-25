/**
 * Groups KingdomMetrics into LanguageKingdoms.
 * Extracted from main.ts for testability.
 */
import type { KingdomMetrics, LanguageKingdom, ContributorData, Biome } from './types';

function getBiome(lang: string): Biome {
  const m: Record<string, Biome> = {
    JavaScript: 'grassland', TypeScript: 'grassland', Python: 'forest',
    Rust: 'volcanic', Go: 'mountain', Ruby: 'crystal', Java: 'desert',
    'C++': 'mountain', C: 'mountain', 'C#': 'tundra', PHP: 'forest',
    Swift: 'grassland', Kotlin: 'desert', Shell: 'desert',
    Uncharted: 'mist',
  };
  return m[lang] || 'grassland';
}

/**
 * Filter out non-code "content repos" — awesome-lists, roadmaps, interview prep, etc.
 * GitHub often tags these with a language even though they're curated markdown/docs.
 */
export function isContentRepo(m: KingdomMetrics): boolean {
  const name = (m.repo.name || '').toLowerCase();

  const contentNamePatterns = [
    /^awesome[-_]/, /[-_]awesome$/,
    /[-_]roadmap$/, /^roadmap[-_]/,
    /[-_]interview[s]?$/, /^interview[-_]/,
    /[-_]cheatsheet/, /^cheatsheet/,
    /^clean[-_]code/,
    /^build[-_]your[-_]own/,
    /^(the[-_])?book[-_]of[-_]/,
    /^(the[-_])?art[-_]of[-_]/,
    /^(system[-_])?design[-_](primer|interview)$/,
    /^coding[-_](interview|challenge)/,
    /[-_]best[-_]?practices$/,
    /^papers[-_]we[-_]love$/,
    /^free[-_].*[-_](books|courses|resources)/,
    /^beginners[-_].*[-_]tutorial$/,
  ];

  return contentNamePatterns.some(p => p.test(name));
}

/** Non-programming languages that should always go to Uncharted */
export const LANGUAGE_BLOCKLIST = new Set([
  'HTML', 'CSS', 'SCSS', 'Less', 'Markdown', 'Dockerfile',
  'Makefile', 'Nix', 'HCL', 'Vue', 'Blade', 'FreeMarker',
  'Vim Script', 'LLVM', 'Wren', 'BASIC', 'Batchfile',
  'PowerShell', 'Nunjucks', 'EJS', 'Handlebars', 'Pug',
  'Smarty', 'Twig', 'Mustache', 'XSLT', 'Jsonnet',
]);

/** Minimum repos for a language to get its own kingdom */
export const MIN_REPOS_FOR_KINGDOM = 3;

export function groupByLanguage(allMetrics: KingdomMetrics[]): LanguageKingdom[] {
  const groups = new Map<string, KingdomMetrics[]>();

  for (const m of allMetrics) {
    let lang = m.repo.language || 'Uncharted';
    if (isContentRepo(m)) continue;
    if (LANGUAGE_BLOCKLIST.has(lang)) lang = 'Uncharted';
    if (!groups.has(lang)) groups.set(lang, []);
    groups.get(lang)!.push(m);
  }

  // Languages with fewer than MIN_REPOS_FOR_KINGDOM repos get merged into Uncharted
  const toMerge: string[] = [];
  for (const [language, repos] of groups) {
    if (language !== 'Uncharted' && repos.length < MIN_REPOS_FOR_KINGDOM) {
      toMerge.push(language);
    }
  }
  for (const language of toMerge) {
    const repos = groups.get(language)!;
    const uncharted = groups.get('Uncharted') || [];
    uncharted.push(...repos);
    groups.set('Uncharted', uncharted);
    groups.delete(language);
  }

  const kingdoms: LanguageKingdom[] = [];
  for (const [language, repos] of groups) {
    const commitsByUser = new Map<string, { login: string; contributions: number; avatar_url: string }>();
    for (const r of repos) {
      for (const c of r.contributors) {
        const existing = commitsByUser.get(c.login);
        if (existing) {
          existing.contributions += c.contributions;
        } else {
          commitsByUser.set(c.login, { ...c });
        }
      }
    }

    let king: ContributorData | null = null;
    let maxContrib = 0;
    for (const user of commitsByUser.values()) {
      if (user.contributions > maxContrib) {
        maxContrib = user.contributions;
        king = user;
      }
    }

    repos.sort((a, b) => b.totalCommits - a.totalCommits);

    kingdoms.push({
      language,
      biome: getBiome(language),
      repos,
      king,
      totalCommits: repos.reduce((s, r) => s + r.totalCommits, 0),
      totalStars: repos.reduce((s, r) => s + r.repo.stargazers_count, 0),
    });
  }

  kingdoms.sort((a, b) => b.totalCommits - a.totalCommits);
  return kingdoms;
}

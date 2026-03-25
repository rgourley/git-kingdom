import Phaser from 'phaser';
import { WorldScene } from './scenes/WorldScene';
import { CityScene } from './scenes/CityScene';
import { TitleScene } from './scenes/TitleScene';
import { KingdomMetrics, LanguageKingdom, ContributorData, Biome } from './types';
import { SpritePacks } from './generators/TilesetGenerator';
import { generateTestRepos } from './testdata';
import { parseRoute } from './router';
import { fetchUniversalWorld, fetchCurrentUser, joinWorld, invalidateWorldCache } from './api/client';
import {
  trackPageView, trackGameStart, trackWorldJoined,
  trackGitHubLinkClicked, trackSignInInitiated,
} from './analytics';

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
 * Filter out non-code "content repos" — awesome-lists, roadmaps, interview prep,
 * cheatsheets, etc.  GitHub often tags these with a language (TypeScript, JavaScript)
 * even though they're curated markdown/docs, not real software.
 * Keeping them distorts kingdom rankings (e.g. developer-roadmap was TypeScript's #1).
 */
function isContentRepo(m: KingdomMetrics): boolean {
  const name = (m.repo.name || '').toLowerCase();

  const contentNamePatterns = [
    /^awesome[-_]/, /[-_]awesome$/,                       // awesome-lists
    /[-_]roadmap$/, /^roadmap[-_]/,                       // roadmaps
    /[-_]interview[s]?$/, /^interview[-_]/,               // interview prep
    /[-_]cheatsheet/, /^cheatsheet/,                      // cheatsheets
    /^clean[-_]code/,                                     // clean-code books
    /^build[-_]your[-_]own/,                              // tutorial collections
    /^(the[-_])?book[-_]of[-_]/,                          // book repos
    /^(the[-_])?art[-_]of[-_]/,                           // art-of-X repos
    /^(system[-_])?design[-_](primer|interview)$/,        // system design
    /^coding[-_](interview|challenge)/,                   // interview prep
    /[-_]best[-_]?practices$/,                            // best practices lists
    /^papers[-_]we[-_]love$/,                             // paper collections
    /^free[-_].*[-_](books|courses|resources)/,           // free resource lists
    /^beginners[-_].*[-_]tutorial$/,                      // beginner tutorials (content-only)
  ];

  return contentNamePatterns.some(p => p.test(name));
}

function groupByLanguage(allMetrics: KingdomMetrics[]): LanguageKingdom[] {
  const groups = new Map<string, KingdomMetrics[]>();

  // Non-programming languages that should always go to Uncharted
  const LANGUAGE_BLOCKLIST = new Set([
    'HTML', 'CSS', 'SCSS', 'Less', 'Markdown', 'Dockerfile',
    'Makefile', 'Nix', 'HCL', 'Vue', 'Blade', 'FreeMarker',
    'Vim Script', 'LLVM', 'Wren', 'BASIC', 'Batchfile',
    'PowerShell', 'Nunjucks', 'EJS', 'Handlebars', 'Pug',
    'Smarty', 'Twig', 'Mustache', 'XSLT', 'Jsonnet',
  ]);

  let filtered = 0;
  for (const m of allMetrics) {
    let lang = m.repo.language || 'Uncharted';
    if (isContentRepo(m)) {
      filtered++;
      continue;
    }
    if (LANGUAGE_BLOCKLIST.has(lang)) lang = 'Uncharted';
    if (!groups.has(lang)) groups.set(lang, []);
    groups.get(lang)!.push(m);
  }
  if (filtered > 0) {
    console.log(`Filtered ${filtered} content repos (awesome-lists, roadmaps, etc.)`);
  }

  // Languages with fewer than 3 repos get merged into Uncharted
  const MIN_REPOS_FOR_KINGDOM = 3;
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

// ─── Load world data (Supabase API → pre-baked JSON fallback) ──
async function loadWorldData(loadingEl: HTMLElement): Promise<KingdomMetrics[]> {
  // Try server API first (Supabase Postgres, cached at edge)
  loadingEl.textContent = 'Loading world data...';
  const world = await fetchUniversalWorld();
  if (world && world.repos.length > 0) {
    console.log(`Loaded ${world.repos.length} repos from /api/world`);
    return world.repos;
  }

  // Fall back to pre-baked JSON (generated from Supabase via export script)
  loadingEl.textContent = 'Loading cached world data...';
  try {
    const res = await fetch('/data/default-world.json');
    if (res.ok) {
      const json = await res.json();
      if (json.repos && json.repos.length > 0) {
        console.log(`Loaded ${json.repos.length} repos from default-world.json`);
        return json.repos as KingdomMetrics[];
      }
    }
  } catch {
    console.warn('Failed to load default-world.json');
  }

  return [];
}

// ─── Load sprite pack images ─────────────────────────────────
function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => { console.warn('Failed to load:', src); resolve(img); };
    img.src = src;
  });
}

async function loadSpritePacks(): Promise<SpritePacks> {
  const [grassA2Img, grassA1Img, grassBImg, grassCImg, grassTreesImg, grassFlowersImg,
         townAImg, townBImg, townCImg, townDImg, doorsOutsideImg, doorsInsideImg, desertAImg, desertBImg, caveBImg] = await Promise.all([
    loadImg('/assets/grasslands/A2_tileset_sheet.png'),
    loadImg('/assets/grasslands/A1_tileset_sheet.png'),
    loadImg('/assets/grasslands/B.png'),
    loadImg('/assets/grasslands/C.png'),
    loadImg('/assets/grasslands/Trees.png'),
    loadImg('/assets/grasslands/Flowers.png'),
    loadImg('/assets/town/town_A.png'),
    loadImg('/assets/town/town_B.png'),
    loadImg('/assets/town/town_C.png'),
    loadImg('/assets/town/town_D.png'),
    loadImg('/assets/town/doors_outside.png'),
    loadImg('/assets/town/doors_inside.png'),
    loadImg('/assets/desert/desert_A.png'),
    loadImg('/assets/desert/desert_B.png'),
    loadImg('/assets/cave/cave_B.png'),
  ]);
  const packs = {
    grassA2Img, grassA1Img, grassBImg, grassCImg, grassTreesImg, grassFlowersImg,
    townAImg, townBImg, townCImg, townDImg, doorsOutsideImg, doorsInsideImg, desertAImg, desertBImg, caveBImg,
  };
  console.log('Sprite packs loaded:', Object.entries(packs).map(([k,v]) => `${k}:${v.width}x${v.height}`).join(', '));
  return packs;
}


// ─── Title screen overlay — shown while world loads behind it ─
function showTitleScreen(): { waitForClick: () => Promise<void>; dismiss: () => void } {
  const modal = document.getElementById('entry-modal');
  if (!modal) return { waitForClick: () => Promise.resolve(), dismiss: () => {} };

  modal.style.display = 'flex';
  // Don't hide loading — it shows behind the semi-transparent modal

  let dismissed = false;
  let resolveClick: (() => void) | null = null;

  function dismiss() {
    if (dismissed) return;
    dismissed = true;
    modal!.classList.add('hiding');
    setTimeout(() => { modal!.style.display = 'none'; }, 500);
    if (resolveClick) resolveClick();
  }

  const enterBtn = document.getElementById('btn-enter');
  if (enterBtn) enterBtn.addEventListener('click', dismiss);
  modal.addEventListener('click', (e) => {
    // Dismiss on click anywhere except links (credit link)
    const target = e.target as HTMLElement;
    if (target.tagName === 'A' || target.closest('a')) return;
    dismiss();
  });

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') {
      dismiss();
      document.removeEventListener('keydown', onKey);
    }
  };
  document.addEventListener('keydown', onKey);

  return {
    waitForClick: () => new Promise((resolve) => {
      if (dismissed) { resolve(); return; }
      resolveClick = resolve;
    }),
    dismiss,
  };
}

// ─── Boot Phaser game ────────────────────────────────────────
function createPhaserGame(): Phaser.Game {
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game-container',
    width: window.innerWidth,
    height: window.innerHeight,
    pixelArt: true,
    roundPixels: true,
    backgroundColor: '#3878a8',
    render: {
      antialias: false,
      roundPixels: true,
      pixelArt: true,
    },
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
  });
}

// ─── Main boot ───────────────────────────────────────────────
async function boot() {
  const params = new URLSearchParams(window.location.search);

  // Dev tool: building editor
  if (params.get('editor') === 'building') {
    window.location.href = '/editor.html';
    return;
  }

  const loadingEl = document.getElementById('loading')!;

  // ── Route-based navigation: /username or /username/repo ──
  const route = parseRoute();

  // Fast path: URL route or query params skip the title screen entirely
  const hasUrlParams = params.has('user') || params.has('org') || params.has('repos');

  if (route.username) {
    // Clean URL route: /facebook or /facebook/react
    // Translate to the same flow as ?user=facebook
    params.set('user', route.username);

    // If user just signed in via OAuth, auto-join their repos to the universal world
    // (fire-and-forget — doesn't block the boot)
    fetchCurrentUser().then(user => {
      if (user && user.login.toLowerCase() === route.username!.toLowerCase()) {
        console.log(`[OAuth] Auto-joining world for ${user.login}...`);
        joinWorld().then(result => {
          if (result) {
            console.log(`[OAuth] Joined! Added ${result.addedRepos} repos.`);
            invalidateWorldCache(); // next fetch gets fresh data
            trackWorldJoined({ user_login: user.login, added_repos: result.addedRepos });
          }
        }).catch(err => console.warn('[OAuth] Auto-join failed:', err?.message || err));
      }
    }).catch(err => console.warn('[OAuth] User fetch failed:', err?.message || err));

    // Expose for inline scripts (Add Repo modal)
    (window as any).__invalidateWorldCache = invalidateWorldCache;

    return bootDirect(params, loadingEl, route.repoName);
  }

  if (hasUrlParams) {
    return bootDirect(params, loadingEl);
  }

  // ── Default path: show animated TitleScene city behind the title overlay ──
  // Start prefetching world data immediately (runs in background while title screen shows)
  const worldDataPromise = loadWorldData(loadingEl);

  loadingEl.textContent = 'Loading sprites...';
  const spritePacks = await loadSpritePacks();

  // Create game with TitleScene (animated demo city in the background)
  const game = createPhaserGame();
  game.scene.add('TitleScene', TitleScene, true, { spritePacks });
  game.scene.add('WorldScene', WorldScene, false);
  game.scene.add('CityScene', CityScene, false);

  loadingEl.style.display = 'none';

  // Show the title overlay on top of the animated city
  const titleScreen = showTitleScreen();
  await titleScreen.waitForClick();
  trackGameStart();
  trackPageView('/', 'Git Kingdom | World Map');

  // User clicked — data was prefetched while they were on the title screen
  loadingEl.style.display = 'block';
  loadingEl.textContent = 'Loading kingdom data...';

  const allMetrics = await worldDataPromise;

  if (allMetrics.length === 0) {
    loadingEl.textContent = 'No world data available. Try refreshing.';
    return;
  }

  const languageKingdoms = groupByLanguage(allMetrics);

  const testCount = parseInt(params.get('test') || '0', 10);
  if (testCount > 0) {
    const tsKingdom = languageKingdoms.find(k => k.language === 'TypeScript');
    if (tsKingdom) {
      const synthetics = generateTestRepos(testCount);
      tsKingdom.repos.push(...synthetics);
      tsKingdom.totalStars += synthetics.reduce((s, r) => s + r.repo.stargazers_count, 0);
      tsKingdom.totalCommits += synthetics.reduce((s, r) => s + r.totalCommits, 0);
    }
  }

  loadingEl.textContent = `Building ${languageKingdoms.length} kingdoms...`;

  (window as any).__gitworld = {
    kingdoms: languageKingdoms,
    spritePacks,
    highlightUser: null,
    focusRepo: null,
  };
  (window as any).__game = game;

  // Switch from TitleScene to WorldScene
  game.scene.stop('TitleScene');
  game.scene.start('WorldScene', {
    kingdoms: languageKingdoms,
    spritePacks,
    highlightUser: null,
  });
}

// ─── Direct boot (URL routes / query params — skip title screen) ─
async function bootDirect(
  params: URLSearchParams,
  loadingEl: HTMLElement,
  focusRepo?: string | null,
) {
  // Hide the entry modal immediately (direct navigation skips title screen)
  const modal = document.getElementById('entry-modal');
  if (modal) modal.style.display = 'none';

  // Determine the username from URL route (e.g. /facebook or /facebook/react)
  const highlightUser = params.get('user') || params.get('org') || null;

  // Load world data + sprites in parallel (both are independent)
  loadingEl.textContent = 'Loading world...';
  const [allMetrics, spritePacks] = await Promise.all([
    loadWorldData(loadingEl),
    loadSpritePacks(),
  ]);

  if (allMetrics.length === 0) {
    loadingEl.textContent = 'No world data available. Try refreshing.';
    return;
  }

  const languageKingdoms = groupByLanguage(allMetrics);

  const testCount = parseInt(params.get('test') || '0', 10);
  if (testCount > 0) {
    const tsKingdom = languageKingdoms.find(k => k.language === 'TypeScript');
    if (tsKingdom) {
      const synthetics = generateTestRepos(testCount);
      tsKingdom.repos.push(...synthetics);
      tsKingdom.totalStars += synthetics.reduce((s, r) => s + r.repo.stargazers_count, 0);
      tsKingdom.totalCommits += synthetics.reduce((s, r) => s + r.totalCommits, 0);
    }
  }

  console.log('Language kingdoms:', languageKingdoms.map(k =>
    `${k.language} (${k.repos.length} repos, king: ${k.king?.login})`
  ));

  loadingEl.textContent = `Building ${languageKingdoms.length} kingdoms...`;
  await new Promise(r => setTimeout(r, 50));

  (window as any).__gitworld = {
    kingdoms: languageKingdoms,
    spritePacks,
    highlightUser,
    focusRepo: focusRepo || null,
  };

  // Deep link: /username (no repo) → go straight to their city, skip WorldScene entirely
  if (highlightUser && !focusRepo) {
    const userRepos = languageKingdoms
      .flatMap(k => k.repos.filter(r =>
        r.contributors?.some(c => c.login.toLowerCase() === highlightUser.toLowerCase()) ||
        r.repo.full_name.toLowerCase().startsWith(highlightUser.toLowerCase() + '/')
      ))
      .sort((a, b) => b.repo.stargazers_count - a.repo.stargazers_count);

    let targetKingdom = null;
    if (userRepos.length > 0) {
      const topRepo = userRepos[0];
      targetKingdom = languageKingdoms.find(k =>
        k.repos.some(r => r.repo.full_name === topRepo.repo.full_name)
      );
    }
    if (!targetKingdom) {
      targetKingdom = languageKingdoms.find(k => k.language === 'Uncharted');
    }
    if (targetKingdom) {
      const game = createPhaserGame();
      game.scene.add('WorldScene', WorldScene, false);
      game.scene.add('CityScene', CityScene, true, {
        kingdom: targetKingdom,
        spritePacks,
        highlightUser,
        focusRepo: null,
        returnData: {
          kingdoms: languageKingdoms,
          spritePacks,
          highlightUser,
        },
        autoShowSheet: highlightUser,
      });
      (window as any).__game = game;
      console.log(`[User link] Jumping to ${targetKingdom.language} city for ${highlightUser}`);
      trackPageView(`/city/${targetKingdom.language.toLowerCase()}`, `Git Kingdom | ${highlightUser}`);
      return;
    }
  }

  const game = createPhaserGame();
  game.scene.add('WorldScene', WorldScene, true, {
    kingdoms: languageKingdoms,
    spritePacks,
    highlightUser,
  });
  game.scene.add('CityScene', CityScene, false);
  (window as any).__game = game;
  trackPageView(`/${highlightUser || ''}`, `Git Kingdom | ${highlightUser || 'World Map'}`);

  // Deep link: /owner/repo → jump straight into the city containing that repo
  if (focusRepo && highlightUser) {
    const fullName = `${highlightUser}/${focusRepo}`;
    const targetKingdom = languageKingdoms.find(k =>
      k.repos.some(r => r.repo.full_name.toLowerCase() === fullName.toLowerCase())
    );
    if (targetKingdom) {
      game.scene.start('CityScene', {
        kingdom: targetKingdom,
        spritePacks,
        highlightUser,
        focusRepo: fullName,
        returnData: {
          kingdoms: languageKingdoms,
          spritePacks,
          highlightUser,
        },
      });
      console.log(`[Deep link] Jumping to ${targetKingdom.language} city for ${fullName}`);
      trackPageView(`/city/${targetKingdom.language.toLowerCase()}/${fullName}`, `Git Kingdom | ${targetKingdom.language}`);
    }
  }
}

// ─── Analytics: event delegation for GitHub links & sign-in ──
document.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;

  // Track GitHub link clicks (.gh-link or any link to github.com)
  const ghLink = target.closest('a[href*="github.com"]') as HTMLAnchorElement | null;
  if (ghLink) {
    const href = ghLink.href;
    const ghPath = href.replace(/^https?:\/\/github\.com\//, '');
    const parts = ghPath.split('/').filter(Boolean);
    const linkType: 'user' | 'repo' = parts.length >= 2 ? 'repo' : 'user';
    const linkTarget = parts.slice(0, 2).join('/') || parts[0] || '';

    let context = 'unknown';
    if (ghLink.closest('#info-panel')) context = 'info_panel';
    else if (ghLink.closest('#legend')) context = 'legend';
    else if (ghLink.closest('#game-header')) context = 'header';
    else if (ghLink.closest('#entry-modal')) context = 'title_screen';

    trackGitHubLinkClicked({ link_type: linkType, target: linkTarget, context });
  }

  // Track sign-in link clicks
  const authLink = target.closest('a[href*="/api/auth/login"]') as HTMLAnchorElement | null;
  if (authLink) {
    trackSignInInitiated();
  }
});

boot().catch((err) => {
  console.error('Boot failed:', err);
  const loading = document.getElementById('loading');
  if (loading) loading.textContent = `Error: ${err.message}`;
});

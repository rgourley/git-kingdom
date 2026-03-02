import Phaser from 'phaser';
import { WorldScene } from './scenes/WorldScene';
import { CityScene } from './scenes/CityScene';
import { TitleScene } from './scenes/TitleScene';
import { fetchKingdomMetrics, DEFAULT_REPOS, fetchUserRepos, setGitHubToken, getGitHubToken } from './github/api';
import { KingdomMetrics, LanguageKingdom, ContributorData, Biome } from './types';
import { SpritePacks } from './generators/TilesetGenerator';
import { generateTestRepos } from './testdata';
import { parseRoute } from './router';
import { fetchUniversalWorld, fetchCurrentUser, joinWorld, invalidateWorldCache } from './api/client';

function getBiome(lang: string): Biome {
  const m: Record<string, Biome> = {
    JavaScript: 'grassland', TypeScript: 'grassland', Python: 'forest',
    Rust: 'volcanic', Go: 'mountain', Ruby: 'crystal', Java: 'desert',
    'C++': 'mountain', C: 'mountain', 'C#': 'tundra', PHP: 'forest',
    Swift: 'grassland', Kotlin: 'desert', Shell: 'desert',
  };
  return m[lang] || 'grassland';
}

function groupByLanguage(allMetrics: KingdomMetrics[]): LanguageKingdom[] {
  const groups = new Map<string, KingdomMetrics[]>();

  for (const m of allMetrics) {
    const lang = m.repo.language;
    if (!lang) continue;
    if (!groups.has(lang)) groups.set(lang, []);
    groups.get(lang)!.push(m);
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

// ─── Resolve repos from URL params ──────────────────────────
async function resolveRepos(): Promise<{ repoList: [string, string][]; discoveredUser: string | null }> {
  const params = new URLSearchParams(window.location.search);

  // ?token=ghp_xxx — set GitHub token from URL (then strip from URL)
  const token = params.get('token');
  if (token) {
    setGitHubToken(token);
    params.delete('token');
    const clean = params.toString();
    window.history.replaceState({}, '', clean ? `?${clean}` : window.location.pathname);
  }

  // ?user=someuser — discover repos from a GitHub user/org
  const user = params.get('user') || params.get('org');
  if (user) {
    const loadingEl = document.getElementById('loading')!;
    loadingEl.textContent = `Discovering repos for ${user}...`;
    const repos = await fetchUserRepos(user, 30);
    if (repos.length > 0) {
      console.log(`Discovered ${repos.length} repos for ${user}`);
      return { repoList: repos, discoveredUser: user };
    }
    console.warn(`No repos found for ${user}, falling back to defaults`);
  }

  // ?repos=owner/repo,owner/repo — explicit comma-separated list
  const reposParam = params.get('repos');
  if (reposParam) {
    const repos: [string, string][] = reposParam
      .split(',')
      .map(r => r.trim().split('/'))
      .filter(parts => parts.length === 2)
      .map(([owner, repo]) => [owner, repo] as [string, string]);
    if (repos.length > 0) return { repoList: repos, discoveredUser: null };
  }

  return { repoList: DEFAULT_REPOS, discoveredUser: null };
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

// ─── Try loading pre-baked default world data ────────────────
async function loadPrebakedData(): Promise<KingdomMetrics[] | null> {
  try {
    const res = await fetch('/data/default-world.json');
    if (!res.ok) return null;
    const json = await res.json();
    return json.repos as KingdomMetrics[];
  } catch {
    return null;
  }
}

// ─── Fetch all repo metrics with progress ────────────────────
async function fetchAllMetrics(
  repoList: [string, string][],
  onProgress: (loaded: number, total: number) => void,
): Promise<KingdomMetrics[]> {
  const results = await Promise.allSettled(
    repoList.map(([owner, repo]) => fetchKingdomMetrics(owner, repo))
  );

  const allMetrics: KingdomMetrics[] = [];
  let failCount = 0;
  let isRateLimited = false;
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === 'fulfilled') {
      allMetrics.push(result.value);
      onProgress(allMetrics.length, repoList.length);
    } else {
      failCount++;
      if (String(result.reason).includes('403')) isRateLimited = true;
      console.warn(`Failed to fetch ${repoList[i].join('/')}: ${result.reason}`);
    }
  }

  if (failCount > 0 && isRateLimited) {
    console.warn(`Rate limited: ${failCount}/${repoList.length} repos failed. Showing ${allMetrics.length} cached.`);
  }

  return allMetrics;
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
    if (e.target === modal || (e.target as HTMLElement).classList.contains('entry-backdrop')) dismiss();
  });

  const onKey = () => { dismiss(); document.removeEventListener('keydown', onKey); };
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
    backgroundColor: '#1a1a2e',
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
          }
        }).catch(() => {});
      }
    }).catch(() => {});

    return bootDirect(params, loadingEl, route.repoName);
  }

  if (hasUrlParams) {
    return bootDirect(params, loadingEl);
  }

  // ── Default path: show animated TitleScene city behind the title overlay ──
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

  // User clicked — stop TitleScene, load real data, start WorldScene
  loadingEl.style.display = 'block';
  loadingEl.textContent = 'Loading kingdom data...';

  const { repoList, discoveredUser } = await resolveRepos();

  const universalWorld = await fetchUniversalWorld();
  let allMetrics: KingdomMetrics[];

  if (universalWorld && universalWorld.repos.length > 0) {
    if (discoveredUser) {
      const userMetrics = await fetchAllMetrics(repoList, (loaded, total) => {
        loadingEl.textContent = `Summoned ${loaded}/${total} kingdoms...`;
      });
      const seen = new Set(universalWorld.repos.map(r => r.repo.full_name.toLowerCase()));
      allMetrics = [
        ...universalWorld.repos,
        ...userMetrics.filter(m => !seen.has(m.repo.full_name.toLowerCase())),
      ];
    } else {
      allMetrics = universalWorld.repos;
    }
  } else {
    loadingEl.textContent = `Summoning ${repoList.length} kingdoms from GitHub...`;
    allMetrics = await fetchAllMetrics(repoList, (loaded, total) => {
      loadingEl.textContent = `Summoned ${loaded}/${total} kingdoms...`;
    });
  }

  if (allMetrics.length === 0) {
    loadingEl.textContent = 'GitHub API rate limit hit. Add a token via ?token= or wait ~1 hour.';
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
    highlightUser: discoveredUser,
    focusRepo: null,
  };
  (window as any).__game = game;

  // Switch from TitleScene to WorldScene
  game.scene.stop('TitleScene');
  game.scene.start('WorldScene', {
    kingdoms: languageKingdoms,
    spritePacks,
    highlightUser: discoveredUser,
  });
}

// ─── Load default world metrics (try pre-baked first) ────────
async function loadDefaultMetrics(loadingEl: HTMLElement): Promise<KingdomMetrics[]> {
  // Try pre-baked data first (zero API calls)
  loadingEl.textContent = 'Loading kingdom data...';
  const prebaked = await loadPrebakedData();
  if (prebaked && prebaked.length > 0) {
    loadingEl.textContent = `Loaded ${prebaked.length} kingdoms from cache...`;
    return prebaked;
  }

  // Fall back to live API
  loadingEl.textContent = `Summoning ${DEFAULT_REPOS.length} kingdoms from GitHub...`;
  return fetchAllMetrics(DEFAULT_REPOS, (loaded, total) => {
    loadingEl.textContent = `Summoned ${loaded}/${total} kingdoms...`;
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

  const { repoList, discoveredUser } = await resolveRepos();

  // Try universal world API first — merge with discovered user's repos
  loadingEl.textContent = 'Loading universal world...';
  const universalWorld = await fetchUniversalWorld();
  let allMetrics: KingdomMetrics[];

  if (universalWorld && universalWorld.repos.length > 0) {
    if (discoveredUser) {
      const userMetrics = await fetchAllMetrics(repoList, (loaded, total) => {
        loadingEl.textContent = `Summoned ${loaded}/${total} kingdoms...`;
      });
      const seen = new Set(universalWorld.repos.map(r => r.repo.full_name.toLowerCase()));
      allMetrics = [
        ...universalWorld.repos,
        ...userMetrics.filter(m => !seen.has(m.repo.full_name.toLowerCase())),
      ];
    } else {
      allMetrics = universalWorld.repos;
    }
  } else {
    loadingEl.textContent = `Summoning ${repoList.length} kingdoms from GitHub...`;
    allMetrics = await fetchAllMetrics(repoList, (loaded, total) => {
      loadingEl.textContent = `Summoned ${loaded}/${total} kingdoms...`;
    });
  }

  if (allMetrics.length === 0) {
    loadingEl.textContent = 'GitHub API rate limit hit. Add a token via ?token= or wait ~1 hour.';
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
  const spritePacks = await loadSpritePacks();
  await new Promise(r => setTimeout(r, 50));

  const game = createPhaserGame();
  game.scene.add('WorldScene', WorldScene, true, {
    kingdoms: languageKingdoms,
    spritePacks,
    highlightUser: discoveredUser,
  });
  game.scene.add('CityScene', CityScene, false);

  (window as any).__gitworld = {
    kingdoms: languageKingdoms,
    spritePacks,
    highlightUser: discoveredUser,
    focusRepo: focusRepo || null,
  };
  (window as any).__game = game;

  // Deep link: /owner/repo → jump straight into the city containing that repo
  if (focusRepo && discoveredUser) {
    const fullName = `${discoveredUser}/${focusRepo}`;
    const targetKingdom = languageKingdoms.find(k =>
      k.repos.some(r => r.repo.full_name.toLowerCase() === fullName.toLowerCase())
    );
    if (targetKingdom) {
      game.scene.start('CityScene', {
        kingdom: targetKingdom,
        spritePacks,
        highlightUser: discoveredUser,
        focusRepo: fullName,
        returnData: {
          kingdoms: languageKingdoms,
          spritePacks,
          highlightUser: discoveredUser,
        },
      });
      console.log(`[Deep link] Jumping to ${targetKingdom.language} city for ${fullName}`);
    }
  }
}

boot().catch((err) => {
  console.error('Boot failed:', err);
  const loading = document.getElementById('loading');
  if (loading) loading.textContent = `Error: ${err.message}`;
});

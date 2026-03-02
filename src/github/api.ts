import { RepoData, ContributorData, KingdomMetrics } from '../types';
import { idbSet, idbGetStale } from './cache';

const API = 'https://api.github.com';
const CACHE_PREFIX = 'gk_cache_';
const CACHE_TTL = 1000 * 60 * 60 * 24; // 24 hours
const STALE_TTL = 1000 * 60 * 60 * 24 * 7; // 7 days for stale-while-revalidate

// ─── LocalStorage cache (hot/sync tier) ──────────────────────
function getCached<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const { data, ts } = JSON.parse(raw);
    if (Date.now() - ts > CACHE_TTL) {
      // Don't remove — keep for stale fallback
      return null;
    }
    return data as T;
  } catch {
    return null;
  }
}

/** Get stale data from localStorage (within 7-day window) */
function getCachedStale<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const { data, ts } = JSON.parse(raw);
    if (Date.now() - ts > STALE_TTL) {
      localStorage.removeItem(CACHE_PREFIX + key);
      return null;
    }
    return data as T;
  } catch {
    return null;
  }
}

function setCache(key: string, data: unknown) {
  try {
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ data, ts: Date.now() }));
  } catch { /* storage full — ignore */ }
  // Also persist to IndexedDB for long-term storage
  idbSet(CACHE_PREFIX + key, data).catch(() => {});
}

// Optional GitHub token for higher rate limits (5000/hr vs 60/hr)
let ghToken: string | null = null;

export function setGitHubToken(token: string) {
  ghToken = token;
  localStorage.setItem('gk_gh_token', token);
}

export function getGitHubToken(): string | null {
  if (ghToken) return ghToken;
  ghToken = localStorage.getItem('gk_gh_token');
  return ghToken;
}

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/vnd.github.v3+json' };
  const token = getGitHubToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

async function fetchJSON<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) {
    throw new Error(`GitHub API ${res.status}: ${url}`);
  }
  return res.json();
}

export async function fetchRepoData(owner: string, repo: string): Promise<RepoData> {
  const key = `repo_${owner}_${repo}`;
  // Fresh cache hit
  const cached = getCached<RepoData>(key);
  if (cached) return cached;
  // Try fetching fresh data
  try {
    const data = await fetchJSON<RepoData>(`${API}/repos/${owner}/${repo}`);
    setCache(key, data);
    return data;
  } catch (err) {
    // Stale-while-revalidate: return stale data if available
    const stale = getCachedStale<RepoData>(key);
    if (stale) return stale;
    // Try IndexedDB as last resort
    const idbStale = await idbGetStale<RepoData>(CACHE_PREFIX + key);
    if (idbStale) return idbStale.data;
    throw err;
  }
}

export async function fetchContributors(owner: string, repo: string): Promise<ContributorData[]> {
  const key = `contrib_${owner}_${repo}`;
  const cached = getCached<ContributorData[]>(key);
  if (cached) return cached;
  try {
    const data = await fetchJSON<ContributorData[]>(
      `${API}/repos/${owner}/${repo}/contributors?per_page=20`
    );
    setCache(key, data);
    return data;
  } catch {
    // Stale fallback
    const stale = getCachedStale<ContributorData[]>(key);
    if (stale) return stale;
    const idbStale = await idbGetStale<ContributorData[]>(CACHE_PREFIX + key);
    if (idbStale) return idbStale.data;
    return [];
  }
}

export async function fetchKingdomMetrics(owner: string, repo: string): Promise<KingdomMetrics> {
  const [repoData, contributors] = await Promise.all([
    fetchRepoData(owner, repo),
    fetchContributors(owner, repo),
  ]);

  const totalCommits = contributors.reduce((sum, c) => sum + c.contributions, 0);
  const king = contributors.length > 0 ? contributors[0] : null;

  // Estimate merged PRs from closed issues (rough heuristic for PoC)
  const mergedPRs = Math.floor(totalCommits * 0.3);

  return {
    repo: repoData,
    contributors,
    totalCommits,
    mergedPRs,
    king,
  };
}

// Default repos — top repos per language for a rich kingdom map
// With a GitHub token (5000 req/hr) we can comfortably load ~80 repos
// Without a token (60 req/hr), loading will partially fail but cached data helps
export const DEFAULT_REPOS: [string, string][] = [
  // ── JavaScript — Grassland Kingdom ──────────────────────────
  ['facebook', 'react'],           // 230k★ UI library
  ['vuejs', 'vue'],                // 210k★ progressive framework
  ['sveltejs', 'svelte'],          // 80k★  compiler framework
  ['vercel', 'next.js'],           // 130k★ React meta-framework
  ['expressjs', 'express'],        // 66k★  Node.js web framework
  ['axios', 'axios'],              // 106k★ HTTP client
  ['mrdoob', 'three.js'],          // 104k★ 3D graphics
  ['jquery', 'jquery'],            // 59k★  DOM manipulation
  ['d3', 'd3'],                    // 109k★ data visualization
  ['webpack', 'webpack'],          // 65k★  bundler

  // ── TypeScript — Grassland Kingdom ─────────────────────────
  // Citadel tier (50k+★)
  ['microsoft', 'vscode'],         // 167k★ code editor
  ['microsoft', 'TypeScript'],     // 102k★ the language itself
  ['angular', 'angular'],          // 97k★  web framework
  ['storybookjs', 'storybook'],    // 85k★  UI component dev
  ['vitejs', 'vite'],              // 70k★  build tool
  ['tailwindlabs', 'tailwindcss'], // 85k★  utility-first CSS
  ['nestjs', 'nest'],              // 69k★  Node.js framework
  ['socketio', 'socket.io'],       // 61k★  real-time engine
  ['grafana', 'grafana'],          // 66k★  monitoring dashboard
  ['strapi', 'strapi'],            // 64k★  headless CMS
  ['supabase', 'supabase'],        // 75k★  Firebase alternative
  ['n8nio', 'n8n'],                // 52k★  workflow automation
  ['appwrite', 'appwrite'],        // 46k★  backend server
  // Castle tier (10k-50k★)
  ['prisma', 'prisma'],            // 40k★  database ORM
  ['trpc', 'trpc'],                // 35k★  end-to-end typesafe APIs
  ['colinhacks', 'zod'],           // 35k★  schema validation
  ['jaredpalmer', 'formik'],       // 34k★  React forms
  ['reduxjs', 'redux'],            // 61k★  state management
  ['apollographql', 'apollo-client'], // 19k★ GraphQL client
  ['typeorm', 'typeorm'],          // 34k★  TypeScript ORM
  ['ionic-team', 'ionic-framework'], // 51k★ mobile framework
  ['remix-run', 'remix'],          // 30k★  full-stack React
  ['TanStack', 'query'],           // 43k★  data fetching
  ['pmndrs', 'zustand'],           // 49k★  state management
  ['microsoft', 'playwright'],     // 68k★  browser testing
  // Palace/Keep tier (2k-10k★)
  ['Effect-TS', 'effect'],         // 8k★   effect system
  ['BuilderIO', 'mitosis'],        // 12k★  universal components
  ['vanilla-extract-css', 'vanilla-extract'], // 9k★ CSS framework
  ['triggerdotdev', 'trigger.dev'], // 9k★  background jobs
  ['total-typescript', 'ts-reset'], // 8k★  TS type utils
  ['tremorlabs', 'tremor'],        // 16k★  dashboard components
  ['aidenybai', 'million'],        // 16k★  virtual DOM
  ['umami-software', 'umami'],     // 23k★  analytics
  ['t3-oss', 'create-t3-app'],    // 25k★  T3 stack starter
  ['calcom', 'cal.com'],           // 33k★  scheduling
  // Manor/Guild tier (100-2k★)
  ['tldraw', 'tldraw'],            // 37k★  drawing canvas
  ['biomejs', 'biome'],            // 16k★  linter/formatter
  ['dai-shi', 'waku'],             // 4k★   React framework
  ['unjs', 'ofetch'],              // 4k★   HTTP client
  ['unjs', 'citty'],               // 1k★   CLI framework
  ['dinerojs', 'dinero.js'],       // 6k★   money library
  ['ngneat', 'elf'],               // 2k★   state management
  ['koskimas', 'kysely'],          // 11k★  query builder
  // Small tier (cottage/guild — <500★)
  ['sindresorhus', 'ts-extras'],   // ~400★  TS utilities
  ['unjs', 'jiti'],                // 2k★   TS runtime
  ['bombshell-dev', 'clack'],      // 6k★   CLI prompts

  // ── Python — Forest Kingdom ────────────────────────────────
  ['django', 'django'],            // 82k★  web framework
  ['pallets', 'flask'],            // 68k★  micro framework
  ['fastapi', 'fastapi'],          // 80k★  async API framework
  ['scikit-learn', 'scikit-learn'],// 61k★  machine learning
  ['pytorch', 'pytorch'],          // 86k★  deep learning
  ['pandas-dev', 'pandas'],        // 44k★  data analysis
  ['langchain-ai', 'langchain'],   // 100k★ LLM framework
  ['huggingface', 'transformers'], // 140k★ ML models
  ['psf', 'requests'],             // 52k★  HTTP library
  ['tiangolo', 'typer'],           // 16k★  CLI framework

  // ── Rust — Volcanic Kingdom ────────────────────────────────
  ['denoland', 'deno'],            // 100k★ JS/TS runtime
  ['tauri-apps', 'tauri'],         // 88k★  desktop apps
  ['BurntSushi', 'ripgrep'],       // 50k★  fast grep
  ['alacritty', 'alacritty'],      // 57k★  GPU terminal
  ['starship', 'starship'],        // 46k★  shell prompt
  ['astral-sh', 'ruff'],           // 35k★  Python linter
  ['servo', 'servo'],              // 29k★  browser engine
  ['tokio-rs', 'tokio'],           // 27k★  async runtime

  // ── Go — Mountain Kingdom ─────────────────────────────────
  ['golang', 'go'],                // 125k★ the language itself
  ['gin-gonic', 'gin'],            // 80k★  web framework
  ['gohugoio', 'hugo'],            // 77k★  static site gen
  ['junegunn', 'fzf'],             // 67k★  fuzzy finder
  ['traefik', 'traefik'],          // 52k★  reverse proxy
  ['ethereum', 'go-ethereum'],     // 48k★  Ethereum client
  ['containerd', 'containerd'],    // 18k★  container runtime
  ['cli', 'cli'],                  // 38k★  GitHub CLI

  // ── C — Mountain Kingdom ──────────────────────────────────
  ['torvalds', 'linux'],           // 185k★ the kernel
  ['redis', 'redis'],              // 67k★  in-memory DB
  ['curl', 'curl'],                // 36k★  data transfer
  ['git', 'git'],                  // 53k★  version control
  ['nginx', 'nginx'],              // 25k★  web server
  ['sqlite', 'sqlite'],            // 7k★   embedded DB

  // ── C++ — Mountain Kingdom ────────────────────────────────
  ['electron', 'electron'],        // 115k★ desktop framework
  ['tensorflow', 'tensorflow'],    // 187k★ ML framework
  ['bitcoin', 'bitcoin'],          // 80k★  cryptocurrency
  ['protocolbuffers', 'protobuf'], // 66k★  serialization
  ['grpc', 'grpc'],                // 42k★  RPC framework
  ['godotengine', 'godot'],        // 93k★  game engine
  ['opencv', 'opencv'],            // 80k★  computer vision

  // ── Java — Desert Kingdom ─────────────────────────────────
  ['spring-projects', 'spring-boot'],  // 76k★ web framework
  ['elastic', 'elasticsearch'],        // 71k★ search engine
  ['apache', 'kafka'],                 // 29k★ event streaming
  ['google', 'guava'],                 // 50k★ core libraries
  ['ReactiveX', 'RxJava'],            // 48k★ reactive extensions
  ['apache', 'dubbo'],                 // 40k★ RPC framework

  // ── Ruby — Crystal Kingdom ────────────────────────────────
  ['rails', 'rails'],              // 56k★  web framework
  ['jekyll', 'jekyll'],            // 49k★  static site gen
  ['discourse', 'discourse'],      // 43k★  forum platform
  ['hashicorp', 'vagrant'],        // 26k★  dev environments
  ['Homebrew', 'brew'],            // 42k★  package manager

  // ── Shell — Desert Kingdom ────────────────────────────────
  ['ohmyzsh', 'ohmyzsh'],          // 175k★ zsh framework
  ['nvm-sh', 'nvm'],               // 81k★  Node version manager
  ['pi-hole', 'pi-hole'],          // 50k★  network ad blocker
  ['romkatv', 'powerlevel10k'],    // 47k★  zsh theme
  ['acmesh-official', 'acme.sh'],  // 40k★  ACME client

  // ── PHP — Forest Kingdom ──────────────────────────────────
  ['laravel', 'laravel'],          // 79k★  web framework
  ['WordPress', 'WordPress'],      // 20k★  CMS
  ['symfony', 'symfony'],          // 30k★  web framework
  ['composer', 'composer'],        // 29k★  package manager

  // ── Swift — Grassland Kingdom ─────────────────────────────
  ['apple', 'swift'],              // 68k★  the language
  ['Alamofire', 'Alamofire'],      // 41k★  HTTP networking
  ['vapor', 'vapor'],              // 25k★  server-side Swift

  // ── Kotlin — Desert Kingdom ───────────────────────────────
  ['JetBrains', 'kotlin'],         // 50k★  the language
  ['square', 'okhttp'],            // 46k★  HTTP client

  // ── Smaller repos — cottage/guild sized buildings ──────────
  // TypeScript (10-200★ range — tiny cottages & guild houses)
  ['fabiospampinato', 'flimsy'],     // ~195★ reactive signals
  ['marcisbee', 'exome'],            // ~280★ state management
  ['hustcc', 'onfire.js'],           // ~500★ event emitter
  ['alexcanessa', 'typescript-coverage-report'], // ~150★ coverage tool
  ['nicolo-ribaudo', 'tc39-proposal-pattern-matching'], // ~30★ TC39 proposal
  ['beenotung', 'better-sqlite3-helper'], // ~80★ sqlite helper
  ['nicolo-ribaudo', 'jest-light-runner'], // ~200★ jest runner
  ['nicolo-ribaudo', 'chokidar-cli'],     // ~30★  file watcher CLI
  // JavaScript
  ['dcousens', 'is-sorted'],         // ~22★  tiny utility
  ['lukeed', 'matchit'],             // ~323★ route matching
  ['lukeed', 'qss'],                 // ~454★ query strings
  ['elbywan', 'hyperactiv'],         // ~451★ observability
  // Python
  ['mongomock', 'mongomock'],        // ~1k★  mock pymongo
  // Go
  ['abahmed', 'kwatch'],             // ~1k★  k8s monitoring
  // Rust
  ['de-vri-es', 'assert2-rs'],       // ~126★ assert macros
  // Ruby
  ['ankane', 'informers'],           // ~600★ transformer inference
  ['ankane', 'disco'],               // ~600★ recommendations
  // Java
  ['knowm', 'Sundial'],              // ~276★ job scheduler

  // ── rgourley's repos — scattered across kingdoms ──────────
  ['rgourley', 'styleluxe'],
  ['rgourley', 'mdskills'],
  ['rgourley', 'Velvet'],
  ['rgourley', 'portfolio'],
  ['rgourley', 'atomic-rpg-engine'],
  ['rgourley', 'd20'],
  ['rgourley', 'ghostmachine-art-token'],
];

// Backwards compat alias
export const TEST_REPOS = DEFAULT_REPOS;

// ─── Dynamic repo discovery ─────────────────────────────────
// Fetch public repos for a GitHub user or org
export async function fetchUserRepos(
  username: string,
  maxRepos = 30
): Promise<[string, string][]> {
  const key = `user_repos_${username}`;
  const cached = getCached<[string, string][]>(key);
  if (cached) return cached;

  try {
    // Try as user first, then as org
    let repos: any[];
    try {
      repos = await fetchJSON<any[]>(
        `${API}/users/${username}/repos?per_page=${maxRepos}&sort=stars&direction=desc&type=owner`
      );
    } catch {
      repos = await fetchJSON<any[]>(
        `${API}/orgs/${username}/repos?per_page=${maxRepos}&sort=stars&direction=desc`
      );
    }

    // Filter out forks, archived, and empty repos
    const result: [string, string][] = repos
      .filter((r: any) => !r.fork && !r.archived && r.size > 0)
      .map((r: any) => [r.owner.login, r.name] as [string, string]);

    setCache(key, result);
    return result;
  } catch (err) {
    console.error(`Failed to fetch repos for ${username}:`, err);
    return [];
  }
}

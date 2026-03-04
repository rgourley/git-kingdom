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

// GitHub API headers.
// For local dev, set VITE_GITHUB_TOKEN in .env.local (never committed).
// In production, authenticated users go through backend OAuth.
function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/vnd.github.v3+json' };
  const token = import.meta.env.VITE_GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
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

// Default repos — curated repos per language for rich, dense kingdoms.
// ~500 repos across 13 languages. Each is a real [owner, repo] pair.
// With a GitHub token (5000 req/hr via VITE_GITHUB_TOKEN) this loads fine.
// Without a token (60 req/hr), loading will partially fail but cached data helps.
// Future: these serve as the "seed layer" for the universal world.
export const DEFAULT_REPOS: [string, string][] = [
  // ── JavaScript ────────────────────────────────────────────────
  // Castle / Citadel tier
  ['facebook', 'react'],             // 230k★ UI library
  ['vuejs', 'vue'],                  // 210k★ progressive framework
  ['vercel', 'next.js'],             // 130k★ React meta-framework
  ['axios', 'axios'],                // 106k★ HTTP client
  ['d3', 'd3'],                      // 109k★ data visualization
  ['mrdoob', 'three.js'],            // 104k★ 3D graphics
  ['expressjs', 'express'],          // 66k★  Node.js web framework
  ['webpack', 'webpack'],            // 65k★  bundler
  ['jquery', 'jquery'],              // 59k★  DOM manipulation
  // Keep / Manor tier
  ['chartjs', 'Chart.js'],           // 65k★  charting
  ['lodash', 'lodash'],              // 60k★  utility library
  ['moment', 'moment'],              // 48k★  date library
  ['prettier', 'prettier'],          // 50k★  code formatter
  ['parcel-bundler', 'parcel'],      // 43k★  bundler
  ['Leaflet', 'Leaflet'],            // 42k★  maps
  ['markedjs', 'marked'],            // 33k★  markdown parser
  // Guild / Cottage tier
  ['phaserjs', 'phaser'],            // 37k★  game framework
  ['highlightjs', 'highlight.js'],   // 24k★  syntax highlighter
  ['nolimits4web', 'swiper'],        // 40k★  touch slider
  ['video-dev', 'hls.js'],           // 15k★  HLS player
  ['validatorjs', 'validator.js'],   // 23k★  string validation
  ['chalk', 'chalk'],                // 22k★  terminal colors
  ['sindresorhus', 'ora'],           // 9k★   terminal spinner
  ['lukeed', 'qss'],                 // ~454★ query strings
  ['lukeed', 'matchit'],             // ~323★ route matching
  ['dcousens', 'is-sorted'],         // ~22★  tiny utility
  ['elbywan', 'hyperactiv'],         // ~451★ observability
  // Hovel / Camp tier — small but real
  ['mattboldt', 'typed.js'],         // 15k★  typing animation
  ['juliangarnier', 'anime'],        // 50k★  animation engine
  ['hapijs', 'hapi'],                // 15k★  server framework
  ['jorgebucaran', 'hyperapp'],      // 19k★  micro framework
  ['caolan', 'async'],               // 28k★  async utilities
  ['browserify', 'browserify'],      // 15k★  bundler
  ['jsdom', 'jsdom'],                // 20k★  DOM implementation
  ['debug-js', 'debug'],             // 11k★  debug utility
  ['tj', 'commander.js'],            // 27k★  CLI framework
  ['isaacs', 'minimatch'],           // 1k★   glob matching
  ['feross', 'simple-peer'],         // 7k★   WebRTC
  ['davidshimjs', 'qrcodejs'],       // 13k★  QR code generator
  ['janl', 'mustache.js'],           // 16k★  templates
  ['markdown-it', 'markdown-it'],    // 18k★  markdown parser
  ['gruns', 'icecream'],             // 1k★   debug printing
  ['component', 'emitter'],          // ~316★ event emitter
  ['mafintosh', 'csv-parser'],       // ~1k★  CSV parser
  ['feross', 'buffer'],              // 2k★   Buffer for browsers
  ['uuidjs', 'uuid'],                // 15k★  UUID generator
  ['substack', 'minimist'],          // 2k★   argument parser
  ['sindresorhus', 'p-queue'],       // 3k★   promise queue
  ['sindresorhus', 'got'],           // 14k★  HTTP requests
  ['koajs', 'koa'],                  // 35k★  web framework
  ['nodemailer', 'nodemailer'],      // 17k★  email sending
  ['lovell', 'sharp'],               // 29k★  image processing
  // Additional JS repos for city density
  ['jashkenas', 'underscore'],       // 27k★  utility library
  ['jashkenas', 'backbone'],         // 28k★  MVC framework
  ['gulpjs', 'gulp'],                // 33k★  task runner
  ['gruntjs', 'grunt'],              // 12k★  task runner
  ['yargs', 'yargs'],                // 11k★  CLI argument parser
  ['ecomfe', 'echarts'],             // 2k★   charting (fork)
  ['pixijs', 'pixijs'],              // 44k★  2D renderer
  ['hakimel', 'reveal.js'],           // 68k★  presentations
  ['fabricjs', 'fabric.js'],         // 29k★  canvas library
  ['Modernizr', 'Modernizr'],       // 26k★  feature detection
  ['FullHuman', 'purgecss'],         // 8k★   unused CSS remover
  ['naptha', 'tesseract.js'],        // 35k★  OCR
  ['dcloudio', 'uni-app'],           // 40k★  cross-platform app
  ['NervJS', 'taro'],                // 36k★  cross-platform
  // Removed: nodebestpractices (content list), clean-code-javascript (content)
  ['responsively-org', 'responsively-app'], // 23k★ responsive viewer
  ['webtorrent', 'webtorrent'],      // 30k★  streaming torrent
  ['badges', 'shields'],             // 24k★  badge service
  // Smaller JS repos for dense city feel
  ['jamiebuilds', 'the-super-tiny-compiler'], // 28k★ tiny compiler
  ['michalsnik', 'aos'],              // 26k★  scroll animations
  ['alvarotrigo', 'fullPage.js'],     // 35k★  fullscreen scrolling
  ['VincentGarreau', 'particles.js'], // 29k★  particle backgrounds
  ['processing', 'p5.js'],            // 22k★  creative coding
  ['mermaid-js', 'mermaid'],          // 73k★  diagrams from text
  ['js-cookie', 'js-cookie'],         // 22k★  cookie handling
  ['cure53', 'DOMPurify'],            // 14k★  XSS sanitizer
  ['nodeca', 'pako'],                 // 5k★   zlib port
  ['i18next', 'i18next'],             // 8k★   internationalization
  ['pouchdb', 'pouchdb'],             // 17k★  in-browser DB
  ['jsdoc', 'jsdoc'],                 // 15k★  documentation
  ['localForage', 'localForage'],     // 25k★  offline storage
  ['fingerprintjs', 'fingerprintjs'], // 23k★  browser fingerprint
  ['dropzone', 'dropzone'],           // 18k★  file upload
  ['mishoo', 'UglifyJS'],             // 13k★  JS compressor
  ['epoberezkin', 'ajv'],             // 14k★  JSON schema validator
  ['Day8', 'transducers-js'],         // ~100★ transducers
  ['SocketCluster', 'socketcluster'], // 6k★   real-time framework
  ['mqttjs', 'MQTT.js'],              // 8k★   MQTT client

  // ── TypeScript ────────────────────────────────────────────────
  // Castle / Citadel tier
  ['microsoft', 'vscode'],           // 167k★ code editor
  ['microsoft', 'TypeScript'],       // 102k★ the language itself
  ['angular', 'angular'],            // 97k★  web framework
  ['tailwindlabs', 'tailwindcss'],   // 85k★  utility-first CSS
  ['storybookjs', 'storybook'],      // 85k★  UI component dev
  ['supabase', 'supabase'],          // 75k★  Firebase alternative
  ['vitejs', 'vite'],                // 70k★  build tool
  ['nestjs', 'nest'],                // 69k★  Node.js framework
  ['microsoft', 'playwright'],       // 68k★  browser testing
  ['grafana', 'grafana'],            // 66k★  monitoring dashboard
  ['strapi', 'strapi'],              // 64k★  headless CMS
  ['reduxjs', 'redux'],              // 61k★  state management
  ['socketio', 'socket.io'],         // 61k★  real-time engine
  ['n8nio', 'n8n'],                  // 52k★  workflow automation
  ['ionic-team', 'ionic-framework'], // 51k★  mobile framework
  ['pmndrs', 'zustand'],             // 49k★  state management
  ['appwrite', 'appwrite'],          // 46k★  backend server
  // Keep / Manor tier
  ['TanStack', 'query'],             // 43k★  data fetching
  ['prisma', 'prisma'],              // 40k★  database ORM
  ['tldraw', 'tldraw'],              // 37k★  drawing canvas
  ['trpc', 'trpc'],                  // 35k★  end-to-end typesafe APIs
  ['colinhacks', 'zod'],             // 35k★  schema validation
  ['jaredpalmer', 'formik'],         // 34k★  React forms
  ['typeorm', 'typeorm'],            // 34k★  TypeScript ORM
  ['calcom', 'cal.com'],             // 33k★  scheduling
  ['remix-run', 'remix'],            // 30k★  full-stack React
  ['t3-oss', 'create-t3-app'],      // 25k★  T3 stack starter
  ['umami-software', 'umami'],       // 23k★  analytics
  ['apollographql', 'apollo-client'],// 19k★  GraphQL client
  ['tremorlabs', 'tremor'],          // 16k★  dashboard components
  ['aidenybai', 'million'],          // 16k★  virtual DOM
  ['biomejs', 'biome'],              // 16k★  linter/formatter
  // Guild / Cottage tier
  ['BuilderIO', 'mitosis'],          // 12k★  universal components
  ['koskimas', 'kysely'],            // 11k★  query builder
  ['vanilla-extract-css', 'vanilla-extract'], // 9k★ CSS framework
  ['triggerdotdev', 'trigger.dev'],  // 9k★   background jobs
  ['Effect-TS', 'effect'],           // 8k★   effect system
  ['total-typescript', 'ts-reset'],  // 8k★   TS type utils
  ['dinerojs', 'dinero.js'],         // 6k★   money library
  ['bombshell-dev', 'clack'],        // 6k★   CLI prompts
  ['dai-shi', 'waku'],               // 4k★   React framework
  ['unjs', 'ofetch'],                // 4k★   HTTP client
  ['ngneat', 'elf'],                 // 2k★   state management
  ['unjs', 'jiti'],                  // 2k★   TS runtime
  ['unjs', 'citty'],                 // 1k★   CLI framework
  ['sindresorhus', 'ts-extras'],     // ~400★ TS utilities
  ['marcisbee', 'exome'],            // ~280★ state management
  ['fabiospampinato', 'flimsy'],     // ~195★ reactive signals
  // More TS repos for density
  ['microsoft', 'fluentui'],         // 19k★  UI components
  ['vercel', 'ai'],                  // 14k★  AI SDK
  ['drizzle-team', 'drizzle-orm'],   // 25k★  TypeScript ORM
  ['sveltejs', 'svelte'],            // 81k★  UI framework
  ['denoland', 'fresh'],             // 13k★  web framework
  ['date-fns', 'date-fns'],          // 35k★  dates (TS rewrite)
  ['novuhq', 'novu'],                // 35k★  notifications
  ['refinedev', 'refine'],           // 29k★  CRUD framework
  ['ianstormtaylor', 'slate'],       // 30k★  rich text editor
  ['resend', 'react-email'],         // 14k★  email components
  ['honojs', 'hono'],                // 21k★  web framework
  ['elysiajs', 'elysia'],            // 10k★  Bun framework
  ['nrwl', 'nx'],                    // 24k★  monorepo tools
  ['floating-ui', 'floating-ui'],    // 30k★  floating elements
  ['sindresorhus', 'type-fest'],     // 14k★  TS type utilities
  ['oven-sh', 'bun'],                // 75k★  JS runtime
  ['turbopackjs', 'turbopack'],      // 1k★   bundler
  ['tremorlabs', 'tremor-raw'],      // 1k★   chart components
  // Removed: beginners-typescript-tutorial (content/tutorial)
  // Additional TS repos for city density
  ['withastro', 'astro'],             // 48k★  content-focused framework
  ['facebook', 'docusaurus'],          // 57k★  documentation framework (meta)
  ['vuetifyjs', 'vuetify'],           // 40k★  Material Design Vue
  ['ant-design', 'ant-design-pro'],   // 36k★  admin template
  ['mswjs', 'msw'],                   // 16k★  API mocking
  ['sst', 'sst'],                     // 22k★  serverless framework
  ['blitz-js', 'blitz'],              // 14k★  full-stack React
  ['solidjs', 'solid'],               // 33k★  reactive UI library
  ['withfig', 'autocomplete'],        // 24k★  terminal autocomplete
  ['pnpm', 'pnpm'],                   // 30k★  package manager
  ['pmndrs', 'jotai'],                // 19k★  atomic state
  ['vueuse', 'vueuse'],               // 20k★  Vue composition utils
  ['chakra-ui', 'chakra-ui'],         // 38k★  React components
  ['mantinedev', 'mantine'],          // 27k★  React components
  ['radix-ui', 'primitives'],         // 16k★  UI primitives
  ['shadcn-ui', 'ui'],                // 75k★  UI components
  ['vitest-dev', 'vitest'],           // 13k★  test runner
  ['lucia-auth', 'lucia'],            // 10k★  auth library
  ['payloadcms', 'payload'],          // 30k★  headless CMS
  ['directus', 'directus'],           // 29k★  headless CMS
  ['sanity-io', 'sanity'],            // 5k★   structured content
  ['tinacms', 'tinacms'],             // 12k★  visual CMS
  ['cloudflare', 'workers-sdk'],      // 2k★   Cloudflare Workers
  ['unjs', 'nitro'],                  // 6k★   server toolkit
  ['unjs', 'unbuild'],                // 2k★   build system
  ['changesets', 'changesets'],        // 9k★   version management
  ['TypeCellOS', 'BlockNote'],         // 7k★   block-based editor
  ['upstash', 'upstash-redis'],       // 2k★   serverless Redis
  ['vercel', 'swr'],                  // 30k★  data fetching hooks
  ['TanStack', 'router'],             // 8k★   type-safe router
  // Smaller TS repos for dense city feel
  ['TanStack', 'table'],              // 25k★  headless table
  ['TanStack', 'form'],               // 4k★   form library
  ['tRPC', 'examples-next-prisma-starter'], // 1k★ starter example
  ['aidenybai', 'pattycake'],         // ~500★ pattern matching
  ['mattpocock', 'ts-reset'],         // 8k★   better types
  ['millsp', 'ts-toolbelt'],          // 7k★   type toolkit
  ['sindresorhus', 'ky'],             // 13k★  HTTP client
  ['sindresorhus', 'p-limit'],        // 2k★   concurrency limit
  ['unjs', 'consola'],                // 6k★   console logging
  ['unjs', 'h3'],                     // 4k★   HTTP framework
  ['unjs', 'defu'],                   // 1k★   deep merge defaults
  ['unjs', 'pathe'],                  // ~500★ path utilities
  ['unjs', 'ufo'],                    // 1k★   URL utilities
  ['remix-run', 'react-router'],      // 54k★  React routing
  ['date-fns', 'tz'],                 // ~300★ timezone support
  ['pmndrs', 'valtio'],               // 9k★   proxy state
  ['pmndrs', 'drei'],                 // 8k★   R3F helpers
  ['pmndrs', 'react-three-fiber'],    // 28k★  React + Three.js
  ['colinhacks', 'tozod'],            // ~200★ type inference
  ['scottksmith95', 'LZ-UTF8'],       // ~250★ string compression
  ['valibot', 'valibot'],             // 6k★   schema validation
  ['formkit', 'tempo'],               // 2k★   date formatting
  ['microsoft', 'tsyringe'],          // 5k★   DI container
  ['wundergraph', 'cosmo'],           // 2k★   GraphQL federation
  ['Effect-TS', 'schema'],            // 3k★   schema library
  ['vercel', 'turbo'],                // 26k★  monorepo tool
  ['supabase', 'realtime'],           // 7k★   realtime engine
  ['openai', 'openai-node'],          // 8k★   OpenAI SDK
  ['anthropics', 'anthropic-sdk-typescript'], // 2k★ Anthropic SDK

  // ── Python ────────────────────────────────────────────────────
  // Castle / Citadel tier
  ['huggingface', 'transformers'],   // 140k★ ML models
  ['langchain-ai', 'langchain'],     // 100k★ LLM framework
  ['pytorch', 'pytorch'],            // 86k★  deep learning
  ['django', 'django'],              // 82k★  web framework
  ['fastapi', 'fastapi'],            // 80k★  async API framework
  ['pallets', 'flask'],              // 68k★  micro framework
  ['scikit-learn', 'scikit-learn'],  // 61k★  machine learning
  ['psf', 'requests'],               // 52k★  HTTP library
  ['pandas-dev', 'pandas'],          // 44k★  data analysis
  // Keep / Manor tier
  ['scrapy', 'scrapy'],              // 53k★  web scraping
  ['numpy', 'numpy'],                // 28k★  numerical computing
  ['matplotlib', 'matplotlib'],      // 20k★  plotting
  ['celery', 'celery'],              // 25k★  task queue
  ['psf', 'black'],                  // 39k★  code formatter
  ['python-poetry', 'poetry'],       // 32k★  dependency management
  ['encode', 'httpx'],               // 13k★  async HTTP
  ['tiangolo', 'typer'],             // 16k★  CLI framework
  // Guild / Cottage tier
  ['pydantic', 'pydantic'],          // 22k★  data validation
  ['sqlalchemy', 'sqlalchemy'],      // 10k★  SQL toolkit
  ['boto', 'boto3'],                 // 9k★   AWS SDK
  ['pypa', 'pip'],                   // 10k★  package installer
  ['tqdm', 'tqdm'],                  // 29k★  progress bars
  ['paramiko', 'paramiko'],          // 9k★   SSH library
  ['arrow-py', 'arrow'],             // 9k★   datetime library
  ['mongomock', 'mongomock'],        // ~1k★  mock pymongo
  ['pallets', 'click'],              // 16k★  CLI toolkit
  ['marshmallow-code', 'marshmallow'], // 7k★ serialization
  // More Python repos for density
  ['pytorch', 'vision'],             // 16k★  CV models
  ['plotly', 'plotly.py'],           // 16k★  interactive charts
  ['spotify', 'luigi'],              // 18k★  batch processing
  ['mitmproxy', 'mitmproxy'],        // 37k★  HTTP proxy
  ['joke2k', 'faker'],               // 18k★  fake data
  ['pytest-dev', 'pytest'],          // 12k★  testing framework
  ['encode', 'starlette'],           // 10k★  ASGI framework
  ['Textualize', 'rich'],            // 50k★  rich text terminal
  ['Textualize', 'textual'],         // 26k★  TUI framework
  ['python-pillow', 'Pillow'],       // 12k★  imaging
  ['pygments', 'pygments'],          // 2k★   syntax highlighter
  ['fabric', 'fabric'],              // 15k★  SSH automation
  ['dbcli', 'pgcli'],                // 12k★  postgres CLI
  ['jazzband', 'pip-tools'],         // 8k★   pip utilities
  ['pallets', 'jinja'],              // 10k★  template engine
  ['pyinvoke', 'invoke'],            // 4k★   task runner
  ['buildbot', 'buildbot'],          // 5k★   CI framework
  ['python-attrs', 'attrs'],         // 5k★   class utilities
  ['more-itertools', 'more-itertools'], // 4k★ itertools extensions
  ['tartley', 'colorama'],           // 3k★   terminal colors
  ['keleshev', 'schema'],            // 3k★   data validation
  // Smaller Python repos for dense city feel
  ['arrow-py', 'arrow'],             // 9k★   better dates
  ['marshmallow-code', 'marshmallow'], // 7k★  serialization
  ['tqdm', 'tqdm'],                   // 28k★  progress bars
  ['PyGithub', 'PyGithub'],          // 7k★   GitHub API wrapper
  ['burnash', 'gspread'],            // 7k★   Google Sheets API
  ['jmcnamara', 'XlsxWriter'],       // 4k★   Excel writer
  ['python-pillow', 'Pillow'],       // 12k★  image processing
  ['geopy', 'geopy'],                // 4k★   geocoding
  ['python-poetry', 'poetry'],       // 32k★  package manager
  ['psf', 'black'],                  // 39k★  code formatter
  ['PyCQA', 'flake8'],               // 3k★   linting
  ['PyCQA', 'isort'],                // 7k★   import sorting
  ['astral-sh', 'ruff'],             // 34k★  fast linter (Rust)
  ['astral-sh', 'uv'],               // 30k★  fast pip (Rust)
  ['pypa', 'pip'],                    // 10k★  package installer
  ['docopt', 'docopt'],              // 8k★   CLI arguments
  ['prompt-toolkit', 'python-prompt-toolkit'], // 9k★ REPL toolkit
  ['sivel', 'speedtest-cli'],        // 14k★  internet speed test
  ['encode', 'starlette'],           // 10k★  ASGI framework
  ['encode', 'uvicorn'],             // 8k★   ASGI server

  // ── Rust ──────────────────────────────────────────────────────
  // Castle / Citadel tier
  ['denoland', 'deno'],              // 100k★ JS/TS runtime
  ['tauri-apps', 'tauri'],           // 88k★  desktop apps
  ['alacritty', 'alacritty'],        // 57k★  GPU terminal
  ['BurntSushi', 'ripgrep'],         // 50k★  fast grep
  ['starship', 'starship'],          // 46k★  shell prompt
  ['astral-sh', 'ruff'],             // 35k★  Python linter
  ['servo', 'servo'],                // 29k★  browser engine
  ['tokio-rs', 'tokio'],             // 27k★  async runtime
  // Keep / Manor tier
  ['sharkdp', 'bat'],                // 50k★  cat replacement
  ['sharkdp', 'fd'],                 // 35k★  find replacement
  ['dandavison', 'delta'],           // 24k★  git diff viewer
  ['rust-lang', 'rust'],             // 100k★ the language itself
  ['swc-project', 'swc'],            // 31k★  JS/TS compiler
  ['tree-sitter', 'tree-sitter'],    // 18k★  parser generator
  ['Wilfred', 'difftastic'],         // 21k★  structural diff
  // Guild / Cottage tier
  ['ajeetdsouza', 'zoxide'],         // 23k★  cd replacement
  ['casey', 'just'],                 // 22k★  command runner
  ['BloopAI', 'bloop'],              // 10k★  code search
  ['eza-community', 'eza'],          // 12k★  ls replacement
  ['tokio-rs', 'axum'],              // 20k★  web framework
  ['serde-rs', 'serde'],             // 9k★   serialization
  ['de-vri-es', 'assert2-rs'],       // ~126★ assert macros
  ['crossbeam-rs', 'crossbeam'],     // 7k★   concurrency
  ['rayon-rs', 'rayon'],             // 11k★  parallelism
  // More Rust repos for density
  ['rust-lang', 'cargo'],            // 13k★  package manager
  ['rust-lang', 'rustlings'],        // 55k★  learning exercises
  ['helix-editor', 'helix'],         // 35k★  text editor
  ['bevyengine', 'bevy'],            // 37k★  game engine
  ['diesel-rs', 'diesel'],           // 13k★  ORM
  ['hyperium', 'hyper'],             // 15k★  HTTP library
  ['rust-lang', 'mdBook'],           // 18k★  markdown book
  ['clap-rs', 'clap'],               // 14k★  CLI parser
  ['launchbadge', 'sqlx'],           // 13k★  SQL toolkit
  ['dtolnay', 'anyhow'],             // 6k★   error handling
  ['dtolnay', 'thiserror'],          // 4k★   error derive
  ['dtolnay', 'serde-json'],         // 5k★   JSON for serde
  ['rust-itertools', 'itertools'],   // 3k★   iterator tools
  ['bitflags', 'bitflags'],          // 1k★   bitflag macros
  ['nushell', 'nushell'],            // 33k★  modern shell
  ['uutils', 'coreutils'],           // 18k★  Rust coreutils
  ['actix', 'actix-web'],            // 22k★  web framework
  ['tokio-rs', 'mio'],               // 6k★   I/O library
  ['Byron', 'gitoxide'],             // 9k★   Git in Rust
  ['Rigellute', 'spotify-tui'],      // 18k★  Spotify TUI
  ['ogham', 'exa'],                  // 24k★  ls replacement
  ['rust-lang', 'rustfmt'],          // 6k★   code formatter
  ['pest-parser', 'pest'],           // 5k★   parser generator

  // ── Go ────────────────────────────────────────────────────────
  // Castle / Citadel tier
  ['golang', 'go'],                  // 125k★ the language itself
  ['gin-gonic', 'gin'],              // 80k★  web framework
  ['gohugoio', 'hugo'],              // 77k★  static site gen
  ['junegunn', 'fzf'],               // 67k★  fuzzy finder
  ['traefik', 'traefik'],            // 52k★  reverse proxy
  ['ethereum', 'go-ethereum'],       // 48k★  Ethereum client
  ['cli', 'cli'],                    // 38k★  GitHub CLI
  // Keep / Manor tier
  ['containerd', 'containerd'],      // 18k★  container runtime
  ['gogs', 'gogs'],                  // 45k★  self-hosted Git
  ['labstack', 'echo'],              // 30k★  web framework
  ['go-chi', 'chi'],                 // 18k★  HTTP router
  ['stretchr', 'testify'],           // 24k★  testing toolkit
  ['gorilla', 'mux'],                // 21k★  HTTP router
  ['spf13', 'cobra'],                // 39k★  CLI framework
  ['spf13', 'viper'],                // 28k★  config library
  // Guild / Cottage tier
  ['uber-go', 'zap'],                // 22k★  structured logging
  ['go-gorm', 'gorm'],               // 37k★  ORM
  ['sirupsen', 'logrus'],            // 25k★  logger
  ['charmbracelet', 'bubbletea'],    // 28k★  TUI framework
  ['charmbracelet', 'glow'],         // 16k★  markdown reader
  ['abahmed', 'kwatch'],             // ~1k★  k8s monitoring
  ['derailed', 'k9s'],               // 27k★  k8s TUI
  // More Go repos for density
  ['hashicorp', 'terraform'],        // 43k★  infrastructure as code
  ['hashicorp', 'consul'],           // 29k★  service discovery
  ['hashicorp', 'vault'],            // 31k★  secrets management
  ['kubernetes', 'kubernetes'],      // 112k★ container orchestration
  ['prometheus', 'prometheus'],      // 56k★  monitoring
  ['jesseduffield', 'lazygit'],      // 54k★  Git TUI
  ['jesseduffield', 'lazydocker'],   // 38k★  Docker TUI
  ['FiloSottile', 'mkcert'],         // 51k★  local HTTPS certs
  ['rclone', 'rclone'],              // 48k★  cloud storage sync
  ['ollama', 'ollama'],              // 110k★ run LLMs locally
  ['minio', 'minio'],                // 49k★  object storage
  ['aquasecurity', 'trivy'],         // 24k★  security scanner
  ['golangci', 'golangci-lint'],     // 16k★  linter
  ['go-playground', 'validator'],    // 17k★  struct validation
  ['gofiber', 'fiber'],              // 34k★  Express-like framework
  ['tinygo-org', 'tinygo'],          // 15k★  Go for microcontrollers
  ['wailsapp', 'wails'],             // 26k★  desktop apps
  ['samber', 'lo'],                  // 18k★  lodash for Go
  ['go-task', 'task'],               // 12k★  task runner
  ['pressly', 'goose'],              // 7k★   DB migrations
  ['knadh', 'koanf'],                // 3k★   config library

  // ── C ─────────────────────────────────────────────────────────
  // Castle / Citadel tier
  ['torvalds', 'linux'],             // 185k★ the kernel
  ['redis', 'redis'],                // 67k★  in-memory DB
  ['git', 'git'],                    // 53k★  version control
  ['curl', 'curl'],                  // 36k★  data transfer
  ['nginx', 'nginx'],                // 25k★  web server
  // Keep / Manor tier
  ['FFmpeg', 'FFmpeg'],              // 46k★  multimedia
  ['libuv', 'libuv'],                // 24k★  async I/O
  ['tmux', 'tmux'],                  // 36k★  terminal multiplexer
  ['jqlang', 'jq'],                  // 31k★  JSON processor
  ['DaveGamble', 'cJSON'],           // 11k★  JSON parser
  ['mpv-player', 'mpv'],             // 29k★  media player
  // Guild / Cottage tier
  ['openssl', 'openssl'],            // 26k★  cryptography
  ['sqlite', 'sqlite'],              // 7k★   embedded DB
  ['libgit2', 'libgit2'],            // 10k★  Git library
  ['antirez', 'sds'],                // 5k★   string library
  ['zlib-ng', 'zlib-ng'],            // 2k★   compression
  ['antirez', 'kilo'],               // 8k★   tiny text editor
  ['systemd', 'systemd'],            // 14k★  init system
  ['obsproject', 'obs-studio'],      // 61k★  streaming
  // More C repos for density
  ['php', 'php-src'],                // 38k★  PHP interpreter
  ['python', 'cpython'],             // 64k★  Python interpreter
  ['nothings', 'stb'],               // 27k★  single-file libs
  ['wren-lang', 'wren'],             // 7k★   scripting language
  ['raysan5', 'raylib'],             // 23k★  game programming
  ['lvgl', 'lvgl'],                  // 17k★  embedded graphics
  ['cmus', 'cmus'],                  // 6k★   music player
  ['jarun', 'nnn'],                  // 19k★  file manager
  ['htop-dev', 'htop'],              // 6k★   process viewer
  ['openbsd', 'src'],                // 3k★   OS source
  ['micropython', 'micropython'],    // 20k★  embedded Python
  ['krallin', 'tini'],               // 10k★  init for containers
  ['hiredis', 'hiredis'],            // 6k★   Redis C client
  ['warmcat', 'libwebsockets'],      // 5k★   WebSocket library
  ['tatsuhiro-t', 'nghttp2'],        // 5k★   HTTP/2 library
  ['inotify-tools', 'inotify-tools'],// 2k★   file watching
  ['libusb', 'libusb'],              // 5k★   USB library
  ['jedisct1', 'minisign'],          // 2k★   signing tool
  ['redis', 'hiredis'],              // 6k★   Redis client
  ['HandBrake', 'HandBrake'],        // 18k★  video transcoder
  ['OpenVPN', 'openvpn'],            // 11k★  VPN

  // ── C++ ───────────────────────────────────────────────────────
  // Castle / Citadel tier
  ['tensorflow', 'tensorflow'],      // 187k★ ML framework
  ['electron', 'electron'],          // 115k★ desktop framework
  ['godotengine', 'godot'],          // 93k★  game engine
  ['bitcoin', 'bitcoin'],            // 80k★  cryptocurrency
  ['opencv', 'opencv'],              // 80k★  computer vision
  ['protocolbuffers', 'protobuf'],   // 66k★  serialization
  // Keep / Manor tier
  ['grpc', 'grpc'],                  // 42k★  RPC framework
  ['nlohmann', 'json'],              // 43k★  JSON library
  ['ClickHouse', 'ClickHouse'],      // 38k★  analytics DB
  ['google', 'leveldb'],             // 37k★  key-value store
  ['CMake', 'CMake'],                // 8k★   build system
  ['facebook', 'folly'],             // 29k★  core library
  // Guild / Cottage tier
  ['fmtlib', 'fmt'],                 // 21k★  formatting
  ['catchorg', 'Catch2'],            // 19k★  testing
  ['google', 'googletest'],          // 35k★  testing framework
  ['drogonframework', 'drogon'],     // 12k★  web framework
  ['pybind', 'pybind11'],            // 16k★  Python bindings
  ['ArthurSonzogni', 'FTXUI'],       // 7k★   TUI library
  ['taskflow', 'taskflow'],          // 10k★  parallel computing
  // More C++ repos for density
  ['llvm', 'llvm-project'],          // 30k★  compiler infrastructure
  ['facebook', 'rocksdb'],           // 29k★  embedded DB
  ['Tencent', 'rapidjson'],          // 14k★  JSON parser
  ['microsoft', 'terminal'],         // 96k★  Windows terminal
  ['tesseract-ocr', 'tesseract'],    // 63k★  OCR engine
  ['google', 'flatbuffers'],         // 23k★  serialization
  ['gabime', 'spdlog'],              // 24k★  fast logging
  ['yhirose', 'cpp-httplib'],        // 13k★  HTTP library
  ['doctest', 'doctest'],            // 6k★   testing
  ['ocornut', 'imgui'],              // 62k★  GUI library
  ['apache', 'arrow'],               // 15k★  columnar format
  ['abseil', 'abseil-cpp'],          // 15k★  core C++ library
  ['wolfSSL', 'wolfssl'],            // 2k★   SSL library
  ['open-source-parsers', 'jsoncpp'],// 8k★   JSON library
  ['cameron314', 'concurrentqueue'], // 10k★  lock-free queue
  ['bombela', 'backward-cpp'],       // 4k★   stack traces
  ['ericniebler', 'range-v3'],       // 4k★   range library
  ['p-ranav', 'argparse'],           // 3k★   argument parser
  ['simdjson', 'simdjson'],          // 19k★  fast JSON
  ['facebook', 'yoga'],              // 17k★  layout engine
  ['libcpr', 'cpr'],                 // 7k★   HTTP requests
  ['juce-framework', 'JUCE'],        // 7k★   audio framework
  ['SFML', 'SFML'],                  // 10k★  multimedia library
  ['emscripten-core', 'emscripten'], // 26k★  compile to WebAssembly
  ['SerenityOS', 'serenity'],        // 31k★  graphical OS

  // ── Java ──────────────────────────────────────────────────────
  // Castle / Citadel tier
  ['spring-projects', 'spring-boot'],// 76k★  web framework
  ['elastic', 'elasticsearch'],      // 71k★  search engine
  ['google', 'guava'],               // 50k★  core libraries
  ['ReactiveX', 'RxJava'],          // 48k★  reactive extensions
  ['apache', 'dubbo'],               // 40k★  RPC framework
  // Keep / Manor tier
  ['apache', 'kafka'],               // 29k★  event streaming
  ['apache', 'flink'],               // 24k★  stream processing
  ['mybatis', 'mybatis-3'],          // 20k★  SQL mapper
  ['google', 'gson'],                // 24k★  JSON library
  ['square', 'retrofit'],            // 43k★  HTTP client
  ['apache', 'spark'],               // 40k★  big data
  ['netty', 'netty'],                // 34k★  networking
  // Guild / Cottage tier
  ['junit-team', 'junit5'],          // 6k★   testing
  ['mockito', 'mockito'],            // 15k★  mocking
  ['apache', 'commons-lang'],        // 3k★   utilities
  ['apache', 'maven'],               // 4k★   build tool
  ['google', 'dagger'],              // 18k★  dependency injection
  ['hibernate', 'hibernate-orm'],    // 6k★   ORM
  ['knowm', 'Sundial'],              // ~276★ job scheduler
  ['resilience4j', 'resilience4j'],  // 10k★  fault tolerance
  // More Java repos for density
  ['google', 'ExoPlayer'],           // 22k★  media player
  ['bumptech', 'glide'],             // 35k★  image loading
  ['greenrobot', 'EventBus'],        // 25k★  event bus
  ['PhilJay', 'MPAndroidChart'],     // 38k★  charting
  ['alibaba', 'druid'],              // 28k★  database pool
  ['apache', 'shardingsphere'],      // 20k★  distributed DB
  ['quarkusio', 'quarkus'],          // 14k★  cloud native Java
  ['apache', 'tomcat'],              // 8k★   servlet container
  ['eclipse-vertx', 'vert.x'],      // 14k★  reactive toolkit
  ['apache', 'lucene'],              // 3k★   full-text search
  ['checkstyle', 'checkstyle'],      // 8k★   code style checker
  ['spotbugs', 'spotbugs'],          // 3k★   bug detector
  ['jhy', 'jsoup'],                  // 11k★  HTML parser
  ['zaproxy', 'zaproxy'],            // 13k★  security testing
  ['openjdk', 'jdk'],                // 20k★  the JDK
  ['eclipse-jkube', 'jkube'],        // 700★  Kubernetes Java
  ['apache', 'camel'],               // 6k★   integration
  ['micronaut-projects', 'micronaut-core'], // 6k★ microservices
  ['projectlombok', 'lombok'],       // 13k★  boilerplate reduction
  ['mapstruct', 'mapstruct'],        // 7k★   bean mapping
  ['deeplearning4j', 'deeplearning4j'], // 13k★ deep learning

  // ── Ruby ──────────────────────────────────────────────────────
  // Castle / Citadel tier
  ['rails', 'rails'],                // 56k★  web framework
  ['jekyll', 'jekyll'],              // 49k★  static site gen
  ['discourse', 'discourse'],        // 43k★  forum platform
  ['Homebrew', 'brew'],              // 42k★  package manager
  // Keep / Manor tier
  ['hashicorp', 'vagrant'],          // 26k★  dev environments
  ['ruby', 'ruby'],                  // 22k★  the language
  ['sinatra', 'sinatra'],            // 12k★  micro framework
  ['rubocop', 'rubocop'],            // 13k★  linter
  ['thoughtbot', 'factory_bot'],     // 8k★   test fixtures
  ['puma', 'puma'],                  // 8k★   web server
  // Guild / Cottage tier
  ['heartcombo', 'devise'],          // 24k★  authentication
  ['mperham', 'sidekiq'],            // 13k★  background jobs
  ['rspec', 'rspec-core'],           // 3k★   testing
  ['rack', 'rack'],                  // 5k★   web interface
  ['redis', 'redis-rb'],             // 4k★   Redis client
  ['ankane', 'informers'],           // ~600★ transformer inference
  ['ankane', 'disco'],               // ~600★ recommendations
  ['resque', 'resque'],              // 10k★  background jobs
  ['activerecord-hackery', 'ransack'], // 6k★ search
  ['slim-template', 'slim'],         // 5k★   template engine
  // More Ruby repos for density
  ['faker-ruby', 'faker'],           // 11k★  fake data
  ['ruby-grape', 'grape'],           // 10k★  REST API framework
  ['rmosolgo', 'graphql-ruby'],      // 5k★   GraphQL
  ['paper-trail-gem', 'paper_trail'],// 7k★   model versioning
  ['carrierwaveuploader', 'carrierwave'], // 9k★ file uploads
  ['CanCanCommunity', 'cancancan'],  // 6k★   authorization
  ['teamcapybara', 'capybara'],      // 10k★  integration testing
  ['minitest', 'minitest'],          // 3k★   testing
  ['doorkeeper-gem', 'doorkeeper'],  // 5k★   OAuth2 provider
  ['solidusio', 'solidus'],          // 5k★   e-commerce
  ['spree', 'spree'],                // 13k★  e-commerce
  ['chatwoot', 'chatwoot'],          // 21k★  customer support
  ['gitlabhq', 'gitlabhq'],         // 24k★  DevOps platform
  ['Shopify', 'liquid'],             // 11k★  template language
  ['hanami', 'hanami'],              // 6k★   web framework
  ['opal', 'opal'],                  // 5k★   Ruby to JS
  ['jnunemaker', 'httparty'],        // 6k★   HTTP client
  ['pry', 'pry'],                    // 7k★   REPL debugger
  ['presidentbeef', 'brakeman'],     // 7k★   security scanner
  ['shrinerb', 'shrine'],            // 3k★   file attachment

  // ── Shell ─────────────────────────────────────────────────────
  // Castle / Citadel tier
  ['ohmyzsh', 'ohmyzsh'],            // 175k★ zsh framework
  ['nvm-sh', 'nvm'],                 // 81k★  Node version manager
  // Keep / Manor tier
  ['pi-hole', 'pi-hole'],            // 50k★  network ad blocker
  ['romkatv', 'powerlevel10k'],      // 47k★  zsh theme
  ['acmesh-official', 'acme.sh'],    // 40k★  ACME client
  ['dylanaraps', 'neofetch'],        // 22k★  system info
  ['zsh-users', 'zsh-autosuggestions'], // 32k★ zsh plugin
  ['rupa', 'z'],                     // 16k★  directory jumper
  // Guild / Cottage tier
  ['rbenv', 'rbenv'],                // 16k★  Ruby version manager
  ['asdf-vm', 'asdf'],               // 22k★  version manager
  ['tj', 'n'],                       // 19k★  Node version manager
  ['jorgebucaran', 'fisher'],        // 8k★   fish plugin manager
  ['zsh-users', 'zsh-syntax-highlighting'], // 20k★ syntax highlight
  ['arzzen', 'git-quick-stats'],     // 6k★   git stats
  ['bash-my-aws', 'bash-my-aws'],    // 1k★   AWS CLI helpers
  ['denilsonsa', 'prettyping'],      // 3k★   pretty ping
  ['sharkdp', 'hyperfine'],          // 22k★  benchmarking (Rust, but Shell-heavy)
  // More Shell repos for density
  ['jenv', 'jenv'],                  // 6k★   Java version manager
  ['pyenv', 'pyenv'],                // 39k★  Python version manager
  ['tfutils', 'tfenv'],              // 4k★   Terraform version manager
  ['Bash-it', 'bash-it'],            // 14k★  bash framework
  ['ahmetb', 'kubectx'],             // 18k★  k8s context switcher
  ['junegunn', 'fzf-git.sh'],       // 1k★   fzf git integration
  ['sindresorhus', 'pure'],          // 13k★  zsh prompt
  ['bats-core', 'bats-core'],        // 5k★   bash testing
  ['direnv', 'direnv'],              // 13k★  env var manager
  // Removed: developer-roadmap (content/roadmap, not real code)
  ['moovweb', 'gvm'],                // 10k★  Go version manager
  ['creationix', 'nvm'],             // 81k★  Node version mgr
  ['docker', 'docker-bench-security'], // 9k★ Docker security
  // Removed: papers-we-love (paper collection), awesome-golang-security (awesome-list)
  ['spaceship-prompt', 'spaceship-prompt'], // 20k★ zsh prompt
  ['sorin-ionescu', 'prezto'],       // 14k★  zsh framework
  ['b4b4r07', 'enhancd'],            // 3k★   cd enhancement
  ['huyng', 'bashmarks'],            // 2k★   bookmarks
  // Removed: awesome-shell (awesome-list)
  ['mise-plugins', 'registry'],      // ~500★ mise plugin registry

  // ── PHP ───────────────────────────────────────────────────────
  // Castle / Citadel tier
  ['laravel', 'laravel'],            // 79k★  web framework
  // Keep / Manor tier
  ['symfony', 'symfony'],            // 30k★  web framework
  ['composer', 'composer'],          // 29k★  package manager
  ['WordPress', 'WordPress'],        // 20k★  CMS
  ['nextcloud', 'server'],           // 28k★  cloud platform
  ['PHPMailer', 'PHPMailer'],        // 21k★  email
  ['guzzle', 'guzzle'],              // 23k★  HTTP client
  // Guild / Cottage tier
  ['filamentphp', 'filament'],       // 20k★  admin panel
  ['phpstan', 'phpstan'],            // 13k★  static analysis
  ['briannesbitt', 'Carbon'],        // 17k★  datetime
  ['slimphp', 'Slim'],               // 12k★  micro framework
  ['PHPOffice', 'PhpSpreadsheet'],   // 14k★  spreadsheets
  ['sebastianbergmann', 'phpunit'],  // 20k★  testing
  ['Intervention', 'image'],         // 14k★  image processing
  ['barryvdh', 'laravel-debugbar'], // 17k★  debug toolbar
  ['fzaninotto', 'Faker'],           // 27k★  fake data
  // More PHP repos for density
  ['doctrine', 'orm'],               // 10k★  ORM
  ['vlucas', 'phpdotenv'],           // 13k★  env variables
  ['thephpleague', 'flysystem'],     // 13k★  filesystem abstraction
  ['ramsey', 'uuid'],                // 13k★  UUID generator
  ['spatie', 'laravel-permission'],  // 12k★  roles & permissions
  ['livewire', 'livewire'],          // 22k★  full-stack components
  ['pestphp', 'pest'],               // 9k★   testing framework
  ['rectorphp', 'rector'],           // 9k★   automated refactoring
  ['nunomaduro', 'phpinsights'],     // 5k★   code quality
  ['nette', 'nette'],                // 2k★   web framework
  ['predis', 'predis'],              // 8k★   Redis client
  ['jenssegers', 'laravel-mongodb'], // 7k★   MongoDB for Laravel
  ['thecodingmachine', 'safe'],      // 2k★   safe PHP functions
  ['phpro', 'grumphp'],              // 4k★   git hooks
  ['thephpleague', 'csv'],           // 3k★   CSV handling
  ['Sylius', 'Sylius'],              // 8k★   e-commerce
  ['cachethq', 'cachet'],            // 14k★  status pages
  ['matomo-org', 'matomo'],          // 20k★  analytics
  ['firefly-iii', 'firefly-iii'],    // 17k★  finance manager
  ['monicahq', 'monica'],            // 22k★  personal CRM

  // ── Swift ─────────────────────────────────────────────────────
  // Castle / Citadel tier
  ['apple', 'swift'],                // 68k★  the language
  ['Alamofire', 'Alamofire'],        // 41k★  HTTP networking
  // Keep / Manor tier
  ['vapor', 'vapor'],                // 25k★  server-side Swift
  ['ReactiveX', 'RxSwift'],          // 25k★  reactive programming
  ['realm', 'SwiftLint'],            // 19k★  linter
  ['onevcat', 'Kingfisher'],         // 23k★  image loading
  ['SnapKit', 'SnapKit'],            // 20k★  Auto Layout
  // Guild / Cottage tier
  ['SwiftyJSON', 'SwiftyJSON'],      // 22k★  JSON parsing
  ['Moya', 'Moya'],                  // 15k★  network abstraction
  ['Swinject', 'Swinject'],          // 6k★   dependency injection
  ['airbnb', 'lottie-ios'],          // 26k★  animations
  ['danielgindi', 'Charts'],         // 28k★  charting
  ['krzyzanowskim', 'CryptoSwift'],  // 10k★  cryptography
  ['mac-cain13', 'R.swift'],         // 10k★  resources
  ['apple', 'swift-nio'],            // 8k★   networking
  ['pointfreeco', 'swift-composable-architecture'], // 12k★ architecture
  ['kean', 'Nuke'],                  // 8k★   image loading
  // More Swift repos for density
  ['ReactiveCocoa', 'ReactiveCocoa'], // 20k★ reactive programming
  ['stephencelis', 'SQLite.swift'],  // 10k★  SQLite wrapper
  ['Quick', 'Quick'],                // 10k★  BDD testing
  ['Quick', 'Nimble'],               // 5k★   matcher framework
  ['hackiftekhar', 'IQKeyboardManager'], // 17k★ keyboard handling
  ['IBAnimatable', 'IBAnimatable'],  // 9k★   Interface Builder
  ['mapbox', 'mapbox-maps-ios'],     // 500★  maps SDK
  ['kishikawakatsumi', 'KeychainAccess'], // 8k★ Keychain wrapper
  ['SwiftGen', 'SwiftGen'],          // 9k★   code generation
  ['malcommac', 'SwiftDate'],        // 8k★   date handling
  ['daltoniam', 'Starscream'],       // 8k★   WebSockets
  ['sunshinejr', 'SwiftyUserDefaults'], // 5k★ UserDefaults
  ['marcosgriselli', 'ViewAnimator'],// 7k★   view animations
  ['raywenderlich', 'swift-algorithm-club'], // 29k★ algorithms
  ['yonaskolb', 'XcodeGen'],         // 7k★   project generation
  ['SwiftKickMobile', 'SwiftMessages'], // 7k★ messages
  ['jtrivedi', 'Wave'],              // 2k★   spring animations
  ['markiv', 'SwiftUI-Shimmer'],     // 1k★   shimmer effect
  ['krzysztofzablocki', 'Sourcery'], // 8k★   code generation

  // ── Kotlin ────────────────────────────────────────────────────
  // Castle / Citadel tier
  ['JetBrains', 'kotlin'],           // 50k★  the language
  ['square', 'okhttp'],              // 46k★  HTTP client
  // Keep / Manor tier
  ['square', 'leakcanary'],          // 30k★  memory leak detection
  ['InsertKoinIO', 'koin'],          // 9k★   dependency injection
  ['ktorio', 'ktor'],                // 13k★  web framework
  ['JetBrains', 'compose-multiplatform'], // 16k★ cross-platform UI
  ['google', 'flexbox-layout'],      // 18k★  flexbox for Android
  ['JetBrains', 'Exposed'],          // 8k★   SQL library
  // Guild / Cottage tier
  ['Kotlin', 'kotlinx.coroutines'],  // 13k★  coroutines
  ['Kotlin', 'kotlinx.serialization'], // 5k★ serialization
  ['cashapp', 'turbine'],            // 2k★   flow testing
  ['mockk', 'mockk'],                // 5k★   mocking
  ['detekt', 'detekt'],              // 6k★   static analysis
  ['pinterest', 'ktlint'],           // 6k★   linter
  ['kotest', 'kotest'],              // 4k★   testing
  ['arrow-kt', 'arrow'],             // 6k★   functional programming
  // More Kotlin repos for density
  ['android', 'architecture-components-samples'], // 24k★ architecture
  ['google', 'accompanist'],         // 8k★   Compose helpers
  ['coil-kt', 'coil'],              // 11k★  image loading
  ['airbnb', 'mavericks'],          // 6k★   Android framework
  ['chrisbanes', 'tivi'],           // 7k★   TV show app
  ['Netflix', 'dgs-framework'],      // 3k★   GraphQL framework
  ['Kodein-Framework', 'Kodein-DI'], // 3k★   dependency injection
  ['JakeWharton', 'timber'],         // 10k★  logging
  ['material-components', 'material-components-android'], // 16k★ UI
  ['didi', 'booster'],               // 5k★   optimization
  ['Triple-T', 'gradle-play-publisher'], // 4k★ Play Store publish
  ['square', 'moshi'],               // 10k★  JSON library
  ['google', 'ksp'],                 // 3k★   symbol processing
  ['JetBrains', 'intellij-community'], // 17k★ IDE
  ['square', 'wire'],                // 4k★   protocol buffers
  ['mikepenz', 'MaterialDrawer'],    // 12k★  navigation drawer
  ['skydoves', 'Pokedex'],           // 8k★   sample app
  ['Kotlin', 'dokka'],               // 4k★   documentation
  ['russhwolf', 'multiplatform-settings'], // 1k★ KMP settings
  ['touchlab', 'Kermit'],            // 800★  KMP logging
  ['icerockdev', 'moko-resources'],  // 500★  KMP resources

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

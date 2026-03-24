/**
 * Client-side API helpers for Git Kingdom.
 * These call our Vercel serverless functions.
 */
import type { KingdomMetrics } from '../types';

export interface AuthUser {
  login: string;
  github_id: number;
  avatar_url: string;
}

export interface WorldData {
  repos: KingdomMetrics[];
  users: string[];
  updatedAt: string;
}

/**
 * Check if the user is signed in via GitHub OAuth.
 * Returns user info or null if not signed in.
 */
export async function fetchCurrentUser(): Promise<AuthUser | null> {
  try {
    const res = await fetch('/api/auth/me', { credentials: 'include' });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Redirect to GitHub OAuth sign-in.
 */
export function signInWithGitHub() {
  window.location.href = '/api/auth/login';
}

/**
 * Sign out (clears session cookie).
 */
export async function signOut() {
  window.location.href = '/api/auth/logout';
}

// ─── localStorage cache for instant return-visit loading ──────
const WORLD_CACHE_KEY = 'gk_world_v1';
const WORLD_CACHE_TTL = 60 * 60 * 1000; // 1 hour

function loadCachedWorld(): WorldData | null {
  try {
    const raw = localStorage.getItem(WORLD_CACHE_KEY);
    if (!raw) return null;
    const { data, ts } = JSON.parse(raw);
    if (Date.now() - ts > WORLD_CACHE_TTL) {
      localStorage.removeItem(WORLD_CACHE_KEY);
      return null;
    }
    return data as WorldData;
  } catch {
    return null;
  }
}

function saveCachedWorld(data: WorldData) {
  try {
    localStorage.setItem(WORLD_CACHE_KEY, JSON.stringify({ data, ts: Date.now() }));
  } catch {
    // localStorage full or unavailable — silently skip
  }
}

/**
 * Fetch the universal world data.
 * Strategy:
 * 1. Return localStorage cache immediately if fresh (< 1 hour)
 * 2. Load pre-baked JSON + delta from Supabase
 * 3. Save result to localStorage for next visit
 */
let worldCache: WorldData | null | undefined;
export async function fetchUniversalWorld(): Promise<WorldData | null> {
  if (worldCache !== undefined) return worldCache;

  // Fast path: return localStorage cache if fresh
  const cached = loadCachedWorld();
  if (cached) {
    console.log(`[world] Using cached data (${cached.repos.length} repos)`);
    worldCache = cached;
    return cached;
  }

  try {
    // 1. Load pre-baked JSON (fast, static, cached by browser)
    const jsonRes = await fetch('/data/default-world.json');
    if (!jsonRes.ok) {
      // No JSON available — fall back to full Supabase fetch
      return fetchFullWorld();
    }
    const base = (await jsonRes.json()) as WorldData;
    if (!base.repos || base.repos.length === 0) {
      return fetchFullWorld();
    }

    // 2. Fetch delta: only repos added/updated since the JSON was exported
    const since = base.updatedAt;
    if (since) {
      try {
        const deltaRes = await fetch(`/api/world?since=${encodeURIComponent(since)}`);
        if (deltaRes.ok) {
          const delta = (await deltaRes.json()) as WorldData;
          if (delta.repos && delta.repos.length > 0) {
            // Merge: delta repos override base repos by full_name
            const baseMap = new Map(base.repos.map(r => [r.repo.full_name.toLowerCase(), r]));
            for (const r of delta.repos) {
              baseMap.set(r.repo.full_name.toLowerCase(), r);
            }
            base.repos = Array.from(baseMap.values());
            console.log(`[world] Merged ${delta.repos.length} new/updated repos into ${base.repos.length} total`);
          }
          // Use fresh user list from delta
          if (delta.users) base.users = delta.users;
        }
      } catch {
        // Delta fetch failed — base data is still good
      }
    }

    worldCache = base;
    saveCachedWorld(base);
    return base;
  } catch {
    // JSON fetch failed — try full Supabase fetch
    return fetchFullWorld();
  }
}

/** Full Supabase fetch (fallback when JSON isn't available) */
async function fetchFullWorld(): Promise<WorldData | null> {
  try {
    const res = await fetch('/api/world');
    if (!res.ok) { worldCache = null; return null; }
    worldCache = (await res.json()) as WorldData;
    if (worldCache) saveCachedWorld(worldCache);
    return worldCache ?? null;
  } catch {
    worldCache = null;
    return null;
  }
}

/** Clear the memoized world cache (call after join to get fresh data) */
export function invalidateWorldCache() {
  worldCache = undefined;
  try { localStorage.removeItem(WORLD_CACHE_KEY); } catch { /* noop */ }
}

/**
 * Tell the server to add the signed-in user's repos to the universal world.
 */
export async function joinWorld(): Promise<{ ok: boolean; addedRepos: number } | null> {
  try {
    const res = await fetch('/api/world/join', {
      method: 'POST',
      credentials: 'include',
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export interface UserRepo {
  id: number;
  full_name: string;
  name: string;
  language: string | null;
  stargazers: number;
  description: string | null;
  owner_login: string;
}

/**
 * Fetch the signed-in user's claimed repos.
 */
export async function fetchMyRepos(): Promise<UserRepo[] | null> {
  try {
    const res = await fetch('/api/user/repos', { credentials: 'include' });
    if (!res.ok) return null;
    const data = await res.json();
    return data.repos || null;
  } catch {
    return null;
  }
}

/** Add a repo to the world (no auth required) */
export async function addRepo(
  input: string,
  turnstileToken?: string,
): Promise<{ ok: boolean; repo?: string; language?: string; stars?: number; already?: boolean; error?: string }> {
  const res = await fetch('/api/repo/add', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: input, turnstileToken }),
  });
  return res.json();
}

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
  window.location.href = '/api/auth/github';
}

/**
 * Sign out (clears session cookie).
 */
export async function signOut() {
  window.location.href = '/api/auth/logout';
}

/**
 * Fetch the universal world data from our API.
 * Memoized — only fetches once per page load (cache cleared on join).
 * Returns null if the API is not available (e.g. running locally without Vercel).
 */
let worldCache: WorldData | null | undefined;
export async function fetchUniversalWorld(): Promise<WorldData | null> {
  if (worldCache !== undefined) return worldCache;
  try {
    const res = await fetch('/api/world');
    if (!res.ok) { worldCache = null; return null; }
    worldCache = await res.json();
    return worldCache;
  } catch {
    worldCache = null;
    return null;
  }
}

/** Clear the memoized world cache (call after join to get fresh data) */
export function invalidateWorldCache() { worldCache = undefined; }

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

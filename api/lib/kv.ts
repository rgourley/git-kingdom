/**
 * Vercel KV helpers for the Git Kingdom universal world registry.
 *
 * Data model:
 *   registry:users                   → Set<string> of GitHub usernames
 *   user:{username}                  → { login, github_id, avatar_url, joined_at }
 *   user:{username}:repos            → KingdomMetrics[]
 *   user:{username}:repos:updated_at → timestamp
 *   world:snapshot                   → { repos, users, updatedAt }
 */
import { kv } from '@vercel/kv';

interface KingdomMetrics {
  repo: {
    full_name: string;
    name: string;
    language: string | null;
    stargazers_count: number;
    [key: string]: any;
  };
  contributors: any[];
  totalCommits: number;
  king: any;
}

interface WorldSnapshot {
  repos: KingdomMetrics[];
  users: string[];
  updatedAt: string;
}

interface UserRecord {
  login: string;
  github_id: number;
  avatar_url: string;
  joined_at: string;
}

/**
 * Register a user in the world.
 */
export async function registerUser(user: UserRecord): Promise<void> {
  await kv.set(`user:${user.login}`, user);
  await kv.sadd('registry:users', user.login);
}

/**
 * Store a user's repo metrics.
 */
export async function setUserRepos(username: string, repos: KingdomMetrics[]): Promise<void> {
  await kv.set(`user:${username}:repos`, repos);
  await kv.set(`user:${username}:repos:updated_at`, Date.now());
}

/**
 * Get a user's cached repo metrics.
 */
export async function getUserRepos(username: string): Promise<KingdomMetrics[] | null> {
  return kv.get<KingdomMetrics[]>(`user:${username}:repos`);
}

/**
 * Get all registered usernames.
 */
export async function getRegisteredUsers(): Promise<string[]> {
  const users = await kv.smembers('registry:users');
  return users || [];
}

/**
 * Get the current world snapshot.
 */
export async function getWorldSnapshot(): Promise<WorldSnapshot | null> {
  return kv.get<WorldSnapshot>('world:snapshot');
}

/**
 * Rebuild the world snapshot by merging all users' repos.
 * Deduplicates by repo full_name (first one wins).
 */
export async function rebuildWorldSnapshot(): Promise<WorldSnapshot> {
  const users = await getRegisteredUsers();
  const allRepos: KingdomMetrics[] = [];
  const seen = new Set<string>();

  // Gather repos from all registered users
  for (const username of users) {
    const repos = await getUserRepos(username);
    if (!repos) continue;
    for (const repo of repos) {
      const key = repo.repo.full_name.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        allRepos.push(repo);
      }
    }
  }

  const snapshot: WorldSnapshot = {
    repos: allRepos,
    users,
    updatedAt: new Date().toISOString(),
  };

  await kv.set('world:snapshot', snapshot);
  return snapshot;
}

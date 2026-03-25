/**
 * Server-side GitHub API helpers.
 * These run in Vercel serverless functions with the user's OAuth token.
 */

interface RepoData {
  full_name: string;
  name: string;
  description: string | null;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  language: string | null;
  created_at: string;
  updated_at: string;
  pushed_at: string;
  owner: { login: string; avatar_url: string };
  topics?: string[];
  size: number;
}

interface ContributorData {
  login: string;
  contributions: number;
  avatar_url: string;
  last_commit_message?: string;
}

interface KingdomMetrics {
  repo: RepoData;
  contributors: ContributorData[];
  totalCommits: number;
  king: ContributorData | null;
}

const GH_API = 'https://api.github.com';

/** Validate GitHub username/org name format */
function validateUsername(name: string): void {
  if (!/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/.test(name)) {
    throw new Error(`Invalid GitHub username: ${name}`);
  }
}

function ghHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github.v3+json',
  };
}

/**
 * Fetch a user's public repos from GitHub, sorted by stars.
 * Returns [owner, repo] tuples for repos with stars >= minStars.
 */
export async function fetchUserReposServer(
  username: string,
  token: string,
  maxRepos = 50,
  minStars = 1,
): Promise<[string, string][]> {
  validateUsername(username);
  const repos: [string, string][] = [];

  // Try as a user first, then as an org
  for (const endpoint of [`/users/${username}/repos`, `/orgs/${username}/repos`]) {
    try {
      const res = await fetch(
        `${GH_API}${endpoint}?per_page=${maxRepos}&sort=stars&direction=desc`,
        { headers: ghHeaders(token) },
      );
      if (!res.ok) continue;
      const data = await res.json();
      for (const repo of data) {
        if (repo.fork) continue; // skip forks
        if (repo.stargazers_count >= minStars) {
          repos.push([repo.owner.login, repo.name]);
        }
      }
      if (repos.length > 0) break; // found repos, don't try org endpoint
    } catch {
      continue;
    }
  }

  return repos;
}

/**
 * Fetch a user's repos and return KingdomMetrics with full contributor data.
 * Step 1: list repos (1 API call)
 * Step 2: fetch contributors for each repo in parallel (N API calls)
 */
export async function fetchUserReposAsMetrics(
  username: string,
  token: string,
  maxRepos = 100,
  minStars = 0,
): Promise<KingdomMetrics[]> {
  validateUsername(username);
  const repoTuples: [string, string][] = [];

  for (const endpoint of [`/users/${username}/repos`, `/orgs/${username}/repos`]) {
    try {
      const res = await fetch(
        `${GH_API}${endpoint}?per_page=${maxRepos}&sort=stars&direction=desc`,
        { headers: ghHeaders(token) },
      );
      if (!res.ok) continue;
      const data = await res.json();
      for (const repo of data) {
        if (repo.fork) continue;
        if (repo.stargazers_count < minStars) continue;
        repoTuples.push([repo.owner.login, repo.name]);
      }
      if (repoTuples.length > 0) break;
    } catch {
      continue;
    }
  }

  // Fetch full metrics (including contributors) for each repo
  return fetchAllRepoMetrics(repoTuples, token, 5);
}

async function fetchLastCommitMessage(
  owner: string,
  repo: string,
  author: string,
  token: string
): Promise<string | undefined> {
  try {
    const res = await fetch(
      `${GH_API}/repos/${owner}/${repo}/commits?author=${author}&per_page=1`,
      { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.v3+json' } }
    );
    if (!res.ok) return undefined;
    const commits = await res.json();
    if (commits.length > 0 && commits[0].commit?.message) {
      const msg = commits[0].commit.message.split('\n')[0]; // first line only
      return msg.length > 80 ? msg.slice(0, 77) + '...' : msg;
    }
  } catch { /* silent */ }
  return undefined;
}

/**
 * Fetch full KingdomMetrics for a single repo.
 */
export async function fetchRepoMetrics(
  owner: string,
  repo: string,
  token: string,
): Promise<KingdomMetrics | null> {
  try {
    // Fetch repo data and contributors in parallel
    const [repoRes, contribRes] = await Promise.all([
      fetch(`${GH_API}/repos/${owner}/${repo}`, { headers: ghHeaders(token) }),
      fetch(`${GH_API}/repos/${owner}/${repo}/contributors?per_page=20`, { headers: ghHeaders(token) }),
    ]);

    if (!repoRes.ok) return null;

    const repoData = await repoRes.json();
    const contributors: ContributorData[] = contribRes.ok
      ? (await contribRes.json()).map((c: any) => ({
          login: c.login,
          contributions: c.contributions,
          avatar_url: c.avatar_url,
        }))
      : [];

    const topContributors = contributors.slice(0, 5);
    await Promise.all(
      topContributors.map(async (c) => {
        c.last_commit_message = await fetchLastCommitMessage(owner, repo, c.login, token);
      })
    );

    const totalCommits = contributors.reduce((sum, c) => sum + c.contributions, 0);
    const king = contributors.length > 0
      ? contributors.reduce((a, b) => a.contributions >= b.contributions ? a : b)
      : null;

    return {
      repo: {
        full_name: repoData.full_name,
        name: repoData.name,
        description: repoData.description,
        stargazers_count: repoData.stargazers_count,
        forks_count: repoData.forks_count,
        open_issues_count: repoData.open_issues_count,
        language: repoData.language,
        created_at: repoData.created_at,
        updated_at: repoData.updated_at,
        pushed_at: repoData.pushed_at || repoData.updated_at,
        owner: { login: repoData.owner.login, avatar_url: repoData.owner.avatar_url },
        topics: repoData.topics || [],
        size: repoData.size,
      },
      contributors,
      totalCommits,
      king,
    };
  } catch {
    return null;
  }
}

/**
 * Fetch metrics for a list of repos (with concurrency limit).
 * Uses index-based iteration to avoid race conditions on shared queue.
 */
export async function fetchAllRepoMetrics(
  repos: [string, string][],
  token: string,
  concurrency = 10,
): Promise<KingdomMetrics[]> {
  const results: KingdomMetrics[] = [];
  let nextIndex = 0; // atomic-safe: JS is single-threaded between awaits

  async function worker() {
    while (true) {
      const idx = nextIndex++;
      if (idx >= repos.length) break;
      const [owner, repo] = repos[idx];
      try {
        const metrics = await fetchRepoMetrics(owner, repo, token);
        if (metrics) results.push(metrics);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[github] Failed to fetch ${owner}/${repo}: ${msg}`);
      }
    }
  }

  // Run N workers in parallel
  const workers = Array.from({ length: Math.min(concurrency, repos.length) }, () => worker());
  await Promise.all(workers);

  return results;
}

/** Convert KingdomMetrics to a Supabase repos table row */
export function metricsToRepoRow(m: KingdomMetrics, fallbackOwner?: string, fallbackAvatar?: string) {
  return {
    full_name: m.repo.full_name.toLowerCase(),
    name: m.repo.name,
    owner_login: m.repo.owner?.login || fallbackOwner || '',
    owner_avatar: m.repo.owner?.avatar_url || fallbackAvatar || '',
    description: m.repo.description,
    language: m.repo.language,
    stargazers: m.repo.stargazers_count,
    forks: m.repo.forks_count,
    open_issues: m.repo.open_issues_count,
    size_kb: m.repo.size || 0,
    created_at: m.repo.created_at,
    pushed_at: m.repo.pushed_at || m.repo.updated_at,
    topics: m.repo.topics || [],
    total_commits: m.totalCommits,
    merged_prs: Math.floor(m.totalCommits * 0.3),
    king_login: m.king?.login || null,
    king_avatar: m.king?.avatar_url || null,
    king_contributions: m.king?.contributions || 0,
    fetched_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

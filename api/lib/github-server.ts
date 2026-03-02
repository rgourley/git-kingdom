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
  owner: { login: string; avatar_url: string };
  topics?: string[];
  size: number;
}

interface ContributorData {
  login: string;
  contributions: number;
  avatar_url: string;
}

interface KingdomMetrics {
  repo: RepoData;
  contributors: ContributorData[];
  totalCommits: number;
  king: ContributorData | null;
}

const GH_API = 'https://api.github.com';

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
 * Fetch a user's repos and return KingdomMetrics directly from the listing.
 * Uses only 1 API call (the repos listing), not per-repo fetches.
 * Contributors are left empty — they can be fetched lazily when entering a city.
 */
export async function fetchUserReposAsMetrics(
  username: string,
  token: string,
  maxRepos = 100,
  minStars = 0,
): Promise<KingdomMetrics[]> {
  const metrics: KingdomMetrics[] = [];

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
        metrics.push({
          repo: {
            full_name: repo.full_name,
            name: repo.name,
            description: repo.description,
            stargazers_count: repo.stargazers_count,
            forks_count: repo.forks_count,
            open_issues_count: repo.open_issues_count,
            language: repo.language,
            created_at: repo.created_at,
            updated_at: repo.updated_at,
            owner: { login: repo.owner.login, avatar_url: repo.owner.avatar_url },
            topics: repo.topics || [],
            size: repo.size || 0,
          },
          contributors: [],  // empty — fetched lazily when entering city
          totalCommits: 0,
          king: { login: repo.owner.login, contributions: 0, avatar_url: repo.owner.avatar_url },
        });
      }
      if (metrics.length > 0) break;
    } catch {
      continue;
    }
  }

  return metrics;
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
 */
export async function fetchAllRepoMetrics(
  repos: [string, string][],
  token: string,
  concurrency = 10,
): Promise<KingdomMetrics[]> {
  const results: KingdomMetrics[] = [];
  const queue = [...repos];

  async function worker() {
    while (queue.length > 0) {
      const [owner, repo] = queue.shift()!;
      const metrics = await fetchRepoMetrics(owner, repo, token);
      if (metrics) results.push(metrics);
    }
  }

  // Run N workers in parallel
  const workers = Array.from({ length: Math.min(concurrency, repos.length) }, () => worker());
  await Promise.all(workers);

  return results;
}

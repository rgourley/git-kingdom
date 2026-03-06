/**
 * Client-side route parser for Git Kingdom.
 *
 * URL patterns:
 *   /                    → Universal world (no highlight)
 *   /facebook            → Universal world, highlight facebook's repos
 *   /facebook/react      → Enter city containing facebook/react, focus that building
 */

// TODO: Load reserved paths from a shared config or validate against GitHub's reserved usernames
// Paths that should NOT be interpreted as username routes
const RESERVED_PATHS = new Set([
  'editor.html',
  'assets',
  'data',
  'api',
  'about',
  'privacy',
  'changelog',
  'how-it-works',
  'faq',
  'admin',
  'citizen',
]);

export interface Route {
  /** GitHub username whose repos to highlight (null = no highlight) */
  username: string | null;
  /** Specific repo name to focus on within a city (null = none) */
  repoName: string | null;
}

export function parseRoute(): Route {
  const path = window.location.pathname;

  // Root or empty → universal world, no highlight
  if (path === '/' || path === '') {
    return { username: null, repoName: null };
  }

  const parts = path.split('/').filter(Boolean);

  // Skip reserved paths (assets, api, editor)
  if (parts.length > 0 && RESERVED_PATHS.has(parts[0])) {
    return { username: null, repoName: null };
  }

  return {
    username: parts[0] || null,
    repoName: parts[1] || null,
  };
}

/**
 * Update the browser URL without a full page reload.
 * Used when navigating between world/city views.
 */
export function pushRoute(username: string | null, repoName?: string | null) {
  let path = '/';
  if (username) {
    path = `/${username}`;
    if (repoName) {
      path += `/${repoName}`;
    }
  }
  window.history.pushState({}, '', path);
}

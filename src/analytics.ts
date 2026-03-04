/**
 * Centralized Google Analytics (gtag.js) event tracking for Git Kingdom.
 *
 * All scenes import typed helpers from here instead of calling window.gtag
 * directly. Every call is guarded so analytics is a complete no-op when
 * gtag isn't loaded (ad-blockers, local dev without the script tag).
 */

// ─── Type declaration for gtag on window ─────────────────────
declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}

// ─── Core tracking function ──────────────────────────────────
function trackEvent(
  name: string,
  params?: Record<string, string | number | boolean>,
): void {
  if (typeof window.gtag === 'function') {
    window.gtag('event', name, params);
  }
}

// ─── Virtual pageview (SPA navigation) ───────────────────────
export function trackPageView(pagePath: string, pageTitle?: string): void {
  const title = pageTitle || document.title;
  document.title = title;
  trackEvent('page_view', {
    page_path: pagePath,
    page_title: title,
  });
}

// ─── Game lifecycle ──────────────────────────────────────────
export function trackGameStart(): void {
  trackEvent('game_start');
}

// ─── World Scene events ──────────────────────────────────────
export function trackCityEntered(params: {
  language: string;
  repo_count: number;
  total_stars: number;
}): void {
  trackEvent('city_entered', params);
}

export function trackWorldSearch(params: {
  query: string;
  found: boolean;
}): void {
  trackEvent('world_search', params);
}

// ─── City Scene events ───────────────────────────────────────
export function trackBuildingClicked(params: {
  repo_full_name: string;
  language: string;
  stars: number;
  rank: string;
}): void {
  trackEvent('building_clicked', params);
}

export function trackCitizenClicked(params: {
  user_login: string;
  contributions: number;
}): void {
  trackEvent('citizen_clicked', params);
}

export function trackCityExited(): void {
  trackEvent('city_exited');
}

// ─── External link events ────────────────────────────────────
export function trackGitHubLinkClicked(params: {
  link_type: 'user' | 'repo';
  target: string;
  context: string;
}): void {
  trackEvent('github_link_clicked', params);
}

// ─── Auth events ─────────────────────────────────────────────
export function trackSignInInitiated(): void {
  trackEvent('signin_initiated');
}

export function trackWorldJoined(params: { added_repos: number }): void {
  trackEvent('world_joined', params);
}

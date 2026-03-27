/**
 * GET /api/citizen?username={username}
 * Returns character sheet data for a GitHub citizen.
 * Queries Supabase for all repos this user contributes to,
 * computes RPG stats and badges.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createServiceClient } from './lib/supabase';

// ─── Title system (mirrored from CityScene.ts) ─────────────────
const TITLE_TIERS: { min: number; icon: string; names: string[] }[] = [
  { min: 0,    icon: '👑', names: ['Sovereign', 'Monarch', 'Liege Lord', 'High King', 'Overlord', 'Supreme Ruler'] },
  { min: 5000, icon: '🏰', names: ['Archduke', 'Regent', 'High Chancellor', 'Grand Protector', 'Viceroy', 'Grand Marshal', 'Lord Commander', 'Royal Steward'] },
  { min: 3000, icon: '🏰', names: ['Marquess', 'Palatine', 'Viceroy', 'Warden', 'Grand Steward', 'Emissary'] },
  { min: 1500, icon: '⚜',  names: ['Earl', 'Viscount', 'Jarl', 'Overlord', 'Warden', 'Castellan', 'Protector'] },
  { min: 750,  icon: '🛡',  names: ['Thane', 'Castellan', 'Liege', 'Banneret', 'Steward', 'Keeper', 'Seneschal'] },
  { min: 300,  icon: '⚔',  names: ['Knight', 'Paladin', 'Templar', 'Sentinel', 'Champion', 'Crusader', 'Defender', 'Guardian'] },
  { min: 100,  icon: '🗡',  names: ['Squire', 'Esquire', 'Herald', 'Reeve', 'Magistrate', 'Bailiff', 'Alderman', 'Yeoman'] },
  { min: 25,   icon: '🔨',  names: ['Artisan', 'Scribe', 'Mason', 'Smith', 'Alchemist', 'Herbalist', 'Tinkerer', 'Sage'] },
  { min: 0,    icon: '🧑',  names: ['Peasant', 'Villager', 'Commoner', 'Serf', 'Wanderer', 'Pilgrim', 'Drifter', 'Vagabond'] },
];

function getTitle(contributions: number, isKing: boolean): { icon: string; name: string } {
  if (isKing) {
    const royalNames = TITLE_TIERS[0].names;
    return { icon: '👑', name: royalNames[contributions % royalNames.length] };
  }
  for (let i = 1; i < TITLE_TIERS.length; i++) {
    if (contributions >= TITLE_TIERS[i].min) {
      const tier = TITLE_TIERS[i];
      // Use a hash of contributions to pick variant
      return { icon: tier.icon, name: tier.names[contributions % tier.names.length] };
    }
  }
  return { icon: '🧑', name: 'Peasant' };
}

// ─── Stat scaling ────────────────────────────────────────────────
function statScale(value: number, softMax: number): number {
  if (value <= 0) return 1;
  return Math.min(20, Math.max(1, Math.round(Math.log2(value + 1) / Math.log2(softMax + 1) * 20)));
}

// ─── Badge computation ──────────────────────────────────────────
interface RepoRow {
  full_name: string;
  language: string | null;
  stargazers: number;
  forks: number;
  pushed_at: string | null;
  owner_login: string;
  king_login: string | null;
  contributions: number; // this citizen's contributions to this repo
}

interface Badge {
  id: string;
  icon: string;
  label: string;
}

function computeBadges(login: string, totalContribs: number, repos: RepoRow[], languages: string[]): Badge[] {
  const badges: Badge[] = [];
  const now = Date.now();
  const threeDays = 3 * 24 * 60 * 60 * 1000;
  const totalStars = repos.reduce((s, r) => s + r.stargazers, 0);

  // Titan — 1000+ contributions
  if (totalContribs >= 1000) {
    badges.push({ id: 'titan', icon: '💪', label: 'Titan' });
  }
  // Centurion — 100+ contributions
  else if (totalContribs >= 100) {
    badges.push({ id: 'centurion', icon: '🗡', label: 'Centurion' });
  }

  // Crown — is king of any repo
  if (repos.some(r => r.king_login?.toLowerCase() === login.toLowerCase())) {
    badges.push({ id: 'crown', icon: '👑', label: 'Crown' });
  }

  // Realm Founder — owns a repo
  if (repos.some(r => r.owner_login?.toLowerCase() === login.toLowerCase())) {
    badges.push({ id: 'founder', icon: '🏰', label: 'Realm Founder' });
  }

  // On Fire — contributed to repo pushed in last 3 days
  if (repos.some(r => r.pushed_at && (now - new Date(r.pushed_at).getTime()) < threeDays)) {
    badges.push({ id: 'on_fire', icon: '🔥', label: 'On Fire' });
  }

  // Polyglot — 3+ languages
  if (languages.length >= 3) {
    badges.push({ id: 'polyglot', icon: '🌍', label: 'Polyglot' });
  }

  // Star Bearer — 1K+ total stars
  if (totalStars >= 1000) {
    badges.push({ id: 'star_bearer', icon: '⭐', label: 'Star Bearer' });
  }

  // Team Player — 5+ repos
  if (repos.length >= 5) {
    badges.push({ id: 'team_player', icon: '🤝', label: 'Team Player' });
  }
  // Lone Wolf — exactly 1 repo
  else if (repos.length === 1) {
    badges.push({ id: 'lone_wolf', icon: '🐺', label: 'Lone Wolf' });
  }

  return badges;
}

// ─── Handler ─────────────────────────────────────────────────────
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const username = req.query.username as string;
  if (!username || !/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/.test(username)) {
    return res.status(400).json({ error: 'Invalid username' });
  }

  try {
    const supabase = createServiceClient();

    // 1. Find all repos this user contributes to
    const { data: contribs, error: contribErr } = await supabase
      .from('contributors')
      .select('repo_id, login, avatar_url, contributions, last_commit_message')
      .ilike('login', username);

    if (contribErr) {
      console.error(`[citizen] Contributor query failed for ${username}:`, contribErr.message);
      return res.status(500).json({ error: 'Query failed' });
    }

    if (!contribs || contribs.length === 0) {
      return res.status(404).json({ error: 'Citizen not found' });
    }

    // 2. Fetch repo details for all repos this citizen contributes to
    const repoIds = contribs.map(c => c.repo_id);
    const { data: repos, error: repoErr } = await supabase
      .from('repos')
      .select('id, full_name, name, language, stargazers, forks, pushed_at, owner_login, king_login, king_contributions, description')
      .in('id', repoIds);

    if (repoErr || !repos) {
      console.error(`[citizen] Repo query failed:`, repoErr?.message);
      return res.status(500).json({ error: 'Query failed' });
    }

    // 3. Build repo list with this citizen's contribution count
    const contribByRepo = new Map<number, number>();
    for (const c of contribs) {
      contribByRepo.set(c.repo_id, c.contributions);
    }

    const repoList: RepoRow[] = repos.map(r => ({
      full_name: r.full_name,
      language: r.language,
      stargazers: r.stargazers,
      forks: r.forks,
      pushed_at: r.pushed_at,
      owner_login: r.owner_login,
      king_login: r.king_login,
      contributions: contribByRepo.get(r.id) || 0,
    }));

    // Sort by contributions desc
    repoList.sort((a, b) => b.contributions - a.contributions);

    // 4. Compute aggregates
    const login = contribs[0].login; // use exact casing from DB
    const avatar_url = contribs[0].avatar_url;
    // Use the last_commit_message from the highest-contribution row (already sorted by contributions desc via repoList)
    const last_commit_message = contribs.find(c => c.last_commit_message)?.last_commit_message ?? null;
    const totalContributions = repoList.reduce((s, r) => s + r.contributions, 0);
    const totalStars = repoList.reduce((s, r) => s + r.stargazers, 0);
    const languages = [...new Set(repoList.map(r => r.language).filter(Boolean))] as string[];
    const primaryLanguage = languages[0] || 'Unknown';

    // King title is granted in-game by the CityScene (one per language kingdom).
    // The API uses contribution-based tiers only — avoids inflating royal titles.
    const isKing = false;

    // 5. Compute RPG elements
    const title = getTitle(totalContributions, isKing);
    const badges = computeBadges(login, totalContributions, repoList, languages);
    const stats = {
      power: statScale(totalContributions, 10000),
      reach: statScale(totalStars, 50000),
      versatility: statScale(repoList.length * languages.length, 50),
    };

    // XP & Level
    const xp = totalContributions + totalStars * 5 + repoList.length * 10;
    const level = Math.max(1, Math.floor(Math.log2(xp + 1)));

    // Battle record — find battles where this user was a hero
    const { data: heroBattles } = await supabase
      .from('kingdom_battles')
      .select('id, kingdom_a, kingdom_b, metric, winner, hero, status, started_at, ends_at')
      .eq('status', 'resolved')
      .ilike('hero', login);

    // Also find battles where user appeared as round hero
    const { data: allResolvedBattles } = await supabase
      .from('kingdom_battles')
      .select('id, kingdom_a, kingdom_b, metric, winner, hero, status, rounds, started_at, ends_at')
      .eq('status', 'resolved');

    const battleRecord = {
      hero_of: (heroBattles ?? []).map(b => ({
        id: b.id,
        kingdom_a: b.kingdom_a,
        kingdom_b: b.kingdom_b,
        metric: b.metric,
        winner: b.winner,
        ended: b.ends_at,
      })),
      participated_in: (allResolvedBattles ?? []).filter(b => {
        const rounds = (b.rounds as { a_hero?: string; b_hero?: string }[]) ?? [];
        return rounds.some(r =>
          r.a_hero?.toLowerCase() === login.toLowerCase() ||
          r.b_hero?.toLowerCase() === login.toLowerCase()
        );
      }).length,
    };

    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
    res.json({
      login,
      avatar_url,
      last_commit_message,
      totalContributions,
      level,
      xp,
      title: { icon: title.icon, name: title.name, kingdom: primaryLanguage },
      stats,
      badges,
      languages,
      battleRecord,
      repos: repoList.map(r => ({
        full_name: r.full_name,
        language: r.language,
        stargazers: r.stargazers,
        pushed_at: r.pushed_at,
        is_king: r.king_login?.toLowerCase() === login.toLowerCase(),
        contributions: r.contributions,
      })),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[citizen] Error for ${username}:`, msg);
    res.status(500).json({ error: 'Internal error' });
  }
}

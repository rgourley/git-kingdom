import type { KingdomRanking, KingdomBattle } from './types';

const METRIC_DISPLAY: Record<string, string> = {
  military_strength: 'Military Strength',
  wealth: 'Wealth',
  population: 'Population',
  expansion: 'Expansion',
  kingdom_power: 'Kingdom Power',
};

export async function fetchLeaderboardData(): Promise<{ rankings: KingdomRanking[]; battles: KingdomBattle[] }> {
  try {
    const res = await fetch('/api/rankings');
    if (!res.ok) return { rankings: [], battles: [] };
    return await res.json();
  } catch {
    return { rankings: [], battles: [] };
  }
}

export function renderLeaderboardHTML(
  rankings: KingdomRanking[],
  battles: KingdomBattle[],
  activeTab: 'rankings' | 'battles' = 'rankings',
): string {
  const tabs = `
    <div style="display:flex;gap:8px;margin-bottom:8px;">
      <button class="leaderboard-tab" data-tab="rankings"
        style="font-family:'Press Start 2P';font-size:8px;padding:4px 8px;background:${activeTab === 'rankings' ? '#c8b89a' : '#333'};color:${activeTab === 'rankings' ? '#1a1a2e' : '#888'};border:1px solid #555;cursor:pointer;">
        Rankings
      </button>
      <button class="leaderboard-tab" data-tab="battles"
        style="font-family:'Press Start 2P';font-size:8px;padding:4px 8px;background:${activeTab === 'battles' ? '#c8b89a' : '#333'};color:${activeTab === 'battles' ? '#1a1a2e' : '#888'};border:1px solid #555;cursor:pointer;">
        Battles
      </button>
    </div>
  `;

  if (activeTab === 'rankings') {
    const powerRankings = rankings
      .filter(r => r.metric === 'kingdom_power')
      .sort((a, b) => a.rank - b.rank);

    const rows = powerRankings.map(r => {
      const change = r.previous_rank - r.rank;
      const arrow = change > 0
        ? `<span style="color:#4ade80;">&#9650;${change}</span>`
        : change < 0
        ? `<span style="color:#f87171;">&#9660;${Math.abs(change)}</span>`
        : `<span style="color:#888;">&mdash;</span>`;
      return `
        <div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid rgba(200,184,154,0.1);">
          <span style="color:#c8b89a;">#${r.rank} ${r.language}</span>
          <span>${Math.round(r.value)} ${arrow}</span>
        </div>
      `;
    }).join('');

    return tabs + `<div style="color:#a0a0a0;font-size:10px;">${rows || 'No rankings yet'}</div>`;
  }

  // Battles tab
  const activeBattles = battles.filter(b => b.status === 'active');
  const recentResolved = battles.filter(b => b.status === 'resolved').slice(0, 3);

  const battleRows = activeBattles.map(b => {
    const aTotal = b.rounds.reduce((s, r) => s + r.a_delta, 0);
    const bTotal = b.rounds.reduce((s, r) => s + r.b_delta, 0);
    const total = Math.max(1, aTotal + bTotal);
    const aPct = Math.round((aTotal / total) * 100);
    return `
      <div style="margin-bottom:8px;padding:4px;background:rgba(0,0,0,0.2);border-radius:4px;">
        <div style="font-size:9px;color:#c8b89a;margin-bottom:4px;">
          &#9876;&#65039; ${b.kingdom_a} vs ${b.kingdom_b} &mdash; ${METRIC_DISPLAY[b.metric] ?? b.metric}
        </div>
        <div style="display:flex;height:8px;border-radius:2px;overflow:hidden;background:#333;">
          <div style="width:${aPct}%;background:#4ade80;"></div>
          <div style="width:${100 - aPct}%;background:#f87171;"></div>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:8px;color:#888;margin-top:2px;">
          <span>${b.kingdom_a}: +${aTotal}</span>
          <span>Day ${b.rounds.length}</span>
          <span>${b.kingdom_b}: +${bTotal}</span>
        </div>
      </div>
    `;
  }).join('');

  const resolvedRows = recentResolved.map(b => `
    <div style="font-size:9px;color:#888;padding:2px 0;">
      &#127942; ${b.winner} defeated ${b.winner === b.kingdom_a ? b.kingdom_b : b.kingdom_a} (${METRIC_DISPLAY[b.metric] ?? b.metric})
    </div>
  `).join('');

  return tabs + `
    <div style="color:#a0a0a0;font-size:10px;">
      ${battleRows || '<div style="color:#888;">No active battles</div>'}
      ${resolvedRows ? `<div style="margin-top:8px;border-top:1px solid rgba(200,184,154,0.1);padding-top:4px;"><div style="font-size:8px;color:#666;margin-bottom:4px;">Recent Results</div>${resolvedRows}</div>` : ''}
    </div>
  `;
}

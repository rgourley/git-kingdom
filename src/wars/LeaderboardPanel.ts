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
        <div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid rgba(200,184,154,0.1);cursor:pointer;" onclick="window.__navigateToKingdom && window.__navigateToKingdom('${r.language}')">
          <span style="color:#c8b89a;">#${r.rank} ${r.language}</span>
          <span>${Math.round(r.value)} ${arrow}</span>
        </div>
      `;
    }).join('');

    return `<div style="color:#e8d5a3;font-size:10px;">${rows || 'No rankings yet'}</div>`;
  }

  // Battles tab
  const activeBattles = battles.filter(b => b.status === 'active');
  const recentResolved = battles.filter(b => b.status === 'resolved').slice(0, 3);

  const battleRows = activeBattles.map((b, idx) => {
    const aTotal = b.rounds.reduce((s, r) => s + r.a_delta, 0);
    const bTotal = b.rounds.reduce((s, r) => s + r.b_delta, 0);
    const total = Math.max(1, aTotal + bTotal);
    const aPct = Math.round((aTotal / total) * 100);

    return `
      <div class="battle-row" data-battle="${idx}" style="margin-bottom:8px;padding:4px;background:rgba(0,0,0,0.2);border-radius:4px;cursor:pointer;" onclick="window.__showBattleDetail && window.__showBattleDetail(${idx})">
        <div style="font-size:9px;color:#c8b89a;margin-bottom:4px;">
          &#9876;&#65039; ${b.kingdom_a} vs ${b.kingdom_b} &mdash; ${METRIC_DISPLAY[b.metric] ?? b.metric}
        </div>
        <div style="display:flex;height:8px;border-radius:2px;overflow:hidden;background:#333;">
          <div style="width:${aPct}%;background:#4ade80;"></div>
          <div style="width:${100 - aPct}%;background:#f87171;"></div>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:8px;color:#e8d5a3;margin-top:2px;">
          <span>${b.kingdom_a}: +${aTotal}</span>
          <span style="color:#c8b89a;">Day ${b.rounds.length}</span>
          <span>${b.kingdom_b}: +${bTotal}</span>
        </div>
        <div style="font-size:7px;color:#888;text-align:center;margin-top:2px;">▼ click for details</div>
      </div>
    `;
  }).join('');

  const resolvedRows = recentResolved.map((_b, idx) => {
    const b = _b;
    const loser = b.winner === b.kingdom_a ? b.kingdom_b : b.kingdom_a;
    return `
      <div style="font-size:9px;color:#c8b89a;padding:3px 0;cursor:pointer;" onclick="window.__showBattleDetail && window.__showBattleDetail(${activeBattles.length + idx})">
        &#127942; ${b.winner} defeated ${loser} (${METRIC_DISPLAY[b.metric] ?? b.metric})
      </div>
    `;
  }).join('');

  return `
    <div style="color:#e8d5a3;font-size:10px;">
      ${battleRows || '<div style="color:#c8b89a;">No active battles</div>'}
      ${resolvedRows ? `<div style="margin-top:8px;border-top:1px solid rgba(200,184,154,0.2);padding-top:4px;"><div style="font-size:8px;color:#c8b89a;margin-bottom:4px;">Recent Results</div>${resolvedRows}</div>` : ''}
    </div>
  `;
}

export function registerBattleData(battles: KingdomBattle[]): void {
  (window as any).__showBattleDetail = (idx: number) => {
    const b = battles[idx];
    if (!b) return;
    showBattleDetailModal(b);
  };
}

function showBattleDetailModal(b: KingdomBattle): void {
  const panel = document.getElementById('battle-detail-panel');
  const content = document.getElementById('battle-detail-content');
  if (!panel || !content) return;

  const aTotal = b.rounds.reduce((s, r) => s + r.a_delta, 0);
  const bTotal = b.rounds.reduce((s, r) => s + r.b_delta, 0);
  const total = Math.max(1, aTotal + bTotal);
  const aPct = Math.round((aTotal / total) * 100);
  const metricName = METRIC_DISPLAY[b.metric] ?? b.metric;
  const isActive = b.status === 'active';
  const daysLeft = Math.max(0, Math.ceil((new Date(b.ends_at).getTime() - Date.now()) / (24 * 60 * 60 * 1000)));

  const roundRows = b.rounds.map(r => {
    const rTotal = Math.max(1, r.a_delta + r.b_delta);
    const rPct = Math.round((r.a_delta / rTotal) * 100);
    return `
      <div style="display:flex;align-items:center;gap:6px;margin:6px 0;">
        <span style="color:#c8b89a;min-width:40px;font-size:10px;white-space:nowrap;">Day ${r.day}</span>
        <div style="flex:1;display:flex;height:10px;border-radius:3px;overflow:hidden;background:#222;min-width:60px;">
          <div style="width:${rPct}%;background:#4ade80;"></div>
          <div style="width:${100 - rPct}%;background:#f87171;"></div>
        </div>
        <span style="color:#e8d5a3;min-width:70px;text-align:right;font-size:9px;white-space:nowrap;">+${r.a_delta} / +${r.b_delta}</span>
      </div>
    `;
  }).join('');

  const statusLine = isActive
    ? `<span style="color:#4ade80;">⚔️ Active</span> — ${daysLeft > 0 ? daysLeft + ' days remaining' : 'Ending soon!'}`
    : `<span style="color:#c8b89a;">🏆 ${b.winner} won!</span>`;

  content.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
      <h2 style="font-size:13px;color:#c8b89a;margin:0;">⚔️ Battle: ${b.kingdom_a} vs ${b.kingdom_b}</h2>
      <span style="color:#c8b89a;cursor:pointer;font-size:16px;font-weight:bold;padding:4px 8px;background:rgba(0,0,0,0.3);border-radius:4px;" onclick="document.getElementById('battle-detail-panel').style.display='none'">✕</span>
    </div>
    <div style="font-size:10px;color:#e8d5a3;margin-bottom:8px;">
      Contested: <strong>${metricName}</strong>
    </div>
    <div style="margin-bottom:12px;">
      <div style="display:flex;justify-content:space-between;font-size:11px;color:#e8d5a3;margin-bottom:4px;">
        <span>${b.kingdom_a}: +${aTotal}</span>
        <span>${b.kingdom_b}: +${bTotal}</span>
      </div>
      <div style="display:flex;height:14px;border-radius:4px;overflow:hidden;background:#222;">
        <div style="width:${aPct}%;background:#4ade80;"></div>
        <div style="width:${100 - aPct}%;background:#f87171;"></div>
      </div>
    </div>
    <div style="font-size:10px;color:#c8b89a;margin-bottom:6px;border-bottom:1px solid rgba(200,184,154,0.2);padding-bottom:4px;">
      Round-by-Round
    </div>
    ${roundRows}
    <div style="margin-top:12px;padding-top:8px;border-top:1px solid rgba(200,184,154,0.2);font-size:9px;color:#e8d5a3;">
      <div style="margin-bottom:4px;">${statusLine}</div>
      <div style="color:#888;">
        ${new Date(b.started_at).toLocaleDateString()} — ${new Date(b.ends_at).toLocaleDateString()}
      </div>
    </div>
  `;

  panel.style.display = 'block';
}

import type { WorldEvent } from './types';

const API_BASE = '/api/events';
const REPLAY_INTERVAL_MS = 4000;
const MAX_VISIBLE = 5;

export function formatEventMessage(event: WorldEvent): string {
  const p = event.payload as Record<string, unknown>;

  if (typeof p.message === 'string') return p.message;

  switch (event.event_type) {
    case 'citizen_joined':
      return `⚔ ${p.username ?? 'A recruit'} pledges allegiance with ${p.repo_count ?? 0} repos`;
    case 'repo_added':
      return `🏰 ${p.repo ?? 'A new stronghold'} claimed for the ${p.language ?? 'unknown'} kingdom`;
    case 'kingdom_rank_changed':
      return `👑 ${p.kingdom ?? 'A kingdom'} seizes rank #${p.new_rank ?? '?'} in Kingdom Power`;
    case 'battle_started':
      return `🔥 War declared! ${p.kingdom_a ?? '?'} marches against ${p.kingdom_b ?? '?'}`;
    case 'battle_round':
      return `⚔ Siege report: ${p.kingdom_a ?? '?'} vs ${p.kingdom_b ?? '?'} — Round ${p.day ?? '?'}`;
    case 'battle_resolved':
      return `🏆 Victory! ${p.winner ?? 'A kingdom'} conquers ${p.loser ?? 'their rival'}!`;
    case 'building_upgraded':
      return `🏰 ${p.repo ?? 'A fortress'} fortified to ${p.new_rank ?? 'higher rank'} (${p.stars ?? '?'}★)`;
    default:
      return 'Something happened in the realm...';
  }
}

export async function fetchRecentEvents(sinceHoursAgo = 1): Promise<WorldEvent[]> {
  const since = new Date(Date.now() - sinceHoursAgo * 60 * 60 * 1000).toISOString();
  try {
    const res = await fetch(`${API_BASE}?since=${encodeURIComponent(since)}`);
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

export class EventReplayQueue {
  private queue: WorldEvent[] = [];
  private visible: WorldEvent[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private onEvent: (event: WorldEvent, message: string) => void;

  constructor(onEvent: (event: WorldEvent, message: string) => void) {
    this.onEvent = onEvent;
  }

  load(events: WorldEvent[]) {
    this.queue = [...events];
    this.start();
  }

  private start() {
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => this.tick(), REPLAY_INTERVAL_MS);
    this.tick();
  }

  private tick() {
    const next = this.queue.shift();
    if (!next) {
      this.stop();
      return;
    }
    this.visible.push(next);
    if (this.visible.length > MAX_VISIBLE) {
      this.visible.shift();
    }
    this.onEvent(next, formatEventMessage(next));
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  getVisible(): WorldEvent[] {
    return [...this.visible];
  }
}

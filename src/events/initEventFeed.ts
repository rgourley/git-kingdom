import { fetchRecentEvents, EventReplayQueue } from './EventFeed';
import type { WorldEvent } from './types';

let activeQueue: EventReplayQueue | null = null;
let headerWired = false;

function handleEventClick(event: WorldEvent): void {
  const p = event.payload as Record<string, unknown>;

  switch (event.event_type) {
    case 'citizen_joined': {
      // Navigate to user's profile/city
      const username = p.username as string | undefined;
      if (username) window.location.href = `/${username}`;
      break;
    }
    case 'repo_added': {
      // Navigate to the repo's building in its kingdom city
      const repo = p.repo as string | undefined;
      if (repo) window.location.href = `/${repo}`;
      break;
    }
    case 'building_upgraded': {
      const repo = p.repo as string | undefined;
      if (repo) window.location.href = `/${repo}`;
      break;
    }
    case 'kingdom_rank_changed': {
      // Pan to kingdom on world map
      const kingdom = p.kingdom as string | undefined;
      if (kingdom && (window as any).__navigateToKingdom) {
        (window as any).__navigateToKingdom(kingdom);
      }
      break;
    }
    case 'battle_started':
    case 'battle_round':
    case 'battle_resolved': {
      // Open battles panel
      const panel = document.getElementById('leaderboard-panel');
      if (panel) {
        panel.style.display = 'block';
        const titleEl = panel.querySelector('#leaderboard-title') as HTMLElement | null;
        if (titleEl) titleEl.textContent = '⚔️ Kingdom Battles';
        // Trigger battles tab fetch if the handler exists
        const battlesBtn = document.getElementById('hdr-battles');
        if (battlesBtn) battlesBtn.click();
      }
      break;
    }
  }
}

export function initEventFeed(onShutdown: (callback: () => void) => void): void {
  // Stop any existing queue from a previous scene
  if (activeQueue) { activeQueue.stop(); activeQueue = null; }

  const feedEl = document.getElementById('event-feed');
  const listEl = document.getElementById('event-feed-list');
  const toggleEl = document.getElementById('event-feed-toggle');
  const headerEl = document.getElementById('event-feed-header');
  if (!feedEl || !listEl) return;

  // Clear previous event entries from prior scene
  listEl.innerHTML = '';

  feedEl.style.display = 'block';

  // Collapse toggle
  const collapsed = localStorage.getItem('event-feed-collapsed') === 'true';
  if (collapsed) {
    listEl.style.display = 'none';
    if (toggleEl) toggleEl.textContent = '▶';
  }

  if (!headerWired && headerEl) { headerWired = true; headerEl.addEventListener('click', () => {
    const isHidden = listEl.style.display === 'none';
    listEl.style.display = isHidden ? 'block' : 'none';
    if (toggleEl) toggleEl.textContent = isHidden ? '▼' : '▶';
    localStorage.setItem('event-feed-collapsed', String(!isHidden));
  }); }

  fetchRecentEvents().then(events => {
    const queue = new EventReplayQueue((event, message) => {
      const div = document.createElement('div');
      div.textContent = message;
      div.style.cssText = 'color: #e8e0d0; padding: 2px 0; opacity: 0; transition: opacity 0.5s, color 0.15s; font-size: 9px; line-height: 1.4; border-bottom: 1px solid rgba(200,184,154,0.15); margin-bottom: 2px; cursor: pointer;';
      div.addEventListener('mouseenter', () => { div.style.color = '#ffd700'; });
      div.addEventListener('mouseleave', () => { div.style.color = '#e8e0d0'; });
      div.addEventListener('click', () => handleEventClick(event));
      listEl.appendChild(div);
      requestAnimationFrame(() => { div.style.opacity = '1'; });

      // Remove old entries
      while (listEl.children.length > 5) {
        listEl.firstChild?.remove();
      }
    });
    activeQueue = queue;
    queue.load(events);

    onShutdown(() => { queue.stop(); activeQueue = null; });
  });
}

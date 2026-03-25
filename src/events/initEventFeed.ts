import { fetchRecentEvents, EventReplayQueue } from './EventFeed';

export function initEventFeed(onShutdown: (callback: () => void) => void): void {
  const feedEl = document.getElementById('event-feed');
  const listEl = document.getElementById('event-feed-list');
  const toggleEl = document.getElementById('event-feed-toggle');
  const headerEl = document.getElementById('event-feed-header');
  if (!feedEl || !listEl) return;

  feedEl.style.display = 'block';

  // Collapse toggle
  const collapsed = localStorage.getItem('event-feed-collapsed') === 'true';
  if (collapsed) {
    listEl.style.display = 'none';
    if (toggleEl) toggleEl.textContent = '▶';
  }

  headerEl?.addEventListener('click', () => {
    const isHidden = listEl.style.display === 'none';
    listEl.style.display = isHidden ? 'block' : 'none';
    if (toggleEl) toggleEl.textContent = isHidden ? '▼' : '▶';
    localStorage.setItem('event-feed-collapsed', String(!isHidden));
  });

  fetchRecentEvents().then(events => {
    const queue = new EventReplayQueue((_event, message) => {
      const div = document.createElement('div');
      div.textContent = message;
      div.style.cssText = 'color: #e8e0d0; padding: 2px 0; opacity: 0; transition: opacity 0.5s; font-size: 9px; line-height: 1.4; border-bottom: 1px solid rgba(200,184,154,0.15); margin-bottom: 2px;';
      listEl.appendChild(div);
      requestAnimationFrame(() => { div.style.opacity = '1'; });

      // Remove old entries
      while (listEl.children.length > 5) {
        listEl.firstChild?.remove();
      }
    });
    queue.load(events);

    onShutdown(() => queue.stop());
  });
}

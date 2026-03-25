import { describe, it, expect } from 'vitest';
import { formatEventMessage } from './EventFeed';

describe('formatEventMessage', () => {
  it('formats citizen_joined events', () => {
    const msg = formatEventMessage({
      id: '1', event_type: 'citizen_joined', created_at: new Date().toISOString(),
      payload: { username: 'alice', repo_count: 5 },
    });
    expect(msg).toContain('alice');
    expect(msg).toContain('joined');
  });

  it('formats battle_started events using payload message', () => {
    const msg = formatEventMessage({
      id: '2', event_type: 'battle_started', created_at: new Date().toISOString(),
      payload: { message: 'Border skirmish erupts between TypeScript and Python over Wealth!' },
    });
    expect(msg).toBe('Border skirmish erupts between TypeScript and Python over Wealth!');
  });

  it('formats building_upgraded events', () => {
    const msg = formatEventMessage({
      id: '4', event_type: 'building_upgraded', created_at: new Date().toISOString(),
      payload: { repo: 'facebook/react', new_rank: 'castle', kingdom: 'TypeScript' },
    });
    expect(msg).toContain('react');
    expect(msg).toContain('castle');
  });

  it('falls back to generic message for unknown types', () => {
    const msg = formatEventMessage({
      id: '3', event_type: 'unknown_type' as any, created_at: new Date().toISOString(),
      payload: {},
    });
    expect(typeof msg).toBe('string');
    expect(msg.length).toBeGreaterThan(0);
  });
});

import { describe, it, expect, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: { Scene: class {}, GameObjects: {}, Scale: {}, Physics: {} },
}));

import { repoFreshness } from '../scenes/CityScene';

describe('repoFreshness', () => {
  it('returns 0 for undefined', () => {
    expect(repoFreshness(undefined)).toBe(0);
  });

  it('returns 0.8 for very recent pushes (within 3 days)', () => {
    const now = new Date();
    expect(repoFreshness(now.toISOString())).toBe(0.8);

    const oneDayAgo = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);
    expect(repoFreshness(oneDayAgo.toISOString())).toBe(0.8);
  });

  it('returns 0 for old pushes (30+ days)', () => {
    const old = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    expect(repoFreshness(old.toISOString())).toBe(0);
  });

  it('returns interpolated values for mid-range (3-30 days)', () => {
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    const result = repoFreshness(tenDaysAgo.toISOString());
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThan(0.8);
  });

  it('decreases as the push gets older', () => {
    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    const twentyDaysAgo = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000);
    expect(repoFreshness(fiveDaysAgo.toISOString())).toBeGreaterThan(
      repoFreshness(twentyDaysAgo.toISOString())
    );
  });
});

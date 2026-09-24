import { describe, it, expect } from 'vitest';
import { RESERVED_PATHS } from '../constants';

describe('RESERVED_PATHS', () => {
  it('contains expected paths', () => {
    expect(RESERVED_PATHS.has('api')).toBe(true);
    expect(RESERVED_PATHS.has('assets')).toBe(true);
    expect(RESERVED_PATHS.has('admin')).toBe(true);
    expect(RESERVED_PATHS.has('editor.html')).toBe(true);
  });

  it('does not contain user-like paths', () => {
    expect(RESERVED_PATHS.has('facebook')).toBe(false);
    expect(RESERVED_PATHS.has('torvalds')).toBe(false);
  });
});

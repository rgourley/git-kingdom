import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseRoute, pushRoute } from '../router';

describe('parseRoute', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {
      location: { pathname: '/' },
      history: { pushState: vi.fn() },
    });
  });

  it('returns nulls for root path', () => {
    window.location.pathname = '/';
    expect(parseRoute()).toEqual({ username: null, repoName: null });
  });

  it('returns nulls for empty path', () => {
    window.location.pathname = '';
    expect(parseRoute()).toEqual({ username: null, repoName: null });
  });

  it('parses a single segment as username', () => {
    window.location.pathname = '/facebook';
    expect(parseRoute()).toEqual({ username: 'facebook', repoName: null });
  });

  it('parses two segments as username/repo', () => {
    window.location.pathname = '/facebook/react';
    expect(parseRoute()).toEqual({ username: 'facebook', repoName: 'react' });
  });

  it('returns nulls for reserved paths', () => {
    for (const reserved of ['assets', 'api', 'admin', 'editor.html', 'about']) {
      window.location.pathname = `/${reserved}`;
      expect(parseRoute()).toEqual({ username: null, repoName: null });
    }
  });
});

describe('pushRoute', () => {
  let pushStateSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    pushStateSpy = vi.fn();
    vi.stubGlobal('window', {
      location: { pathname: '/' },
      history: { pushState: pushStateSpy },
    });
  });

  it('pushes root path when username is null', () => {
    pushRoute(null);
    expect(pushStateSpy).toHaveBeenCalledWith({}, '', '/');
  });

  it('pushes username path', () => {
    pushRoute('facebook');
    expect(pushStateSpy).toHaveBeenCalledWith({}, '', '/facebook');
  });

  it('pushes username/repo path', () => {
    pushRoute('facebook', 'react');
    expect(pushStateSpy).toHaveBeenCalledWith({}, '', '/facebook/react');
  });

  it('ignores null repoName', () => {
    pushRoute('facebook', null);
    expect(pushStateSpy).toHaveBeenCalledWith({}, '', '/facebook');
  });
});

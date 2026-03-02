/**
 * GET /api/auth/me
 * Returns the currently signed-in user from the session cookie.
 * Returns 401 if not signed in.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSession } from '../lib/session';

export default function handler(req: VercelRequest, res: VercelResponse) {
  const session = getSession(req);

  if (!session) {
    return res.status(401).json({ error: 'Not signed in' });
  }

  // Return user info (never expose the token to the client)
  res.json({
    login: session.login,
    github_id: session.github_id,
    avatar_url: session.avatar_url,
  });
}

/**
 * POST /api/auth/logout
 * Clears the session cookie and redirects to home.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { clearSession } from '../lib/session';

export default function handler(req: VercelRequest, res: VercelResponse) {
  clearSession(res);
  res.redirect(302, '/');
}

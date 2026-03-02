/**
 * GET /api/auth/github
 * Redirects the user to GitHub's OAuth authorization page.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { generateState } from '../lib/session';

export default function handler(req: VercelRequest, res: VercelResponse) {
  const clientId = process.env.GITHUB_CLIENT_ID;
  if (!clientId) {
    return res.status(500).json({ error: 'GITHUB_CLIENT_ID not configured' });
  }

  // Determine the callback URL based on the request origin
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000';
  const redirectUri = `${proto}://${host}/api/auth/callback`;

  // Generate CSRF state and store in a short-lived cookie
  const state = generateState();
  res.setHeader('Set-Cookie', [
    `gk_oauth_state=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`,
  ]);

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: 'read:user',
    state,
  });

  res.redirect(302, `https://github.com/login/oauth/authorize?${params}`);
}

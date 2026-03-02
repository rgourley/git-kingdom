/**
 * GET /api/auth/callback
 * GitHub redirects here after the user approves the OAuth request.
 * Exchanges the code for a token, fetches user info, sets session cookie.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { setSession } from '../lib/session';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { code, state } = req.query;

  if (!code || typeof code !== 'string') {
    return res.status(400).json({ error: 'Missing authorization code' });
  }

  // Verify CSRF state
  const expectedState = req.cookies?.gk_oauth_state;
  if (!expectedState || state !== expectedState) {
    return res.status(403).json({ error: 'Invalid OAuth state (CSRF check failed)' });
  }

  // Clear the state cookie
  res.setHeader('Set-Cookie', [
    'gk_oauth_state=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0',
  ]);

  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return res.status(500).json({ error: 'OAuth credentials not configured' });
  }

  try {
    // Exchange code for access token
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
      }),
    });

    const tokenData = await tokenRes.json();
    if (tokenData.error || !tokenData.access_token) {
      console.error('Token exchange failed:', tokenData);
      return res.status(400).json({ error: tokenData.error_description || 'Token exchange failed' });
    }

    const accessToken = tokenData.access_token as string;

    // Fetch user info from GitHub
    const userRes = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github.v3+json',
      },
    });

    if (!userRes.ok) {
      return res.status(502).json({ error: 'Failed to fetch GitHub user info' });
    }

    const user = await userRes.json();

    // Set session cookie
    setSession(res, {
      login: user.login,
      github_id: user.id,
      avatar_url: user.avatar_url,
      token: accessToken,
    });

    // Redirect to the user's kingdom page
    res.redirect(302, `/${user.login}`);
  } catch (err: any) {
    console.error('OAuth callback error:', err);
    res.status(500).json({ error: 'Internal error during authentication' });
  }
}

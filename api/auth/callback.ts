/**
 * GET /api/auth/callback
 * Supabase Auth redirects here after GitHub approval.
 * Exchanges the code for a session, upserts user into our users table.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createServerClient, createServiceClient } from '../lib/supabase';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const code = req.query.code as string;
  if (!code) {
    return res.status(400).json({ error: 'Missing authorization code' });
  }

  const supabase = createServerClient(req, res);
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.session) {
    console.error('[/api/auth/callback] Session exchange failed:', error?.message);
    return res.status(400).json({ error: error?.message || 'Session exchange failed' });
  }

  // Upsert user into our users table
  const meta = data.session.user.user_metadata;
  const login = meta.user_name || meta.preferred_username || '';
  const githubId = meta.provider_id || meta.sub;

  try {
    const service = createServiceClient();
    await service.from('users').upsert({
      id: data.session.user.id,
      github_id: typeof githubId === 'string' ? parseInt(githubId, 10) : githubId,
      login,
      avatar_url: meta.avatar_url,
    }, { onConflict: 'id' });

    // Check if this is a first-time user (no repos yet)
    const { count } = await service.from('user_repos')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', data.session.user.id);

    if (!count || count === 0) {
      // First login — set cookie so frontend auto-triggers join
      // MUST use appendHeader (not setHeader) to avoid overwriting Supabase's session cookies
      res.appendHeader('Set-Cookie', 'gk_needs_join=1; Path=/; Max-Age=300; SameSite=Lax');
    }
  } catch (err: any) {
    console.error('[/api/auth/callback] User upsert failed:', err?.message);
    // Non-fatal — user can still use the app
  }

  // Redirect to /<username> so the app skips the title screen and goes straight to the map.
  // On first login, the gk_needs_join cookie makes index.html open the profile panel, which claims the repos.
  const redirectPath = login ? `/${encodeURIComponent(login)}` : '/';
  res.redirect(302, redirectPath);
}

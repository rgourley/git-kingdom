/**
 * Cloudflare Turnstile server-side verification.
 * Free CAPTCHA alternative — invisible or managed widget.
 *
 * Env vars: TURNSTILE_SECRET_KEY
 * Client-side site key is public and embedded in HTML.
 */

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

interface TurnstileResult {
  success: boolean;
  error?: string;
}

export async function verifyTurnstile(
  token: string,
  ip?: string,
): Promise<TurnstileResult> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    // If not configured, skip verification (dev mode)
    console.warn('[turnstile] TURNSTILE_SECRET_KEY not set — skipping verification');
    return { success: true };
  }

  try {
    const body = new URLSearchParams({ secret, response: token });
    if (ip) body.append('remoteip', ip);

    const res = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    const data = await res.json();
    if (data.success) return { success: true };

    return {
      success: false,
      error: (data['error-codes'] || []).join(', ') || 'Verification failed',
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[turnstile] Verification error:', msg);
    return { success: false, error: 'Verification service unavailable' };
  }
}

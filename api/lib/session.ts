/**
 * Simple session management via signed cookies.
 * Uses HMAC-SHA256 to sign/verify session data stored in a cookie.
 */
import { createHmac, randomBytes } from 'crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const SESSION_COOKIE = 'gk_session';
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret-change-me';

export interface Session {
  /** GitHub username */
  login: string;
  /** GitHub user ID */
  github_id: number;
  /** GitHub avatar URL */
  avatar_url: string;
  /** GitHub OAuth access token (for API calls) */
  token: string;
}

function sign(data: string): string {
  const hmac = createHmac('sha256', SESSION_SECRET);
  hmac.update(data);
  return hmac.digest('hex');
}

function encode(session: Session): string {
  const json = JSON.stringify(session);
  const b64 = Buffer.from(json).toString('base64url');
  const sig = sign(b64);
  return `${b64}.${sig}`;
}

function decode(cookie: string): Session | null {
  try {
    const [b64, sig] = cookie.split('.');
    if (!b64 || !sig) return null;
    if (sign(b64) !== sig) return null; // tampered
    const json = Buffer.from(b64, 'base64url').toString('utf-8');
    return JSON.parse(json) as Session;
  } catch {
    return null;
  }
}

/** Read the session from the request cookie. Returns null if not signed in. */
export function getSession(req: VercelRequest): Session | null {
  const raw = req.cookies?.[SESSION_COOKIE];
  if (!raw) return null;
  return decode(raw);
}

/** Set the session cookie on the response. */
export function setSession(res: VercelResponse, session: Session) {
  const value = encode(session);
  const isProduction = process.env.VERCEL_ENV === 'production';
  res.setHeader('Set-Cookie', [
    `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}${isProduction ? '; Secure' : ''}`,
  ]);
}

/** Clear the session cookie. */
export function clearSession(res: VercelResponse) {
  res.setHeader('Set-Cookie', [
    `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
  ]);
}

/** Generate a random state nonce for CSRF protection. */
export function generateState(): string {
  return randomBytes(16).toString('hex');
}

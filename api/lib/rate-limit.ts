/**
 * Distributed rate limiter using @upstash/ratelimit.
 * Uses sliding window algorithm implemented via Lua scripts — no race conditions.
 */
import { Ratelimit } from '@upstash/ratelimit';
import { getRedis } from './redis';

/** Per-minute limiter: 5 requests per 60 seconds */
let minuteLimiter: Ratelimit | null = null;
function getMinuteLimiter(): Ratelimit {
  if (!minuteLimiter) {
    minuteLimiter = new Ratelimit({
      redis: getRedis(),
      limiter: Ratelimit.slidingWindow(5, '60 s'),
      prefix: 'rl:add:min',
    });
  }
  return minuteLimiter;
}

/** Daily limiter: 20 requests per 24 hours */
let dailyLimiter: Ratelimit | null = null;
function getDailyLimiter(): Ratelimit {
  if (!dailyLimiter) {
    dailyLimiter = new Ratelimit({
      redis: getRedis(),
      limiter: Ratelimit.slidingWindow(20, '86400 s'),
      prefix: 'rl:add:day',
    });
  }
  return dailyLimiter;
}

/** Join limiter: 3 joins per hour for each GitHub login. One join uses about 7 GitHub calls per repo. */
let joinLimiter: Ratelimit | null = null;
function getJoinLimiter(): Ratelimit {
  if (!joinLimiter) {
    joinLimiter = new Ratelimit({
      redis: getRedis(),
      limiter: Ratelimit.slidingWindow(3, '3600 s'),
      prefix: 'rl:join',
    });
  }
  return joinLimiter;
}

export interface RateLimitResult {
  limited: boolean;
  remaining: number;
  resetInMs: number;
}

/** Check per-minute rate limit for an IP. */
export async function checkMinuteLimit(ip: string): Promise<RateLimitResult> {
  const { success, remaining, reset } = await getMinuteLimiter().limit(ip);
  return { limited: !success, remaining, resetInMs: reset - Date.now() };
}

/** Check daily rate limit for an IP. */
export async function checkDailyLimit(ip: string): Promise<RateLimitResult> {
  const { success, remaining, reset } = await getDailyLimiter().limit(ip);
  return { limited: !success, remaining, resetInMs: reset - Date.now() };
}

/** Check the join (refresh repos) rate limit for a GitHub login. */
export async function checkJoinLimit(login: string): Promise<RateLimitResult> {
  const { success, remaining, reset } = await getJoinLimiter().limit(login.toLowerCase());
  return { limited: !success, remaining, resetInMs: reset - Date.now() };
}

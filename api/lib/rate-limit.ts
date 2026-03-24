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

/**
 * Upstash Redis client for distributed rate limiting and state.
 * Uses REST-based Redis — no persistent connections needed in serverless.
 */
import { Redis } from '@upstash/redis';

let redis: Redis | null = null;

export function getRedis(): Redis {
  if (!redis) {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) {
      throw new Error('UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN must be set');
    }
    redis = new Redis({ url, token });
  }
  return redis;
}

/**
 * Round-robin GitHub token pool.
 *
 * Reads GITHUB_TOKEN (required) and GITHUB_TOKEN_2, GITHUB_TOKEN_3, etc.
 * Rotates across tokens on each call within a warm serverless instance.
 * Note: counter resets on cold starts, so rotation is best-effort, not guaranteed even.
 */

let tokens: string[] = [];
let index = 0;

function loadTokens(): string[] {
  if (tokens.length > 0) return tokens;

  const primary = process.env.GITHUB_TOKEN;
  if (!primary) throw new Error('GITHUB_TOKEN is required');

  tokens = [primary];

  // Load additional tokens: GITHUB_TOKEN_2, GITHUB_TOKEN_3, ...
  for (let i = 2; i <= 10; i++) {
    const t = process.env[`GITHUB_TOKEN_${i}`];
    if (t) tokens.push(t);
    else break;
  }

  return tokens;
}

/** Get the next token in round-robin order. */
export function getNextToken(): string {
  const pool = loadTokens();
  const token = pool[index % pool.length];
  index++;
  return token;
}

/** Get all tokens (for quota checks). */
export function getAllTokens(): string[] {
  return loadTokens();
}

/** Get the number of available tokens. */
export function getTokenCount(): number {
  return loadTokens().length;
}

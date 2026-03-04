/**
 * Export Supabase data → public/data/default-world.json
 *
 * Usage:
 *   SUPABASE_URL=xxx SUPABASE_SERVICE_ROLE_KEY=xxx npx tsx scripts/export-world.ts
 *
 * This generates the static JSON file that the client uses as a fallback
 * when /api/world isn't available (local dev, offline, etc.).
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL) { console.error('Missing SUPABASE_URL'); process.exit(1); }
if (!SUPABASE_KEY) { console.error('Missing SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function exportWorld() {
  console.log('📦 Exporting world data from Supabase...');

  const { data: repos, error } = await supabase
    .from('repos')
    .select('*, contributors(*)')
    .gte('stargazers', 1)  // Only repos with at least 1 star
    .order('stargazers', { ascending: false });

  if (error) {
    console.error('Supabase error:', error.message);
    process.exit(1);
  }

  if (!repos || repos.length === 0) {
    console.error('No repos found in Supabase!');
    process.exit(1);
  }

  // Map to KingdomMetrics[] format (same as /api/world)
  const metrics = repos.map(r => ({
    repo: {
      full_name: r.full_name,
      name: r.name,
      description: r.description,
      stargazers_count: r.stargazers,
      forks_count: r.forks,
      open_issues_count: r.open_issues,
      language: r.language,
      created_at: r.created_at,
      pushed_at: r.pushed_at,
      size: r.size_kb,
      default_branch: r.default_branch || 'main',
      has_wiki: r.has_wiki || false,
      license: r.license_spdx ? { spdx_id: r.license_spdx } : null,
      topics: r.topics || [],
    },
    contributors: (r.contributors || []).map((c: any) => ({
      login: c.login,
      contributions: c.contributions,
      avatar_url: c.avatar_url,
    })),
    totalCommits: r.total_commits,
    mergedPRs: r.merged_prs,
    king: r.king_login ? {
      login: r.king_login,
      contributions: r.king_contributions,
      avatar_url: r.king_avatar,
    } : null,
  }));

  const worldData = {
    repos: metrics,
    users: [],
    updatedAt: new Date().toISOString(),
  };

  const outPath = path.resolve(process.cwd(), 'public/data/default-world.json');
  fs.writeFileSync(outPath, JSON.stringify(worldData));

  const sizeMB = (Buffer.byteLength(JSON.stringify(worldData)) / 1024 / 1024).toFixed(2);
  console.log(`✅ Exported ${metrics.length} repos → ${outPath} (${sizeMB} MB)`);
}

exportWorld().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});

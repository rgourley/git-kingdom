/**
 * Seed test data for kingdom wars: rankings, battles, and events.
 * Run: npx tsx scripts/seed-battles.ts
 * Clean: npx tsx scripts/seed-battles.ts --clean
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const SEED_TAG = 'seed-test'; // used to identify seeded data for cleanup

async function seed() {
  console.log('Seeding test data...');

  // Kingdom rankings
  const rankings = [
    { language: 'TypeScript', metric: 'kingdom_power', value: 85.2, rank: 1, previous_rank: 2 },
    { language: 'Python', metric: 'kingdom_power', value: 78.1, rank: 2, previous_rank: 1 },
    { language: 'Rust', metric: 'kingdom_power', value: 62.5, rank: 3, previous_rank: 4 },
    { language: 'Go', metric: 'kingdom_power', value: 55.0, rank: 4, previous_rank: 3 },
    { language: 'JavaScript', metric: 'kingdom_power', value: 48.3, rank: 5, previous_rank: 5 },
    { language: 'TypeScript', metric: 'military_strength', value: 420, rank: 1, previous_rank: 1 },
    { language: 'Python', metric: 'military_strength', value: 380, rank: 2, previous_rank: 2 },
    { language: 'Rust', metric: 'military_strength', value: 290, rank: 3, previous_rank: 3 },
    { language: 'Go', metric: 'military_strength', value: 210, rank: 4, previous_rank: 4 },
    { language: 'JavaScript', metric: 'military_strength', value: 150, rank: 5, previous_rank: 5 },
    { language: 'TypeScript', metric: 'wealth', value: 15200, rank: 1, previous_rank: 1 },
    { language: 'Python', metric: 'wealth', value: 12800, rank: 2, previous_rank: 2 },
    { language: 'JavaScript', metric: 'wealth', value: 9500, rank: 3, previous_rank: 4 },
    { language: 'Rust', metric: 'wealth', value: 8100, rank: 4, previous_rank: 3 },
    { language: 'Go', metric: 'wealth', value: 5200, rank: 5, previous_rank: 5 },
    { language: 'Python', metric: 'population', value: 45, rank: 1, previous_rank: 1 },
    { language: 'TypeScript', metric: 'population', value: 38, rank: 2, previous_rank: 2 },
    { language: 'JavaScript', metric: 'population', value: 28, rank: 3, previous_rank: 3 },
    { language: 'Go', metric: 'population', value: 15, rank: 4, previous_rank: 5 },
    { language: 'Rust', metric: 'population', value: 12, rank: 5, previous_rank: 4 },
    { language: 'TypeScript', metric: 'expansion', value: 8, rank: 1, previous_rank: 1 },
    { language: 'Python', metric: 'expansion', value: 6, rank: 2, previous_rank: 2 },
    { language: 'Rust', metric: 'expansion', value: 4, rank: 3, previous_rank: 4 },
    { language: 'JavaScript', metric: 'expansion', value: 3, rank: 4, previous_rank: 3 },
    { language: 'Go', metric: 'expansion', value: 2, rank: 5, previous_rank: 5 },
  ].map(r => ({ ...r, updated_at: new Date().toISOString() }));

  const { error: rankErr } = await supabase.from('kingdom_rankings').upsert(rankings, { onConflict: 'language,metric' });
  if (rankErr) console.error('Rankings error:', rankErr.message);
  else console.log(`  ✓ ${rankings.length} rankings upserted`);

  // Active battle: TypeScript vs Python over Military Strength
  const battleEnds = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
  const { error: battleErr } = await supabase.from('kingdom_battles').insert({
    kingdom_a: 'TypeScript',
    kingdom_b: 'Python',
    metric: 'military_strength',
    started_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    ends_at: battleEnds,
    status: 'active',
    rounds: [
      { day: 1, a_delta: 42, b_delta: 38 },
      { day: 2, a_delta: 55, b_delta: 61 },
    ],
    winner: null,
  });
  if (battleErr) console.error('Battle error:', battleErr.message);
  else console.log('  ✓ Active battle: TypeScript vs Python (Military Strength)');

  // Resolved battle: Rust vs Go
  const { error: resolvedErr } = await supabase.from('kingdom_battles').insert({
    kingdom_a: 'Rust',
    kingdom_b: 'Go',
    metric: 'wealth',
    started_at: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    ends_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    status: 'resolved',
    rounds: [
      { day: 1, a_delta: 120, b_delta: 85 },
      { day: 2, a_delta: 95, b_delta: 110 },
      { day: 3, a_delta: 140, b_delta: 90 },
    ],
    winner: 'Rust',
  });
  if (resolvedErr) console.error('Resolved battle error:', resolvedErr.message);
  else console.log('  ✓ Resolved battle: Rust defeated Go (Wealth)');

  // World events
  const now = Date.now();
  const events = [
    { event_type: 'kingdom_rank_changed', payload: { kingdom: 'TypeScript', metric: 'Kingdom Power', old_rank: 2, new_rank: 1, message: 'TypeScript rises to #1 in Kingdom Power!' }, created_at: new Date(now - 50 * 60 * 1000).toISOString() },
    { event_type: 'battle_started', payload: { kingdom_a: 'TypeScript', kingdom_b: 'Python', metric: 'military_strength', message: 'Border skirmish erupts between TypeScript and Python over Military Strength!' }, created_at: new Date(now - 45 * 60 * 1000).toISOString() },
    { event_type: 'citizen_joined', payload: { username: 'torvalds', repo_count: 3 }, created_at: new Date(now - 40 * 60 * 1000).toISOString() },
    { event_type: 'repo_added', payload: { repo: 'vercel/next.js', language: 'TypeScript', stars: 128000 }, created_at: new Date(now - 35 * 60 * 1000).toISOString() },
    { event_type: 'battle_round', payload: { kingdom_a: 'TypeScript', kingdom_b: 'Python', day: 1, a_delta: 42, b_delta: 38, message: 'Day 1: TypeScript pushes forward (+42 vs +38)' }, created_at: new Date(now - 30 * 60 * 1000).toISOString() },
    { event_type: 'building_upgraded', payload: { repo: 'microsoft/vscode', old_rank: 'palace', new_rank: 'castle', stars: 5200, kingdom: 'TypeScript', message: 'microsoft/vscode upgraded to castle with 5200 stars!' }, created_at: new Date(now - 25 * 60 * 1000).toISOString() },
    { event_type: 'citizen_joined', payload: { username: 'gaearon', repo_count: 8 }, created_at: new Date(now - 20 * 60 * 1000).toISOString() },
    { event_type: 'battle_round', payload: { kingdom_a: 'TypeScript', kingdom_b: 'Python', day: 2, a_delta: 55, b_delta: 61, message: 'Day 2: Python strikes back! (+55 vs +61)' }, created_at: new Date(now - 15 * 60 * 1000).toISOString() },
    { event_type: 'battle_resolved', payload: { winner: 'Rust', loser: 'Go', metric: 'wealth', message: 'Rust triumphs over Go in the battle for Wealth!' }, created_at: new Date(now - 10 * 60 * 1000).toISOString() },
    { event_type: 'repo_added', payload: { repo: 'denoland/deno', language: 'Rust', stars: 98000 }, created_at: new Date(now - 5 * 60 * 1000).toISOString() },
  ];

  const { error: eventsErr } = await supabase.from('world_events').insert(events);
  if (eventsErr) console.error('Events error:', eventsErr.message);
  else console.log(`  ✓ ${events.length} world events inserted`);

  console.log('\nDone! Refresh the game to see the data.');
}

async function clean() {
  console.log('Cleaning test data...');

  const { error: e1 } = await supabase.from('kingdom_rankings').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  console.log(e1 ? `  ✗ Rankings: ${e1.message}` : '  ✓ Rankings cleared');

  const { error: e2 } = await supabase.from('kingdom_battles').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  console.log(e2 ? `  ✗ Battles: ${e2.message}` : '  ✓ Battles cleared');

  const { error: e3 } = await supabase.from('world_events').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  console.log(e3 ? `  ✗ Events: ${e3.message}` : '  ✓ Events cleared');

  console.log('\nDone! All test data removed.');
}

const isClean = process.argv.includes('--clean');
(isClean ? clean() : seed()).catch(console.error);

import { createServiceClient } from './supabase';

export async function writeEvent(
  event_type: string,
  payload: Record<string, unknown>
): Promise<void> {
  try {
    const supabase = createServiceClient();
    await supabase.from('world_events').insert({ event_type, payload });
  } catch (err) {
    // Fire-and-forget — never block the main operation
    console.error('[events] Failed to write event:', err);
  }
}

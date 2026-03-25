export type WorldEventType =
  | 'citizen_joined'
  | 'repo_added'
  | 'kingdom_rank_changed'
  | 'battle_started'
  | 'battle_round'
  | 'battle_resolved'
  | 'building_upgraded';

export interface WorldEvent {
  id: string;
  event_type: WorldEventType;
  payload: Record<string, unknown>;
  created_at: string;
}

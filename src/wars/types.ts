export interface KingdomRanking {
  language: string;
  metric: string;
  value: number;
  rank: number;
  previous_rank: number;
}

export type WarMetric = 'military_strength' | 'wealth' | 'population' | 'expansion' | 'kingdom_power';

export interface BattleRound {
  day: number;
  a_delta: number;
  b_delta: number;
  a_hero?: string;
  b_hero?: string;
}

export interface KingdomBattle {
  id: string;
  kingdom_a: string;
  kingdom_b: string;
  metric: WarMetric;
  started_at: string;
  ends_at: string;
  status: 'active' | 'resolved';
  rounds: BattleRound[];
  winner: string | null;
  hero?: string; // MVP of the winning side across all rounds
}

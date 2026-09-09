export const BLOCK_ARCHETYPES = [
  'ledger',
  'budget_lines',
  'event_lines',
  'ticket_rounds',
  'income_channels',
  'member_dues',
  'obligations',
  'account_balances',
  'unknown',
] as const;

export type BlockArchetype = (typeof BLOCK_ARCHETYPES)[number];

export interface Classification {
  archetype: BlockArchetype;
  /** 0..1. Below CONFIDENCE_THRESHOLD the block needs human confirmation. */
  confidence: number;
  scores: Record<BlockArchetype, number>;
}

/** Classifications at or above this are presented pre-confirmed in the review UI. */
export const CONFIDENCE_THRESHOLD = 0.5;

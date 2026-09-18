import { gateRelation, type GateRelation } from '@/lib/work/gate';

/**
 * The words around the gate count. They live in a component rather than in
 * `gate.ts` so the number can sit in its own `<bdi>`: a Hebrew sentence
 * with a Latin-ordered number in it reorders on some browsers when the two
 * are concatenated into one string (spec A11's rule, one column over).
 */
export function GateNote({ relation }: { relation: GateRelation }) {
  if (relation.kind === 'no-gate') return null;
  if (relation.kind === 'gate-day') return <>ביום השער</>;
  const tail = relation.kind === 'before' ? 'לפני השער' : 'אחרי השער';
  if (relation.days === 1) return <>{`יום אחד ${tail}`}</>;
  return <><bdi>{relation.days}</bdi>{` ימים ${tail}`}</>;
}

/** The page's own lead: how long is left before the camp is on playa. */
export function GateOpens({ gate, now }: { gate: Date | null; now?: Date }) {
  const relation = gateRelation(now ?? new Date(), gate);
  if (relation.kind === 'no-gate') return null;
  if (relation.kind === 'gate-day') return <>השער נפתח היום</>;
  // `before` here means today is before the gate: the gate is still ahead.
  const lead = relation.kind === 'before' ? 'השער נפתח בעוד ' : 'השער נפתח לפני ';
  if (relation.days === 1) return <>{`${lead}יום אחד`}</>;
  return <>{lead}<bdi>{relation.days}</bdi>{' ימים'}</>;
}

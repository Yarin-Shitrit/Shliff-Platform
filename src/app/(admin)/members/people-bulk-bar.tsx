/*
 * No `'use client'` directive, and none is needed: this module is only ever
 * imported by `people-table.tsx`, which has one, so it is already part of that
 * client graph. R7's count of new client components on this screen stays at
 * two.
 *
 * C8's ruling, in one place because this is where it will be questioned. The
 * bar offers only actions that are idempotent, that need no per-person
 * decision, and that cannot destroy anything:
 *
 *   שיוך לשנה   `addMember` upserts on (personId, seasonId). Twice is once.
 *   הנפקת חיוב  `issueFlatDueFor` returns false and writes nothing when a due
 *               already exists, and refuses anyone off the roster by name.
 *   ייצוא       a read. Season-scoped, so it is offered only with a season.
 *   מיזוג       does not merge. It opens the comparison drawer.
 *
 * The destructive slot — C8's `עוד` — is therefore **empty and not rendered**.
 * That is the finding, not an omission: bulk payment, bulk exception and bulk
 * removal from a season were each refused in `actions.ts`, and nothing
 * destructive was left to put behind it.
 */

import { useState, useTransition, type ReactElement } from 'react';
import { useRouter } from 'next/navigation';
import { BulkBar } from '@/components/ui/bulk-bar';
import { useToast } from '@/components/ui/toaster';
import { mergeHref, type RawParams } from '@/lib/members/people-views';
import { addToSeasonBulkAction, issueDuesBulkAction } from './actions';

export interface PeopleBulkBarProps {
  /** Sorted, so two leads selecting the same pair get the same merge URL. */
  selected: string[];
  /** id → display name, so a refusal can name who rather than which uuid. */
  names: Record<string, string>;
  seasonId: string | null;
  seasonName: string | null;
  params: RawParams;
  onClear: () => void;
}

export function PeopleBulkBar({
  selected, names, seasonId, seasonName, params, onClear,
}: PeopleBulkBarProps): ReactElement {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [running, setRunning] = useState(false);

  function report(message: string, tone: 'ok' | 'bad') {
    toast.show({ message, tone });
    if (tone === 'ok') {
      onClear();
      router.refresh();
    }
  }

  function run(work: () => Promise<void>) {
    setRunning(true);
    startTransition(async () => {
      try { await work(); } finally { setRunning(false); }
    });
  }

  const busy = pending || running;

  const actions = [
    ...(seasonId === null || seasonName === null ? [] : [
      {
        id: 'add-to-season',
        label: `שיוך ל${seasonName}`,
        icon: 'userplus' as const,
        disabled: busy,
        onSelect: () => run(async () => {
          const result = await addToSeasonBulkAction(selected, seasonId, 'member');
          if (!result.ok) report(result.error, 'bad');
          else report(`${result.added ?? 0} שויכו ל${seasonName}.`, 'ok');
        }),
      },
      {
        id: 'issue-dues',
        label: 'הנפקת חיוב',
        icon: 'receipt' as const,
        disabled: busy,
        onSelect: () => run(async () => {
          const result = await issueDuesBulkAction(selected, seasonId, names);
          if (!result.ok) { report(result.error, 'bad'); return; }
          /*
           * All three numbers, always. "Already had one" is a success a lead
           * needs to see — a silent 3-of-11 looks identical to a bug — and the
           * ones who could not be billed are named so the next step is
           * obvious rather than a hunt.
           */
          const parts = [`הונפקו ${result.issued ?? 0} חיובים`];
          if ((result.already ?? 0) > 0) parts.push(`${result.already} כבר היו מחויבים`);
          const off = result.offRoster ?? [];
          if (off.length > 0) parts.push(`לא ברשימת ${seasonName}: ${off.join(', ')}`);
          report(`${parts.join(' · ')}.`, off.length > 0 ? 'bad' : 'ok');
        }),
      },
      {
        id: 'export',
        label: 'ייצוא',
        icon: 'download' as const,
        disabled: busy,
        /*
         * A file download from a Route Handler, so it navigates rather than
         * routing — Next's client router would fetch the CSV as a payload and
         * nothing would land in the lead's downloads folder.
         */
        onSelect: () => {
          const ids = selected.join(',');
          /* eslint-disable-next-line @next/next/no-location-assign-relative-destination --
             `/members/export` is a Route Handler that answers with a CSV and a
             `content-disposition: attachment` header, not a page. The lint rule
             cannot tell those apart; `router.push()` here would hand the file to
             Next's client router, which would fetch it as an RSC payload and
             leave nothing in the lead's downloads folder. */
          window.location.assign(`/members/export?season=${seasonId}&ids=${ids}`);
        },
      },
    ]),
    {
      id: 'merge',
      label: 'מיזוג',
      icon: 'merge' as const,
      /*
       * Pairwise and irreversible. Disabled rather than hidden with the wrong
       * number selected: a control that appears and disappears teaches nothing
       * about why it is unavailable.
       *
       * It does not merge. It opens the comparison, where the preview of what
       * moves and the acknowledgement live — nothing is folded away from here.
       */
      disabled: selected.length !== 2,
      onSelect: () => {
        if (selected.length !== 2) return;
        router.push(mergeHref(params, selected[0], selected[1]));
      },
    },
  ];

  return (
    <BulkBar
      count={selected.length}
      label="פעולות על הנבחרים"
      actions={actions}
      onClear={onClear}
    />
  );
}

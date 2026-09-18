import { NextResponse } from 'next/server';
import { db } from '@/db';
import { requireAdmin } from '@/lib/auth/guard';
import { listSeasons, listRoster } from '@/lib/members/roster';
import { listDues } from '@/lib/fees/dues';
import { settlementFor } from '@/lib/fees/payments';
import { fromAgorot } from '@/lib/money';
import { roleLabel, dueKindLabel } from '@/lib/members/labels';

/** Quotes a field for CSV and neutralises spreadsheet formula injection. */
function cell(value: string): string {
  const text = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${text.replace(/"/g, '""')}"`;
}

export async function GET(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const requested = url.searchParams.get('season');
  const idsParam = url.searchParams.get('ids');
  const selected = idsParam
    ? new Set(idsParam.split(',').map((id) => id.trim()).filter(Boolean))
    : null;

  const seasons = await listSeasons(db);
  const season = seasons.find((s) => s.id === requested) ?? seasons[0];
  if (!season) {
    return NextResponse.json({ error: 'no seasons' }, { status: 404 });
  }

  const roster = (await listRoster(db, season.id))
    .filter((member) => !selected || selected.has(member.personId));
  const dues = new Map((await listDues(db, season.id)).map((d) => [d.personId, d]));

  const rows = [['שם', 'תפקיד', 'לתשלום', 'שולם', 'יתרה', 'סוג'].map(cell).join(',')];
  for (const member of roster) {
    const due = dues.get(member.personId);
    const settlement = due ? await settlementFor(db, due.dueId) : null;
    rows.push([
      cell(member.displayName),
      cell(roleLabel(member.role)),
      cell(due ? fromAgorot(due.amountAgorot) : ''),
      cell(settlement ? fromAgorot(settlement.paidAgorot) : ''),
      cell(settlement ? fromAgorot(settlement.outstandingAgorot) : ''),
      cell(due ? dueKindLabel(due.kind) : ''),
    ].join(','));
  }

  // BOM so Excel opens the Hebrew as UTF-8 rather than mojibake.
  return new NextResponse(`\uFEFF${rows.join('\r\n')}`, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition':
        `attachment; filename="shliff-roster-${season.year}${selected ? '-selection' : ''}.csv"`,
    },
  });
}

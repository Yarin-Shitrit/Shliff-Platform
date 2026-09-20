import { NextResponse } from 'next/server';
import { db } from '@/db';
import { requireAdmin } from '@/lib/auth/guard';
import { resolveSeason } from '@/lib/seasons/current';
import { listAcquisitions } from '@/lib/logistics/acquisitions';
import { parseAcquisitionQuery } from '@/lib/logistics/acquisitions-views';
import { csvDocument, acquisitionsCsvRows } from '@/lib/logistics/csv';

/**
 * The ייצוא button on רכש — what is on screen, under the filters the screen
 * is showing, for the season the screen is showing.
 *
 * The season is in the filename as well as in the rows. A רכש export is a
 * shopping list somebody will open next to a different year's, and two files
 * called `shliff-acquisitions.csv` in one downloads folder is how the wrong
 * one gets sent to the camp.
 */
export async function GET(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const url = new URL(request.url);
  const query = parseAcquisitionQuery(Object.fromEntries(url.searchParams));
  const { current } = await resolveSeason(db, query.season || undefined);
  if (current === null) return NextResponse.json({ error: 'no seasons' }, { status: 404 });

  const rows = await listAcquisitions(db, current.id, query);

  return new NextResponse(csvDocument(acquisitionsCsvRows(rows)), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="shliff-acquisitions-${current.year}.csv"`,
    },
  });
}

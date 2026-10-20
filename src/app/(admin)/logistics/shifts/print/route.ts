import { NextResponse } from 'next/server';
import { db } from '@/db';
import { requireAdmin } from '@/lib/auth/guard';
import { resolveSeason } from '@/lib/seasons/current';
import { buildBoard, listSchedule, listShiftTypes, windowFor } from '@/lib/logistics/shifts';
import { parseShiftsQuery } from '@/lib/logistics/shifts-views';
import { schedulePrintHtml } from '@/lib/logistics/shifts-print';

/**
 * The הדפסה button on משמרות: the season's board as a document of its own.
 *
 * A route handler, not a page, so the admin shell is not around it — a
 * printed board needs no rail, and hiding the shell from one page would be
 * a change to every page's chrome. The season is the one the screen's URL
 * names, resolved by the same function, so the sheet and the screen cannot
 * disagree about which year is being printed.
 */
export async function GET(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const url = new URL(request.url);
  const query = parseShiftsQuery(Object.fromEntries(url.searchParams));
  const { current } = await resolveSeason(db, query.season || undefined);
  if (current === null) {
    return new NextResponse('אין עדיין שנים במערכת.', {
      status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }
  const window = windowFor(current.startsOn);
  if (window === null) {
    return new NextResponse('לשנה הזו עדיין לא נקבע תאריך פתיחת השער, ולכן אין לוח להדפיס.', {
      status: 409, headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }

  const [slots, types] = await Promise.all([listSchedule(db, current.id), listShiftTypes(db)]);
  const html = schedulePrintHtml({
    seasonName: current.name,
    window,
    board: buildBoard(slots, types, window),
    printedAt: new Date(),
  });
  return new NextResponse(html, {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}

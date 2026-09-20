import { NextResponse } from 'next/server';
import { db } from '@/db';
import { requireAdmin } from '@/lib/auth/guard';
import { listWarehouse } from '@/lib/logistics/warehouse';
import { parseWarehouseQuery } from '@/lib/logistics/warehouse-views';
import { csvDocument, warehouseCsvRows } from '@/lib/logistics/csv';

/**
 * The ייצוא button on מחסן.
 *
 * It exports **what is on screen**, not the whole table: the button sits
 * beside the filters, and a file that quietly ignored them would be a
 * different list under the same name. The query string is the one the screen
 * itself is reading, parsed by the same function.
 *
 * No season. The warehouse is camp-wide (R5), and a `?season=` here is
 * ignored exactly as it is on the page.
 */
export async function GET(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const url = new URL(request.url);
  const query = parseWarehouseQuery(Object.fromEntries(url.searchParams));
  const items = await listWarehouse(db, query);

  return new NextResponse(csvDocument(warehouseCsvRows(items)), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="shliff-warehouse.csv"',
    },
  });
}

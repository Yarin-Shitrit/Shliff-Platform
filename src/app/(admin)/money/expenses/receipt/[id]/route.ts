import { db } from '@/db';
import { requireAdmin } from '@/lib/auth/guard';
import { getStorage } from '@/lib/storage';
import { receiptOf } from '@/lib/money/expenses';
import { receiptContentType } from '@/lib/money/receipt-file';

const ENTRY_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * `GET /money/expenses/receipt/<ledger entry id>`: the photo of one receipt.
 *
 * Named by the movement, never by the storage key, so the only way to a
 * picture is through the row that owns it — and the row says who may look:
 * anyone who may open the ledger sees every receipt, and someone holding only
 * the הוצאות grant sees the receipts of the expenses they typed themselves.
 *
 * Everything that is not "here is your picture" is one bare 404, so the
 * answer does not tell a stranger which ids exist.
 */
export async function GET(
  _request: Request, context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const ledger = await requireAdmin('ledger');
  const own = ledger.ok ? ledger : await requireAdmin('expenses');
  if (!own.ok) return new Response(null, { status: 401 });

  const id = (await context.params).id.toLowerCase();
  if (!ENTRY_ID.test(id)) return new Response(null, { status: 404 });

  let bytes: Buffer;
  let contentType: string | null;
  try {
    const receipt = await receiptOf(db, id);
    if (receipt === null) return new Response(null, { status: 404 });
    if (!ledger.ok && receipt.recordedBy !== own.email) return new Response(null, { status: 404 });
    contentType = receiptContentType(receipt.receiptKey);
    if (contentType === null) return new Response(null, { status: 404 });
    bytes = await getStorage().get(receipt.receiptKey);
  } catch {
    return new Response(null, { status: 404 });
  }

  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      'Content-Type': contentType,
      // Private, and short: the movement can be deleted, and a year-long
      // cache would keep showing a receipt whose expense is gone.
      'Cache-Control': 'private, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': 'inline',
    },
  });
}

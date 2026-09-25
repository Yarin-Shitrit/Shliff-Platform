import { requireAdmin } from '@/lib/auth/guard';
import { getStorage } from '@/lib/storage';
import { UNDERLAY_FILE, UNDERLAY_PREFIX, contentTypeOf, isPlanId } from '@/lib/site/underlay-limits';

/**
 * `GET /site/underlay/<planId>/<sha256>.<ext>`: the picture under a map, to
 * admins only (spec §16).
 *
 * This route's own `requireAdmin` is the only gate in front of the bytes.
 * The proxy (`src/proxy.ts`) lets every path that ends in an image extension
 * through without a session — it has to, for `public/` — so it never runs
 * here. The name must be a hash with one of three extensions and the plan a
 * lower-case uuid, so nothing outside `site-underlays/<planId>/` is ever
 * asked of storage.
 *
 * The name is the content's hash, so the answer never changes: it is cached
 * for a year, privately, and the type comes from the extension with sniffing
 * off. It is never more than 4 MB, the upload's own cap, and so under
 * Vercel's 4.5 MB response limit.
 */
export async function GET(
  _request: Request, context: { params: Promise<{ planId: string; file: string }> },
): Promise<Response> {
  const admin = await requireAdmin();
  if (!admin.ok) return new Response(null, { status: 401 });

  const { planId: asked, file } = await context.params;
  const planId = asked.toLowerCase();
  const contentType = contentTypeOf(file);
  if (!isPlanId(planId) || !UNDERLAY_FILE.test(file) || contentType === null) {
    return new Response(null, { status: 404 });
  }

  let bytes: Buffer;
  try {
    bytes = await getStorage().get(`${UNDERLAY_PREFIX}/${planId}/${file}`);
  } catch {
    return new Response(null, { status: 404 });
  }
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'private, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

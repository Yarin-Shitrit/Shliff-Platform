import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `docs/reference-data/` holds the camp's real financial workbooks — real
  // names, real debts. `src/lib/import/reference-workbooks.ts` and the local
  // storage driver's dev/test fallback (`src/lib/storage/index.ts`) read
  // files off disk, and Next's output-file tracer would otherwise pull
  // whatever it can see there into a deployed function's bundle. Keep it out
  // of every traced route, not just the ones that use it today: the key
  // `'/*'` targets all routes, per
  // node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/output.md
  // ("You can also target all routes using a global key like '/*'").
  //
  // Known consequence, accepted: this also hides the workbooks from `/data`
  // in a production build, so `/data` finds nothing there once deployed.
  // `/data`'s move to a database-only page is owned by the UI refactor (W16).
  // Shipping the camp's names and debts is the worse failure.
  outputFileTracingExcludes: {
    '/*': ['./docs/reference-data/**/*'],
  },

  /**
   * /data was the register before the redesign. It is gone: the unresolved
   * items live at /inbox, and the budget derivation it used to compute from
   * three workbooks on disk lives on /money, from the database (W23).
   *
   * The redirect lives here rather than in a stub page. A stub under
   * `(admin)` would have to call `requireAdmin()` to satisfy the static guard
   * net, which means a page existing only to redirect would also be a page
   * that can 404 — and every old bookmark would break for a signed-in
   * non-admin instead of landing somewhere that explains itself.
   *
   * `permanent: true` is a 308, not a 301: Next uses 307/308 so the request
   * method survives the redirect. Checked against
   * node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/redirects.md,
   * which also confirms `redirects` may be sync or async and that query
   * values are carried through to the destination.
   */
  async redirects() {
    return [{ source: '/data', destination: '/inbox', permanent: true }];
  },
};

export default nextConfig;

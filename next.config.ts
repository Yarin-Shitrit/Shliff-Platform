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
};

export default nextConfig;

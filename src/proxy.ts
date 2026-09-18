export { auth as proxy } from '@/lib/auth/edge-config';

export const config = {
  /**
   * Everything except Next internals, static assets, and the sign-in flow.
   * Each excluded segment is anchored with `(?:/|$)` (or `$` for the exact
   * file `favicon.ico`) so the exclusion matches a whole path segment, not a
   * prefix (M15) — `/signin-x`, `/signinfoo`, `/api/authz` and
   * `/favicon.icox` are real routes and must still be gated, while
   * `/signin`, `/signin/…`, `/api/auth/…`, `/_next/static/…`,
   * `/_next/image…` and exactly `/favicon.ico` stay excluded.
   *
   * The final alternative excludes `public/` image assets, and it is here
   * because gating them broke the sign-in page's logo in a way no test could
   * see. `/_next/image` is excluded, but the optimizer then fetches the source
   * URL it was given — `/logo.png` — which the gate answered with a 307 to
   * `/signin`, so the optimizer returned 400 and the browser showed a broken
   * image on the first screen anyone sees. Everything in `public/` is public by
   * definition; private files go through the blob store, never from here.
   *
   * This alternative is anchored with `$` for the same reason the others are
   * anchored with `(?:/|$)`: `/logo.png/edit` and `/reports/chart.png.json` are
   * ordinary routes and stay gated. Only a path that *ends* in an image
   * extension is excluded.
   */
  matcher: [
    '/((?!signin(?:/|$)|api/auth(?:/|$)|_next/static(?:/|$)|_next/image(?:/|$)|favicon\\.ico$|.*\\.(?:png|svg|jpe?g|webp|avif|gif)$).*)',
  ],
};

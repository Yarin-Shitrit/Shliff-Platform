import type { MetadataRoute } from 'next';

/**
 * The web app manifest, served at `/manifest.webmanifest` (Next's
 * `manifest.ts` convention). It is what "add to home screen" reads on
 * Android and in desktop Chrome: the name under the icon, the icon itself,
 * and that the app opens full-screen without the browser's chrome.
 *
 * iPhone reads none of this. Safari takes the icon from `apple-icon.png`
 * beside this file and the name from `appleWebApp.title` in `layout.tsx`,
 * so the three are kept saying the same thing.
 *
 * The icons are the logo on the brand's soft cream, opaque: a home-screen
 * icon with transparency gets a black square behind it on iOS and a white
 * one elsewhere, neither of which is the product's. Both sizes are purpose
 * `any maskable`: the logo sits inside the 80% safe zone, so a launcher
 * that crops to a circle or a squircle still shows the whole disc.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'קופת שליף',
    short_name: 'שליף',
    description: 'ניהול נתוני הקאמפ',
    lang: 'he',
    dir: 'rtl',
    start_url: '/',
    display: 'standalone',
    background_color: '#FDF1E8',
    theme_color: '#FDF1E8',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}

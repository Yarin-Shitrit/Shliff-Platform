import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/* `next/font/local` is empty outside Next's compiler (see `layout.test.tsx`); the layout's loader is stubbed the same way. */
vi.mock('next/font/local', () => ({
  default: (options: { variable?: string }) => ({
    className: `__mock_${options.variable ?? 'face'}`,
    ...(options.variable ? { variable: `__mock_var_${options.variable}` } : {}),
    style: { fontFamily: options.variable ?? 'face' },
  }),
}));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));

import manifest from './manifest';
import { metadata, viewport } from './layout';

/**
 * "Add to home screen" on a phone: what the launcher reads, and the icon
 * files it points at. A PNG's header says its size and whether it carries
 * an alpha channel (colour type 6 is RGBA, 2 is RGB), which is enough to
 * catch an icon that would get a black square behind it on iOS.
 */
function png(path: string): { width: number; height: number; alpha: boolean } {
  const bytes = readFileSync(join(process.cwd(), path));
  expect(bytes.subarray(1, 4).toString('ascii')).toBe('PNG');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), alpha: bytes[25] === 6 || bytes[25] === 4 };
}

describe('the home-screen icon', () => {
  it('is a square, opaque apple-icon of 180 px, so iOS puts no black behind it', () => {
    expect(png('src/app/apple-icon.png')).toEqual({ width: 180, height: 180, alpha: false });
  });

  it('is the same logo, opaque, in the sizes the manifest names', () => {
    const named = manifest().icons ?? [];
    expect(named.map((icon) => icon.src)).toEqual(expect.arrayContaining(['/icons/icon-192.png', '/icons/icon-512.png']));
    for (const icon of named) {
      const file = png(`public${icon.src}`);
      const size = Number(icon.sizes?.split('x')[0]);
      expect(file).toEqual({ width: size, height: size, alpha: false });
    }
    // Launchers that crop to a circle need a maskable icon; ones that do not need a plain one.
    expect(named.some((icon) => icon.purpose === 'maskable')).toBe(true);
    expect(named.some((icon) => icon.purpose === 'any')).toBe(true);
  });

  it('names the app the way the title bar does, in Hebrew, right to left, opening full-screen', () => {
    const out = manifest();
    expect(out.name).toBe('קופת שליף');
    expect(out.lang).toBe('he');
    expect(out.dir).toBe('rtl');
    expect(out.display).toBe('standalone');
    expect(out.start_url).toBe('/');
  });

  it('tells Safari the same name and that the page may run as an app', () => {
    const apple = metadata.appleWebApp;
    expect(apple).toMatchObject({ capable: true, title: 'קופת שליף' });
    expect(metadata.manifest).toBe('/manifest.webmanifest');
    // The phone paints the page's own canvas around it, light and dark (`tokens.css` `--canvas`).
    expect(viewport.themeColor).toEqual([
      { media: '(prefers-color-scheme: light)', color: '#F6F4F1' },
      { media: '(prefers-color-scheme: dark)', color: '#0E0D0C' },
    ]);
  });
});

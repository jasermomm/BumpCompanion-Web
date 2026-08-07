// @vitest-environment node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createPwaManifest, createWorkboxOptions, normalizeBase } from '../../vite.config';

describe('GitHub Pages PWA configuration', () => {
  it.each([
    [undefined, '/'],
    ['', '/'],
    ['/', '/'],
    ['BumpCompanion-Web', '/BumpCompanion-Web/'],
    ['/BumpCompanion-Web', '/BumpCompanion-Web/'],
    ['/BumpCompanion-Web/', '/BumpCompanion-Web/'],
    ['  /BumpCompanion-Web///  ', '/BumpCompanion-Web/']
  ])('normalizes base %j to %s', (configured, expected) => {
    expect(normalizeBase(configured)).toBe(expected);
  });

  it('keeps manifest identity, launch URL, scope, and icons inside the repository path', () => {
    const base = '/BumpCompanion-Web/';
    const manifest = createPwaManifest(base);

    expect(manifest).toMatchObject({
      id: base,
      name: 'BumpCompanion',
      short_name: 'BumpCompanion',
      start_url: base,
      scope: base,
      display: 'standalone',
      background_color: '#FFFBFF',
      theme_color: '#8A5A00',
      prefer_related_applications: false
    });
    expect(manifest.icons).toHaveLength(3);
    expect(manifest.icons.every(({ src }) => src.startsWith(base))).toBe(true);
    expect(manifest.icons).toContainEqual(expect.objectContaining({
      src: `${base}icons/icon-maskable-512.png`,
      purpose: 'maskable'
    }));
  });

  it('uses a repository-scoped navigation fallback without adding tile runtime caching', () => {
    const workbox = createWorkboxOptions('/BumpCompanion-Web/');

    expect(workbox.navigateFallback).toBe('/BumpCompanion-Web/index.html');
    expect(workbox.globPatterns).toContain('**/*.{js,css,html,ico,png,svg}');
    expect(workbox).not.toHaveProperty('runtimeCaching');
    expect(workbox).toMatchObject({
      cleanupOutdatedCaches: true,
      clientsClaim: true,
      skipWaiting: true
    });
  });

  it('contains iPhone standalone and safe-area metadata without disabling zoom', () => {
    const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');

    expect(html).toContain('viewport-fit=cover');
    expect(html).not.toContain('maximum-scale');
    expect(html).toContain('name="apple-mobile-web-app-capable" content="yes"');
    expect(html).toContain('name="apple-mobile-web-app-status-bar-style" content="black-translucent"');
    expect(html).toContain('href="%BASE_URL%icons/apple-touch-icon.png"');
    expect(html).toContain('name="referrer" content="strict-origin-when-cross-origin"');
  });
});

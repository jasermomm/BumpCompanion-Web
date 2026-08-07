import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export function normalizeBase(configured = '/'): string {
  const path = configured.trim().replace(/^\/+|\/+$/g, '');
  return path.length > 0 ? `/${path}/` : '/';
}

export function createPwaManifest(base: string) {
  return {
    id: base,
    name: 'BumpCompanion',
    short_name: 'BumpCompanion',
    description: 'Local-first speed-bump detection and approach warnings for iPhone.',
    start_url: base,
    scope: base,
    display: 'standalone' as const,
    background_color: '#FFFBFF',
    theme_color: '#8A5A00',
    categories: ['navigation', 'utilities'],
    lang: 'en',
    dir: 'ltr' as const,
    prefer_related_applications: false,
    icons: [
      {
        src: `${base}icons/icon-192.png`,
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any' as const
      },
      {
        src: `${base}icons/icon-512.png`,
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any' as const
      },
      {
        src: `${base}icons/icon-maskable-512.png`,
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable' as const
      }
    ]
  };
}

export function createWorkboxOptions(base: string) {
  return {
    cleanupOutdatedCaches: true,
    clientsClaim: true,
    skipWaiting: true,
    // The plugin injects manifest.webmanifest itself; keeping it out of this glob
    // prevents a duplicate precache entry while retaining every app-shell asset.
    globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
    navigateFallback: `${base}index.html`
  };
}

export default defineConfig(() => {
  const base = normalizeBase(process.env.VITE_BASE_PATH);

  return {
    base,
    plugins: [
      react(),
      VitePWA({
        registerType: 'autoUpdate',
        manifest: createPwaManifest(base),
        workbox: createWorkboxOptions(base)
      })
    ],
    build: {
      sourcemap: false,
      target: 'es2022',
      rollupOptions: {
        output: {
          manualChunks(moduleId) {
            const id = moduleId.replaceAll('\\', '/');
            if (id.includes('/node_modules/leaflet/')) return 'map';
            if (id.includes('/node_modules/react/') ||
              id.includes('/node_modules/react-dom/') ||
              id.includes('/node_modules/scheduler/')) return 'react';
            if (id.includes('/node_modules/lucide-react/')) return 'icons';
            if (id.includes('/node_modules/idb/')) return 'storage';
            return undefined;
          }
        }
      }
    }
  };
});

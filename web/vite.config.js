import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const backend = process.env.BACKEND || 'http://localhost:3000';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'AmoreChat',
        short_name: 'AmoreChat',
        description: 'پیام‌رسان داخلی',
        lang: 'fa',
        dir: 'rtl',
        start_url: '/',
        display: 'standalone',
        background_color: '#0f172a',
        theme_color: '#2563eb',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        importScripts: ['sw-extra.js'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/socket\.io/, /^\/healthz/, /^\/rtc/],
      },
    }),
  ],
  server: {
    proxy: {
      '/api': backend,
      '/socket.io': { target: backend, ws: true },
      '/rtc': { target: backend, ws: true },
    },
  },
});

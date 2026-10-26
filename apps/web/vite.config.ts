import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { cloudflare } from '@cloudflare/vite-plugin'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  plugins: [cloudflare({ viteEnvironment: { name: 'ssr' } }), tanstackStart({
    // Both pages are static: release data and social cards are baked in by scripts/build-assets.tsx.
    pages: [{ path: '/' }, { path: '/docs' }],
    prerender: { enabled: true, crawlLinks: false, failOnError: true, autoSubfolderIndex: false },
    sitemap: { enabled: true, host: 'https://act-dock.mohammedibrahim.dev' },
  }), react(), tailwindcss()],
})

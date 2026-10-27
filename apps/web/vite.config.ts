import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { cloudflare } from '@cloudflare/vite-plugin'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'
// Local CI runs in an emulated x86 container where the prerender's workerd server never answers;
// it opts out and still checks the build. Deploy builds run natively and must prerender.
const prerender = process.env.ACT_DOCK_SKIP_PRERENDER !== '1'
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  plugins: [cloudflare({ viteEnvironment: { name: 'ssr' } }), tanstackStart({
    // Both pages are static: release data and social cards are baked in by scripts/build-assets.tsx.
    pages: [{ path: '/' }, { path: '/docs' }],
    prerender: { enabled: prerender, crawlLinks: false, failOnError: true, autoSubfolderIndex: false },
    sitemap: { enabled: prerender, host: 'https://act-dock.mohammedibrahim.dev' },
  }), react(), tailwindcss()],
})

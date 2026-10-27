// TanStack's prerender can report "Prerendered 0 pages" and still exit 0. Never deploy without the static pages.
import { join } from 'node:path'
if (process.env.ACT_DOCK_SKIP_PRERENDER === '1') process.exit(0)
const client = join(import.meta.dir, '../dist/client')
const missing = []
for (const [file, marker] of [['index.html', 'Your pipelines.'], ['docs.html', 'Run GitHub Actions'], ['sitemap.xml', '/docs</loc>'], ['og/home.png', ''], ['og/docs.png', '']]) {
  const f = Bun.file(join(client, file))
  if (!(await f.exists()) || (marker && !(await f.text()).includes(marker))) missing.push(file)
}
if (missing.length) { console.error('Prerendered output missing or incomplete: ' + missing.join(', ')); process.exit(1) }
console.log('Prerendered output verified: /, /docs, sitemap, social cards')

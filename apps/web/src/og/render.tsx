import { initWasm, Resvg } from '@resvg/resvg-wasm'
import initYoga from 'yoga-wasm-web'
import yogaWasm from 'yoga-wasm-web/dist/yoga.wasm?module'
import resvgWasm from '@resvg/resvg-wasm/index_bg.wasm?module'
import regular from './fonts/Inter-Regular.bin'
import semibold from './fonts/Inter-SemiBold.bin'
import markPng from './mark.bin'
import { Card, type CardContent } from './card'
import { loadRelease } from '@/lib/releases'

export const cards = {
  home: { eyebrow: 'Local GitHub Actions runner', title: 'Your pipelines.\nOn your machine.', subtitle: 'Run workflows locally, follow every step, and give your AI agents the same controls.' },
  docs: { eyebrow: 'Documentation', title: 'Run GitHub Actions\non your machine.', subtitle: 'Install Act Dock, connect your agents over MCP, and drive the runner from the CLI.' },
} satisfies Record<string, CardContent>
export type CardName = keyof typeof cards
// Bump when the card layout changes so cached images refresh.
const CARD_REVISION = 1

// Workers can't compile WebAssembly from bytes, so both engines start from precompiled modules.
let engine: Promise<typeof import('satori/wasm').default> | undefined
async function loadEngine() {
  const { default: satori, init } = await import('satori/wasm')
  const [yoga] = await Promise.all([initYoga(yogaWasm), initWasm(resvgWasm).catch(e => { if (!String(e).includes('Already initialized')) throw e })])
  init(yoga)
  return satori
}
const mark = 'data:image/png;base64,' + btoa(String.fromCharCode(...new Uint8Array(markPng)))
const clean = (value: string | null, max: number) => value?.replace(/[^\S\n]+/g, ' ').trim().slice(0, max) || undefined

export async function renderCard(request: Request) {
  const url = new URL(request.url)
  const base = cards[url.searchParams.get('page') as CardName] ?? cards.home
  const content: CardContent = {
    eyebrow: clean(url.searchParams.get('eyebrow'), 40) ?? base.eyebrow,
    title: clean(url.searchParams.get('title'), 70) ?? base.title,
    subtitle: clean(url.searchParams.get('subtitle'), 140) ?? base.subtitle,
  }
  const version = (await loadRelease())?.version
  const cache = (globalThis.caches as CacheStorage & { default?: Cache } | undefined)?.default
  const key = new Request(`${url.origin}/og.png?r=${CARD_REVISION}&v=${version ?? 'none'}&c=${encodeURIComponent(JSON.stringify(content))}`)
  const hit = await cache?.match(key)
  if (hit) return hit
  engine ??= loadEngine().catch(e => { engine = undefined; throw e })
  const satori = await engine
  const svg = await satori(<Card content={content} version={version} mark={mark} />, {
    width: 1200, height: 630,
    fonts: [{ name: 'Inter', data: regular, weight: 400, style: 'normal' }, { name: 'Inter', data: semibold, weight: 600, style: 'normal' }],
  })
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: 1200 } }).render().asPng()
  const response = new Response(png as Uint8Array<ArrayBuffer>, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600, s-maxage=86400' } })
  if (cache) await cache.put(key, response.clone())
  return response
}

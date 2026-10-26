// Runs before `vite build`: bakes the latest release manifest into the bundle and renders the social cards
// as static PNGs. The release pipeline deploys after publishing, so both always reflect the new version.
import satori from 'satori'
import { initWasm, Resvg } from '@resvg/resvg-wasm'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { Card, type CardContent } from './og/card'
import { cards } from '../src/lib/cards'

const root = join(import.meta.dir, '..')
const repository = 'https://github.com/MohammedIbrahim8887/act-dock'

async function fetchRelease() {
  try {
    const response = await fetch(repository + '/releases/latest/download/manifest.json', { signal: AbortSignal.timeout(15000) })
    if (!response.ok) throw new Error('HTTP ' + response.status)
    const data = await response.json() as { version?: string; assets?: { url: string; sha256: unknown }[] }
    if (!data.version || !Array.isArray(data.assets)) throw new Error('Invalid manifest')
    data.assets = data.assets.filter(a => a.url.startsWith(repository + '/releases/download/') && typeof a.sha256 === 'string')
    return data
  } catch (error) {
    console.warn('Release manifest unavailable at build time; the site will fetch it at runtime.', error)
    return null
  }
}

const release = await fetchRelease()
await mkdir(join(root, 'src/generated'), { recursive: true })
await Bun.write(join(root, 'src/generated/release.json'), JSON.stringify(release) + '\n')

await initWasm(await Bun.file(require.resolve('@resvg/resvg-wasm/index_bg.wasm')).arrayBuffer())
const font = (name: string) => Bun.file(join(import.meta.dir, 'og/fonts', name)).arrayBuffer()
const fonts = [
  { name: 'Inter', data: await font('Inter-Regular.ttf'), weight: 400 as const, style: 'normal' as const },
  { name: 'Inter', data: await font('Inter-SemiBold.ttf'), weight: 600 as const, style: 'normal' as const },
]
const mark = 'data:image/svg+xml;base64,' + Buffer.from(await Bun.file(join(root, 'public/mark.svg')).text()).toString('base64')
await mkdir(join(root, 'public/og'), { recursive: true })
for (const [name, content] of Object.entries(cards) as [string, CardContent][]) {
  const svg = await satori(<Card content={content} version={release?.version} mark={mark} />, { width: 1200, height: 630, fonts })
  await Bun.write(join(root, 'public/og', name + '.png'), new Resvg(svg, { fitTo: { mode: 'width', value: 1200 } }).render().asPng())
}
console.log(`Social cards rendered for ${release ? 'v' + release.version : 'no release'}: ${Object.keys(cards).join(', ')}`)

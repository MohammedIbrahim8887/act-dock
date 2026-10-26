// Regenerates the committed favicon set from brand/mark.svg: bun scripts/icons.ts
import { initWasm, Resvg } from '@resvg/resvg-wasm'
import { join } from 'node:path'
const root = join(import.meta.dir, '..'), pub = join(root, 'public')
await initWasm(await Bun.file(require.resolve('@resvg/resvg-wasm/index_bg.wasm')).arrayBuffer())
const mark = (await Bun.file(join(root, 'brand/mark.svg')).text()).match(/<g[\s\S]*<\/g>/)![0]
// Mark artwork spans roughly 105–1171 × 137–1145 in a 1254 box; center it at `scale` of the tile.
const art = (fill: string, scale: number) => `<g transform="translate(627 627) scale(${scale}) translate(-638 -641)">${mark.replace('fill="#000"', `fill="${fill}"`)}</g>`
const tile = (rx: number, scale: number) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1254 1254"><rect width="1254" height="1254" rx="${rx}" fill="#1c1c1c"/>${art('#fff', scale)}</svg>`
const png = (svg: string, size: number) => new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng()
await Bun.write(join(pub, 'favicon.svg'), tile(260, .7) + '\n')
await Bun.write(join(pub, 'mark.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="80 112 1116 1058">${mark.replace('fill="#000"', 'fill="#202020"')}</svg>\n`)
await Bun.write(join(pub, 'favicon-32x32.png'), png(tile(260, .74), 32))
await Bun.write(join(pub, 'apple-touch-icon.png'), png(tile(0, .62), 180)) // iOS rounds the corners itself.
await Bun.write(join(pub, 'icon-192.png'), png(tile(260, .66), 192))
await Bun.write(join(pub, 'icon-512.png'), png(tile(260, .66), 512))
await Bun.write(join(pub, 'icon-maskable-512.png'), png(tile(0, .5), 512)) // Content inside the 80% safe zone.
for (const size of [16, 32, 48]) await Bun.write(join(root, `.cache-ico-${size}.png`), png(tile(260, .74), size))

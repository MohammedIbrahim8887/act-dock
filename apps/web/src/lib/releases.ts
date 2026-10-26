import { createServerFn } from '@tanstack/react-start'
export const repository = 'https://github.com/MohammedIbrahim8887/act-dock'
export type ReleaseAsset = { kind:string; name:string; url:string; sha256:string; size:number; arch:string; platform:string; format:string }
export type ReleaseManifest = { version:string; publishedAt:string; commit:string; assets:ReleaseAsset[] }
export async function loadRelease():Promise<ReleaseManifest|null> {
  const url = repository + '/releases/latest/download/manifest.json'
  const cache = (globalThis.caches as CacheStorage & { default?:Cache } | undefined)?.default
  const key = new Request('https://act-dock.mohammedibrahim.dev/_release-manifest-v1')
  const cached = await cache?.match(key)
  if (cached) return cached.json()
  try {
    const response = await fetch(url, {signal:AbortSignal.timeout(8000)})
    if (!response.ok) return null
    const data = await response.json() as ReleaseManifest
    if (!data.version || !Array.isArray(data.assets)) return null
    data.assets = data.assets.filter(a => a.url.startsWith(repository+'/releases/download/') && typeof a.sha256 === 'string')
    if (cache) await cache.put(key, Response.json(data,{headers:{'Cache-Control':'public, max-age=300'}}))
    return data
  } catch { return null }
}
export const getRelease = createServerFn({method:'GET'}).handler(loadRelease)

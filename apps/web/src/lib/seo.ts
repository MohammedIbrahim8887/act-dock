import { cards, type CardName } from './cards'
export const siteUrl = 'https://act-dock.mohammedibrahim.dev'
const author = { '@type': 'Person', name: 'Mohammed Ibrahim', url: 'https://mohammedibrahim.dev' }
type Thing = Record<string, unknown>
/**
 * Page metadata. The social card is a static PNG rendered at build time; its ?v= changes with each
 * release so platforms refetch it. Structured data is merged into one JSON-LD graph per page.
 */
export function seo({ title, description, path, card, version, structuredData = [] }: { title: string; description: string; path: string; card: CardName; version?: string; structuredData?: Thing[] }) {
  const url = siteUrl + path
  const image = `${siteUrl}/og/${card}.png${version ? '?v=' + version : ''}`
  const alt = `Act Dock — ${cards[card].title.replace('\n', ' ')}`
  const graph = [
    { '@type': 'WebSite', '@id': siteUrl + '/#website', name: 'Act Dock', url: siteUrl + '/', inLanguage: 'en-US' },
    { '@type': 'WebPage', '@id': url + '#page', url, name: title, description, isPartOf: { '@id': siteUrl + '/#website' }, primaryImageOfPage: image, inLanguage: 'en-US' },
    ...structuredData.map(item => ({ author, image, url, ...item })),
  ]
  return {
    meta: [
      { title },
      { name: 'description', content: description },
      { property: 'og:type', content: 'website' },
      { property: 'og:site_name', content: 'Act Dock' },
      { property: 'og:locale', content: 'en_US' },
      { property: 'og:url', content: url },
      { property: 'og:title', content: title },
      { property: 'og:description', content: description },
      { property: 'og:image', content: image },
      { property: 'og:image:secure_url', content: image },
      { property: 'og:image:type', content: 'image/png' },
      { property: 'og:image:width', content: '1200' },
      { property: 'og:image:height', content: '630' },
      { property: 'og:image:alt', content: alt },
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:title', content: title },
      { name: 'twitter:description', content: description },
      { name: 'twitter:image', content: image },
      { name: 'twitter:image:alt', content: alt },
    ],
    links: [{ rel: 'canonical', href: url }],
    scripts: [{ type: 'application/ld+json', children: JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }) }],
  }
}

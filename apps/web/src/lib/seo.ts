const site = 'https://act-dock.mohammedibrahim.dev'
/** Page metadata with a social card rendered by /og.png; the version in the URL refreshes cached previews on each release. */
export function seo({ title, description, path, card, version }: { title: string; description: string; path: string; card: 'home' | 'docs'; version?: string }) {
  const image = `${site}/og.png?page=${card}${version ? '&v=' + version : ''}`
  const alt = `Preview card for ${title}`
  return {
    meta: [
      { title },
      { name: 'description', content: description },
      { property: 'og:type', content: 'website' },
      { property: 'og:site_name', content: 'Act Dock' },
      { property: 'og:url', content: site + path },
      { property: 'og:title', content: title },
      { property: 'og:description', content: description },
      { property: 'og:image', content: image },
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
    links: [{ rel: 'canonical', href: site + path }],
  }
}

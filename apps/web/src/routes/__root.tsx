import { createRootRoute, HeadContent, Scripts, Outlet } from '@tanstack/react-router'
import styles from '../styles.css?url'
export const Route = createRootRoute({
  head: () => ({
    meta: [{ charSet: 'utf-8' }, { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Act Dock — Your pipelines. On your machine.' },
      { name: 'description', content: 'Run GitHub Actions locally with a desktop workspace, live logs, and MCP tools for your AI agents. Download Act Dock for macOS, Windows, or Linux.' },
      { property: 'og:title', content: 'Act Dock — Your pipelines. On your machine.' },
      { property: 'og:description', content: 'A local home for GitHub Actions. Run workflows, follow every step, and give your agents the same controls.' },
      { property: 'og:image', content: 'https://act-dock.mohammedibrahim.dev/icon.png' },
      { name: 'theme-color', content: '#fafafa' }],
    links: [{rel:'stylesheet',href:styles},{rel:'icon',type:'image/png',href:'/icon.png'},{rel:'canonical',href:'https://act-dock.mohammedibrahim.dev/'}],
  }),
  component: () => <html lang="en"><head><HeadContent /></head><body><Outlet /><Scripts /></body></html>,
  notFoundComponent: () => <main className="not-found"><h1>Page not found.</h1><a href="/">Return to Act Dock</a></main>,
})

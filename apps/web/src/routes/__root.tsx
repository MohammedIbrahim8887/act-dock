import { createRootRoute, HeadContent, Scripts, Outlet } from '@tanstack/react-router'
import styles from '../styles.css?url'
export const Route = createRootRoute({
  head: () => ({
    meta: [{ charSet: 'utf-8' }, { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Act Dock — Your pipelines. On your machine.' },
      { name: 'theme-color', content: '#fafafa' }],
    links: [{rel:'stylesheet',href:styles},
      {rel:'icon',href:'/favicon.ico',sizes:'48x48'},
      {rel:'icon',type:'image/svg+xml',href:'/favicon.svg'},
      {rel:'icon',type:'image/png',sizes:'32x32',href:'/favicon-32x32.png'},
      {rel:'apple-touch-icon',sizes:'180x180',href:'/apple-touch-icon.png'},
      {rel:'manifest',href:'/site.webmanifest'}],
  }),
  component: () => <html lang="en"><head><HeadContent /></head><body><Outlet /><Scripts /></body></html>,
  notFoundComponent: () => <main className="not-found"><h1>Page not found.</h1><a href="/">Return to Act Dock</a></main>,
})

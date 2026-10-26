import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { ArrowDown, ArrowUpRight, Check, Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { repository } from '@/lib/releases'

export function SiteHeader() {
  return <header className="site-header">
    <Link className="brand" to="/" aria-label="Act Dock home"><img src="/mark.png" width="28" height="28" alt=""/><span>Act Dock</span></Link>
    <nav aria-label="Main navigation">
      <Button asChild variant="ghost" size="sm" className="nav-docs"><Link to="/docs">Docs</Link></Button>
      <Button asChild variant="ghost" size="sm" className="nav-github"><a href={repository}>GitHub<ArrowUpRight size={13}/></a></Button>
      <Button asChild size="sm"><a href="/#downloads">Download<ArrowDown size={14}/></a></Button>
    </nav>
  </header>
}

export function SiteFooter() {
  return <footer className="site-footer">
    <Link className="brand" to="/"><img src="/mark.png" width="21" height="21" alt=""/><span>Act Dock</span></Link>
    <p>Made by <a href="https://mohammedibrahim.dev">Mohammed Ibrahim</a></p>
    <nav aria-label="Footer"><Link to="/docs">Docs</Link><a href={repository + '/releases'}>Releases</a><a href={repository}>Source<ArrowUpRight size={13}/></a></nav>
  </footer>
}

export function CodeBlock({ code, label }: { code: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => void navigator.clipboard.writeText(code).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1600) }).catch(() => {})
  return <div className="code-block">
    {label && <div className="code-label">{label}</div>}
    <pre><code>{code}</code></pre>
    <button type="button" onClick={copy} aria-label={copied ? 'Copied' : 'Copy ' + (label ?? 'code')}>{copied ? <Check size={14}/> : <Copy size={14}/>}</button>
    <span className="sr-only" aria-live="polite">{copied ? 'Copied to clipboard' : ''}</span>
  </div>
}

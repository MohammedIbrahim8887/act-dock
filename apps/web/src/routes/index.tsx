import { useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { ArrowDownToLine, ArrowRight, ArrowUpRight, Check, Command, Terminal, Workflow, Monitor, Laptop, Package, Pause, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { getRelease, repository, type ReleaseManifest } from '@/lib/releases'
import { AppDemo } from '@/components/app-demo'
import { seo, siteUrl } from '@/lib/seo'
import { CodeBlock, SiteFooter, SiteHeader } from '@/components/site-chrome'
export const Route = createFileRoute('/')({
  loader:()=>getRelease(),
  head:({loaderData})=>seo({
    title:'Act Dock — Your pipelines. On your machine.',
    description:'Run GitHub Actions locally with a desktop workspace, live logs, and MCP tools for your AI agents. Download Act Dock for macOS, Windows, or Linux.',
    path:'/',card:'home',version:loaderData?.version,
    structuredData:[{
      '@type':'SoftwareApplication','@id':siteUrl+'/#app',name:'Act Dock',
      applicationCategory:'DeveloperApplication',operatingSystem:'macOS 14+, Windows 10+, Linux',
      ...(loaderData?{softwareVersion:loaderData.version,downloadUrl:repository+'/releases/tag/v'+loaderData.version}:{}),
      offers:{'@type':'Offer',price:'0',priceCurrency:'USD'},
      sameAs:[repository],
    }],
  }),
  component:Home,
})
const platforms = [
  {kind:'macos-arm64',name:'macOS',detail:'Apple Silicon · macOS 14+',format:'DMG',icon:Laptop},
  {kind:'windows-x64',name:'Windows',detail:'Intel / AMD 64-bit · Windows 10+',format:'Installer',icon:Monitor},
  {kind:'linux-x64-deb',name:'Linux',detail:'Ubuntu 24.04+ / Debian 13+',format:'DEB',icon:Package},
  {kind:'linux-x64-rpm',name:'Linux',detail:'Fedora 40+ · 64-bit',format:'RPM',icon:Package},
  {kind:'linux-x64-appimage',name:'Linux',detail:'Portable · glibc 2.39+',format:'AppImage',icon:Package},
]
function Downloads({release}:{release:ReleaseManifest|null}) {
  return <section id="downloads" className="downloads section-anchor">
    <div className="section-heading"><div><h2>Make yourself at home.</h2><p>Pick your platform. Bring your existing workflows.</p></div>{release && <Badge variant="outline">v{release.version}</Badge>}</div>
    <Table><TableHeader><TableRow><TableHead>Platform</TableHead><TableHead>Package</TableHead><TableHead className="download-column">Download</TableHead></TableRow></TableHeader><TableBody>
      {platforms.map(p=>{const asset=release?.assets.find(a=>a.kind===p.kind);return <TableRow key={p.kind}><TableCell><div className="platform-name"><p.icon size={19} aria-hidden="true"/><div><strong>{p.name}</strong><span>{p.detail}</span></div></div></TableCell><TableCell className="package-format">{p.format}</TableCell><TableCell className="download-column">{asset?<Button asChild variant="outline" size="sm"><a href={asset.url} aria-label={`Download ${p.name} ${p.format}`}><ArrowDownToLine size={14}/>Download</a></Button>:<Button variant="outline" size="sm" disabled>Build pending</Button>}</TableCell></TableRow>})}
    </TableBody></Table>
    <div className="download-notes"><p>The <a href="https://nektosact.com">act</a> engine is built in. You just need Docker running. Installers are currently unsigned.</p><a href={repository+'/releases/latest'}>Release notes & checksums <ArrowUpRight size={13}/></a></div>
  </section>
}
const tools = ['list_projects','add_project','list_workflows','run_pipeline','list_runs','get_run','get_run_logs','cancel_run']
const mcpConfig = `{
  "mcpServers": {
    "act-dock": {
      "command": "/path/shown/in/Agent connections",
      "args": ["mcp"]
    }
  }
}`
function ProductWindow() {
  const [paused, setPaused] = useState(false)
  return <figure className="product-window" aria-label="Animated preview: Act Dock runs a CI workflow, highlights each step, and streams its output until all three jobs pass.">
    <div className="window-bar"><span className="window-dots" aria-hidden="true"><i/><i/><i/></span><span>Act Dock</span>
      <span className="window-actions"><span className="local-state"><span/>Running locally</span>
        <button type="button" className="demo-pause" onClick={() => setPaused(p => !p)} aria-pressed={paused} aria-label={paused ? 'Play preview' : 'Pause preview'}>{paused ? <Play size={12}/> : <Pause size={12}/>}</button></span></div>
    <AppDemo paused={paused}/>
  </figure>
}
function AgentSection() {
  return <section className="agent-section">
    <div><h2>Part of your agent’s toolkit.</h2><p>Eight focused MCP tools. Your agent can add a project, run a pipeline, read its logs, and cancel it. It uses the same queue and history you see in the app.</p>
      <CodeBlock label="mcp.json" code={mcpConfig}/>
      <Button asChild variant="outline"><Link to="/docs" hash="mcp">Set up your agent<ArrowRight size={14}/></Link></Button></div>
    <div className="tool-list" aria-label="Available MCP tools">{tools.map(t=><div key={t}><Check size={14} aria-hidden="true"/><code>{t}</code></div>)}</div>
  </section>
}
function Home(){const release=Route.useLoaderData();return <>
  <a className="skip-link" href="#main">Skip to content</a>
  <div className="site-shell"><SiteHeader/>
  <main id="main"><section className="hero"><div className="hero-copy"><h1>Your pipelines.<br/>On your machine.</h1><p>Run GitHub Actions locally, follow every step, and give your AI agents the same controls. All in one desktop workspace.</p><div className="hero-actions"><Button asChild size="lg"><a href="#downloads"><ArrowDownToLine size={17}/>Download Act Dock</a></Button></div><p className="platform-caption">macOS, Windows & Linux</p></div><div className="hero-note"><Workflow size={20} aria-hidden="true"/><p>The workflows you already have.<br/>A shorter path to the result.</p></div></section>
  <ProductWindow/>
  <section id="how-it-works" className="features section-anchor"><div className="section-heading"><h2>A local loop that stays local.</h2></div><div className="feature-columns"><article><Workflow size={22}/><h3>Start with your project.</h3><p>Choose a folder and discover its GitHub Actions. Run a whole workflow or a single job against your current files.</p></article><article><Terminal size={22}/><h3>See what’s happening.</h3><p>Follow live output, find the current step, cancel a run, or come back to its history. Keep working when the window closes.</p></article><article><Command size={22}/><h3>Let your agents run it.</h3><p>Connect local AI agents through MCP, or use the CLI. They share the same queue, logs, and run history as the app.</p></article></div></section>
  <Downloads release={release}/>
  <AgentSection/>
  </main><SiteFooter/></div>
  </>}

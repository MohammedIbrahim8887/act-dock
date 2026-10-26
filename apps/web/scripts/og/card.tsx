// Social card layout for satori: every multi-child box needs an explicit display:flex.
export type CardContent = { eyebrow: string; title: string; subtitle: string }
const ink = '#202020', muted = '#626262', line = '#dcdcdc', green = '#79d99a'

function Chip({ children, strong }: { children: string; strong?: boolean }) {
  return <div style={{ display: 'flex', alignItems: 'center', height: 40, padding: '0 16px', borderRadius: 999, border: `1px solid ${strong ? ink : line}`, background: strong ? ink : '#fff', color: strong ? '#fff' : ink, fontSize: 19, fontWeight: strong ? 600 : 400 }}>{children}</div>
}

function LogLine({ n, job, text, current }: { n: number; job: string; text: string; current?: boolean }) {
  return <div style={{ display: 'flex', gap: 14, padding: '5px 22px', fontSize: 15, background: current ? 'rgba(29,44,34,.9)' : 'transparent' }}>
    <span style={{ width: 22, textAlign: 'right', color: current ? green : '#5f5f5f' }}>{String(n)}</span>
    <span style={{ color: green, opacity: .8 }}>[{job}]</span>
    <span style={{ color: '#cfcfcf' }}>{text}</span>
  </div>
}

function AppWindow() {
  return <div style={{ position: 'absolute', right: -24, top: 92, width: 508, height: 470, display: 'flex', flexDirection: 'column', background: '#171717', border: '1px solid #353535', borderRadius: 18, overflow: 'hidden', boxShadow: '0 30px 60px rgba(0,0,0,.18)' }}>
    <div style={{ display: 'flex', alignItems: 'center', height: 44, padding: '0 40px 0 18px', gap: 7, background: '#202020', borderBottom: '1px solid #2c2c2c' }}>
      {[0, 1, 2].map(i => <div key={i} style={{ width: 10, height: 10, borderRadius: 5, background: '#5b5b5b' }} />)}
      <div style={{ display: 'flex', marginLeft: 'auto', alignItems: 'center', gap: 7, color: '#b5b5b5', fontSize: 14 }}><div style={{ width: 7, height: 7, borderRadius: 4, background: green }} />Running locally</div>
    </div>
    <div style={{ display: 'flex', flexDirection: 'column', margin: '20px 46px 14px 22px', padding: '14px 16px', borderRadius: 10, border: `2px solid ${green}`, background: '#1d2c22' }}>
      <div style={{ display: 'flex', alignItems: 'center', color: '#ededed', fontSize: 19, fontWeight: 600 }}>Continuous integration
        <div style={{ display: 'flex', marginLeft: 'auto', padding: '3px 10px', borderRadius: 6, border: '1px solid #477553', color: green, fontSize: 13, fontWeight: 400 }}>Running</div></div>
      <div style={{ display: 'flex', color: '#9c9c9c', fontSize: 14, marginTop: 6 }}>ci.yml · 3 jobs · 0m 06s</div>
    </div>
    <div style={{ display: 'flex', flexDirection: 'column', padding: '10px 22px', background: '#1d2c22', borderTop: '1px solid #477553', borderBottom: '1px solid #477553' }}>
      <div style={{ display: 'flex', color: green, fontSize: 13, fontWeight: 600 }}>Current step</div>
      <div style={{ display: 'flex', gap: 10, color: '#ededed', fontSize: 17, fontWeight: 600, marginTop: 4 }}><span style={{ color: green, fontWeight: 400 }}>test</span>Run unit tests</div>
    </div>
    <div style={{ display: 'flex', flexDirection: 'column', paddingTop: 8 }}>
      <LogLine n={14} job="lint" text="Job succeeded" />
      <LogLine n={17} job="test" text="Run Main Run unit tests" current />
      <LogLine n={18} job="test" text="$ bun test" current />
      <LogLine n={20} job="test" text="✓ discovers nested workflow files" current />
      <LogLine n={21} job="test" text="✓ runs queued pipelines in order" current />
      <LogLine n={22} job="test" text="✓ shares one runner with the CLI" current />
      <LogLine n={23} job="test" text="✓ survives a client disconnect" current />
      <LogLine n={24} job="test" text="✓ filters before paginating" current />
    </div>
  </div>
}

export function Card({ content, version, mark }: { content: CardContent; version?: string; mark: string }) {
  return <div style={{ width: 1200, height: 630, display: 'flex', position: 'relative', overflow: 'hidden', background: '#fafafa', fontFamily: 'Inter', color: ink }}>
    <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 6, background: ink }} />
    <div style={{ display: 'flex', flexDirection: 'column', width: 640, padding: '58px 0 0 72px', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{ display: 'flex', width: 46, height: 46, borderRadius: 11, background: '#fff', border: `1px solid ${line}`, alignItems: 'center', justifyContent: 'center' }}><img src={mark} width={32} height={32} /></div>
        <div style={{ display: 'flex', fontSize: 27, fontWeight: 600, letterSpacing: -0.6 }}>Act Dock</div>
      </div>
      <div style={{ display: 'flex', marginTop: 58, fontSize: 21, color: muted, textTransform: 'uppercase', letterSpacing: 2.5 }}>{content.eyebrow}</div>
      <div style={{ display: 'flex', flexDirection: 'column', marginTop: 16, fontSize: content.title.length > 34 ? 58 : 68, fontWeight: 600, lineHeight: 1.04, letterSpacing: -2.4 }}>
        {content.title.split('\n').map((line, i) => <div key={i} style={{ display: 'flex' }}>{line}</div>)}
      </div>
      <div style={{ display: 'flex', marginTop: 24, fontSize: 25, lineHeight: 1.45, color: muted, maxWidth: 540 }}>{content.subtitle}</div>
      <div style={{ display: 'flex', gap: 10, marginTop: 'auto', marginBottom: 56 }}>
        {version ? <Chip strong>{'v' + version}</Chip> : null}
        <Chip>macOS · Windows · Linux</Chip>
        <Chip>MCP tools</Chip>
      </div>
    </div>
    <AppWindow />
  </div>
}

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Cable, Check, ChevronRight, Circle, Copy, Download, Folder, GitBranch, History, LoaderCircle, PanelLeft, Play, Plus, RefreshCw, Search, Settings, Square, Terminal, Trash2, Workflow } from 'lucide-react'

type JobId = 'lint' | 'test' | 'build'
type Line = { at: number; job: JobId; text: string; tone: 'step' | 'ok' | 'plain' | 'done'; step: string }

// A scripted run of ci.yml, timed in milliseconds from the start of the loop.
const RUN_START = 1700
const jobs: { id: JobId; name: string; needs?: string; steps: [string, string[]][] }[] = [
  { id: 'lint', name: 'Lint & typecheck', steps: [
    ['Set up job', ['Pulling catthehacker/ubuntu:act-latest', 'Using cached image']],
    ['Install dependencies', ['bun install v1.3.14', '+ 214 packages installed [612ms]']],
    ['Typecheck', ['$ tsc --noEmit', 'No type errors found']],
  ] },
  { id: 'test', name: 'Unit tests', needs: 'lint', steps: [
    ['Set up job', ['Reusing container act-CI-test']],
    ['Run unit tests', [
      '$ bun test', 'tests/workflows.test.ts:', '✓ discovers nested workflow files', '✓ keeps valid files beside malformed ones',
      'tests/queue.test.ts:', '✓ runs queued pipelines in order', '✓ cancels the whole process group', 'tests/mcp.test.ts:',
      '✓ shares one runner with the CLI', '✓ survives a client disconnect', '✓ resumes log cursors after restart', 'tests/history.test.ts:',
      '✓ filters before paginating', '✓ counts matching totals', '36 pass · 0 fail · 412 expect() calls',
    ]],
  ] },
  { id: 'build', name: 'Production build', needs: 'test', steps: [
    ['Set up job', ['Reusing container act-CI-build']],
    ['Build app', ['$ bun run build', 'vite v8 building for production…', '✓ 1,284 modules transformed', 'dist/index.js  182.4 kB │ gzip 58.1 kB']],
  ] },
]
const script: Line[] = []
let clock = RUN_START + 250
for (const job of jobs) {
  for (const [name, body] of job.steps) {
    const step = job.id + ':' + name
    script.push({ at: clock, job: job.id, text: '▸ Run Main ' + name, tone: 'step', step }); clock += 260
    for (const text of body) { script.push({ at: clock, job: job.id, text, tone: 'plain', step }); clock += name === 'Run unit tests' ? 170 : 230 }
    script.push({ at: clock, job: job.id, text: '✓ Success - Main ' + name, tone: 'ok', step }); clock += 300
  }
  script.push({ at: clock, job: job.id, text: '■ Job succeeded', tone: 'done', step: '' }); clock += 420
}
const RUN_END = clock
const LOOP = RUN_END + 4200
const FROZEN = script.find(l => l.text === '✓ shares one runner with the CLI')!.at + 1

function useDemoClock(root: React.RefObject<HTMLElement | null>, paused: boolean) {
  const [t, setT] = useState(0)
  const [reduced, setReduced] = useState(false)
  const [visible, setVisible] = useState(true)
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => setReduced(media.matches)
    sync(); media.addEventListener('change', sync)
    return () => media.removeEventListener('change', sync)
  }, [])
  useEffect(() => {
    if (!root.current) return
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: .15 })
    observer.observe(root.current)
    return () => observer.disconnect()
  }, [root])
  useEffect(() => {
    if (reduced) { setT(FROZEN); return }
    if (paused || !visible) return
    let last = performance.now(), frame = 0
    const tick = (now: number) => {
      if (!document.hidden) setT(v => (v + Math.min(now - last, 250)) % LOOP)
      last = now; frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [reduced, paused, visible])
  return { t, reduced }
}

const seconds = (ms: number) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s` }

export function AppDemo({ paused }: { paused: boolean }) {
  const frame = useRef<HTMLDivElement>(null)
  const runButton = useRef<HTMLSpanElement>(null)
  const { t, reduced } = useDemoClock(frame, paused)
  const [cursor, setCursor] = useState({ x: 0, y: 0, sx: 0, sy: 0 })

  useLayoutEffect(() => {
    const measure = () => {
      const f = frame.current?.getBoundingClientRect(), b = runButton.current?.getBoundingClientRect()
      if (!f || !b) return
      setCursor({ x: b.left - f.left + b.width * .55, y: b.top - f.top + b.height * .45, sx: f.width * .72, sy: f.height * .38 })
    }
    measure()
    const observer = new ResizeObserver(measure)
    if (frame.current) observer.observe(frame.current)
    return () => observer.disconnect()
  }, [])

  const shown = t >= RUN_START ? script.filter(l => l.at <= t) : []
  const state: 'ready' | 'running' | 'succeeded' = t < RUN_START ? 'ready' : t < RUN_END ? 'running' : 'succeeded'
  const running = state === 'running'
  let current: Line | null = null
  for (const l of shown) { if (l.tone === 'step') current = l; else if (l.tone === 'ok' && current?.step === l.step) current = null }
  const jobState = (id: JobId) => shown.some(l => l.job === id && l.tone === 'done') ? 'done' : shown.some(l => l.job === id) ? 'running' : 'pending'
  const elapsed = state === 'ready' ? 0 : Math.min(t, RUN_END) - RUN_START
  const pressed = t > 1450 && t < 1640
  const cursorOn = !reduced && t > 250 && t < 2500
  const cursorAt = t > 300

  return <div ref={frame} className="demo" data-state={state} aria-hidden="true" inert>
    <aside className="demo-sidebar">
      <div className="demo-brand"><span><img src="/mark.svg" alt="" width="20" height="20"/></span><div><strong>Act Dock</strong><small>Local pipeline runner</small></div></div>
      <div className="demo-label">Projects <Plus size={13}/></div>
      <div className="demo-nav is-active"><Folder size={14}/><b>act-dock-demo</b>{running && <LoaderCircle size={13} className="demo-spin demo-green"/>}</div>
      <div className="demo-nav is-faint"><Plus size={14}/>Add project</div>
      <div className="demo-label">Workspace</div>
      <div className="demo-nav"><History size={14}/>Run history{running && <em className="demo-count">1</em>}</div>
      <div className="demo-nav"><Cable size={14}/>Agent connections</div>
      <div className="demo-label">Recent runs</div>
      {state !== 'ready' && <div className="demo-recent is-new">{running ? <LoaderCircle size={13} className="demo-spin demo-green"/> : <Check size={13}/>}<div><b>ci.yml</b><small className={running ? 'demo-green' : ''}>act-dock-demo · {running ? 'running' : 'succeeded'}</small></div></div>}
      <div className="demo-recent"><Check size={13}/><div><b>release.yml</b><small>via MCP · succeeded</small></div></div>
      <div className="demo-recent"><Check size={13}/><div><b>security.yml</b><small>via CLI · succeeded</small></div></div>
      <div className="demo-sidebar-foot"><div className="demo-nav"><Settings size={14}/>Settings</div><div className="demo-runner"><span><i/>Local runner</span><span>v0.2</span></div></div>
    </aside>

    <section className="demo-main">
      <div className="demo-crumbs"><PanelLeft size={14}/><span>Workspace</span><ChevronRight size={12}/><b>act-dock-demo</b><span className="demo-crumbs-end"><Terminal size={12}/>Runs on your machine</span></div>
      <div className="demo-panes">
        <div className="demo-workflows">
          <div className="demo-project"><div><h4>act-dock-demo</h4><code>~/code/act-dock-demo</code></div><span><RefreshCw size={14}/><Trash2 size={14}/></span></div>
          <div className={'demo-card' + (running ? ' is-running' : '') + (state !== 'ready' ? ' is-selected' : '')}>
            {running && <svg className="demo-card-border"><rect pathLength="100"/></svg>}
            <div className="demo-card-title"><Workflow size={14}/><b>Continuous integration</b><ChevronRight size={14}/></div>
            <code>ci.yml</code>
            <div className="demo-card-meta"><i>push</i><i>pull_request</i>{running && <i className="demo-pill-running"><LoaderCircle size={10} className="demo-spin"/>Running</i>}<span>3 jobs</span></div>
          </div>
          <div className="demo-card demo-card-extra"><div className="demo-card-title"><Workflow size={14}/><b>Release checks</b><ChevronRight size={14}/></div><code>release.yml</code><div className="demo-card-meta"><i>push</i><i>workflow_dispatch</i><span>2 jobs</span></div></div>
          <div className="demo-details">
            <div className="demo-details-head">Workflow details <GitBranch size={13}/></div>
            {jobs.map(j => { const s = jobState(j.id); return <div key={j.id} className={'demo-job is-' + s}>
              <span className="demo-job-dot">{s === 'done' ? <Check size={10} strokeWidth={3}/> : s === 'running' ? <LoaderCircle size={11} className="demo-spin"/> : <Circle size={8}/>}</span>
              <div><b>{j.name}</b><code>ubuntu-latest</code>{j.needs && <small>Needs: {j.needs}</small>}</div>
            </div> })}
          </div>
          <div className="demo-run">
            <div><span>3 jobs</span><span>Current working files</span></div>
            <span ref={runButton} className={'demo-run-button' + (pressed ? ' is-pressed' : '') + (running ? ' is-busy' : '')}>
              {running ? <><LoaderCircle size={14} className="demo-spin"/>Running…</> : <><Play size={14}/>{state === 'succeeded' ? 'Run again' : 'Run workflow'}</>}
              {pressed && <i className="demo-ripple"/>}
            </span>
          </div>
        </div>

        <div className="demo-output">
          <div className="demo-output-head">
            <div><h4>ci.yml</h4><span>act-dock-demo <i>/</i> All jobs</span>
              <p>{state === 'ready' ? 'Not run yet' : <>Today · <b>{seconds(elapsed)}</b> · Desktop · cf7605d</>}</p></div>
            <span className={'demo-badge is-' + state}>{state === 'running' ? <><LoaderCircle size={11} className="demo-spin"/>Running</> : state === 'succeeded' ? <><Check size={11}/>Succeeded</> : 'Ready'}</span>
          </div>
          <div className="demo-tabs"><span className="is-active">Output</span><span>Run details</span>{running && <span className="demo-cancel"><Square size={11}/>Cancel run</span>}</div>
          {running && current ? <div className="demo-step" key={current.step}>
            <span><LoaderCircle size={12} className="demo-spin"/>Current step</span>
            <p><code>{current.job}</code>{current.text.replace('▸ Run Main ', '')}</p>
          </div> : state === 'succeeded' ? <div className="demo-step is-done">
            <span><Check size={12}/>Completed</span><p>3 jobs passed in {seconds(RUN_END - RUN_START)}</p>
          </div> : running ? <div className="demo-step"><span><LoaderCircle size={12} className="demo-spin"/>Current step</span><p>Starting next job…</p></div> : null}
          <div className="demo-find"><Search size={13}/>Find in latest 2,000 lines…<span><Copy size={13}/><Download size={13}/></span></div>
          <div className="demo-log">
            {state === 'ready' ? <div className="demo-empty"><Terminal size={20}/><b>Ready when you are.</b><span>Run ci.yml to follow its output here.</span></div>
              : shown.slice(-40).map(l => { const n = script.indexOf(l) + 1; return <div key={n} className={'demo-line is-' + l.tone + (running && current?.step === l.step ? ' is-current' : '')}>
                <span>{n}</span><em>[{l.job}]</em><p>{l.text}</p></div> })}
          </div>
          <div className="demo-log-foot"><span>{shown.length} lines</span><span>↓ Follow output</span></div>
        </div>
      </div>
      <div className="demo-status"><span><GitBranch size={11}/>GitHub Actions via act</span><span><b className={running ? 'demo-green' : ''}>{running ? '1 running' : 'Idle'}</b> · Docker connected</span></div>
    </section>

    {cursorOn && <svg className={'demo-cursor' + (pressed ? ' is-pressed' : '')} style={{ transform: `translate(${cursorAt ? cursor.x : cursor.sx}px, ${cursorAt ? cursor.y : cursor.sy}px)`, opacity: t > 2100 ? 0 : 1 }} width="20" height="22" viewBox="0 0 20 22">
      <path d="M2 1.5v16.2l4.3-4 2.9 6.6 3-1.3-2.9-6.5h6z" fill="#fff" stroke="#111" strokeWidth="1.4" strokeLinejoin="round"/>
    </svg>}
  </div>
}

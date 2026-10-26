import { useEffect, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { ArrowUpRight } from 'lucide-react'
import { CodeBlock, SiteFooter, SiteHeader } from '@/components/site-chrome'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { repository } from '@/lib/releases'

export const Route = createFileRoute('/docs')({
  head: () => ({
    meta: [
      { title: 'Docs — Act Dock' },
      { name: 'description', content: 'Install Act Dock, run GitHub Actions locally, and connect Claude Code, Codex, Cursor, or any MCP client to your local pipeline runner.' },
    ],
    links: [{ rel: 'canonical', href: 'https://act-dock.mohammedibrahim.dev/docs' }],
  }),
  component: Docs,
})

type Platform = 'macos' | 'windows' | 'linux'
const platformNames: Record<Platform, string> = { macos: 'macOS', windows: 'Windows', linux: 'Linux' }
const runnerPath: Record<Platform, string> = {
  macos: '/Users/you/Library/Application Support/Act Dock/bin/act-dock',
  windows: 'C:\\Users\\you\\AppData\\Local\\Act Dock\\bin\\act-dock.exe',
  linux: '/home/you/.local/share/act-dock/bin/act-dock',
}
const json = (p: Platform) => `{
  "mcpServers": {
    "act-dock": {
      "command": ${JSON.stringify(runnerPath[p])},
      "args": ["mcp"]
    }
  }
}`
const clients = (p: Platform) => [
  { name: 'Claude Code', file: 'Terminal', code: `claude mcp add --scope user act-dock -- "${runnerPath[p]}" mcp` },
  { name: 'Codex', file: '~/.codex/config.toml', code: `[mcp_servers.act-dock]\ncommand = '${runnerPath[p]}'\nargs = ["mcp"]` },
  { name: 'Cursor', file: '~/.cursor/mcp.json', code: json(p) },
  { name: 'Claude Desktop', file: p === 'windows' ? '%APPDATA%\\Claude\\claude_desktop_config.json' : '~/Library/Application Support/Claude/claude_desktop_config.json', code: json(p) },
]

const sections = [
  ['overview', 'Overview'], ['install', 'Install'], ['first-run', 'Your first run'], ['mcp', 'Connect your agents'],
  ['tools', 'MCP tool reference'], ['cli', 'Command line'], ['config', 'Inputs, secrets & config'], ['runner', 'Background runner & data'],
  ['troubleshooting', 'Troubleshooting'], ['faq', 'FAQ'],
] as const

const tools: [string, string, string][] = [
  ['list_projects', '—', 'List saved projects with their IDs and paths.'],
  ['add_project', 'path', 'Register an absolute local folder. Returns the project, or the existing one if it is already saved.'],
  ['list_workflows', 'projectId', 'Discover workflows, jobs, trigger events, and manual inputs. Malformed files come back with diagnostics instead of failing the list.'],
  ['run_pipeline', 'projectId, workflowPath, event, jobId?, inputs?, eventFile?, envFile?, varFile?, secretFile?, architecture?, idempotencyKey?', 'Queue a workflow or a single job and return its run immediately. Pass idempotencyKey to make retries safe.'],
  ['list_runs', 'projectId?, state?, source?, query?, since?, cursor?, limit?', 'Run history, newest first. Filters apply before cursor and limit (max 200).'],
  ['get_run', 'runId', 'Status, timing, and result of a run.'],
  ['get_run_logs', 'runId, cursor?, limit?', 'A page of up to 2,000 log entries. Keep passing nextCursor until end is true.'],
  ['cancel_run', 'runId', 'Cancel a queued or running pipeline and clean up its containers.'],
]

const errors: [string, string][] = [
  ['DOCKER_UNAVAILABLE', 'Docker isn’t answering. Start Docker Desktop (or the Docker daemon on Linux) and try again.'],
  ['ACT_UNAVAILABLE', 'act couldn’t be found. Install it, or set its location in Settings → Dependencies.'],
  ['RUNNER_NOT_INSTALLED', 'The MCP or CLI binary can’t reach a runner. Open the desktop app once to install it.'],
  ['INPUT_REQUIRED', 'The workflow has a required workflow_dispatch input. Pass it in inputs or with --input NAME=VALUE.'],
  ['INVALID_PATH', 'Project paths must be absolute and point at an existing folder.'],
  ['INVALID_JOB', 'That job ID doesn’t exist in the selected workflow. Check list_workflows.'],
  ['INVALID_FILE', 'An event, env, var, or secret file doesn’t exist or isn’t a file. Relative paths resolve from the project folder.'],
]

function useActiveSection() {
  const [active, setActive] = useState<string>('overview')
  useEffect(() => {
    const observer = new IntersectionObserver(entries => {
      const hit = entries.filter(e => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
      if (hit) setActive(hit.target.id)
    }, { rootMargin: '-15% 0px -70% 0px' })
    for (const [id] of sections) { const el = document.getElementById(id); if (el) observer.observe(el) }
    return () => observer.disconnect()
  }, [])
  return active
}

function PlatformTabs({ value, onChange }: { value: Platform; onChange: (p: Platform) => void }) {
  return <div className="platform-tabs" role="radiogroup" aria-label="Your operating system">
    {(Object.keys(platformNames) as Platform[]).map(p => <button key={p} type="button" role="radio" aria-checked={value === p} onClick={() => onChange(p)}>{platformNames[p]}</button>)}
  </div>
}

function Docs() {
  const active = useActiveSection()
  const [platform, setPlatform] = useState<Platform>('macos')
  useEffect(() => {
    const ua = navigator.userAgent
    if (/Windows/i.test(ua)) setPlatform('windows')
    else if (/Linux/i.test(ua) && !/Android/i.test(ua)) setPlatform('linux')
  }, [])

  return <>
    <a className="skip-link" href="#main">Skip to content</a>
    <div className="site-shell"><SiteHeader/>
      <div className="docs">
        <nav className="docs-nav" aria-label="Documentation">
          <p>Documentation</p>
          {sections.map(([id, label]) => <a key={id} href={'#' + id} aria-current={active === id ? 'location' : undefined}>{label}</a>)}
        </nav>
        <main id="main" className="docs-body">
          <section id="overview">
            <p className="docs-eyebrow">Docs</p>
            <h1>Run GitHub Actions on your machine.</h1>
            <p className="docs-lead">Act Dock is a desktop workspace for <a href="https://nektosact.com">act</a>. Pick a project folder and run any workflow or job against your current files. Follow each step as it happens, and let your AI agents do the same through MCP.</p>
            <div className="docs-cards">
              <div><b>Desktop app</b><span>Choose a project, run a workflow, follow live output, and review run history.</span></div>
              <div><b>Background runner</b><span>Owns the queue and keeps pipelines running after you close the window.</span></div>
              <div><b>MCP & CLI</b><span>Give agents and scripts the same runner, queue, and logs.</span></div>
            </div>
          </section>

          <section id="install">
            <h2>Install</h2>
            <p>Act Dock drives act, and act runs your jobs in Docker containers. You’ll need both installed first.</p>
            <ol className="docs-steps">
              <li><b>Install Docker</b> and make sure it’s running. On Windows, Docker Desktop must use Linux containers.</li>
              <li><b>Install act</b> (macOS: <code>brew install act</code>). For other platforms, see the <a href="https://nektosact.com/installation/index.html">act installation guide</a>.</li>
              <li><b>Download Act Dock</b> from the <Link to="/" hash="downloads">downloads table</Link> and install it.</li>
            </ol>
            <h3>Opening an unsigned build</h3>
            <p>Releases aren’t code-signed yet, so your OS will warn you the first time you open the app.</p>
            <ul className="docs-list">
              <li><b>macOS:</b> drag Act Dock to Applications and open it. If macOS blocks it, go to System Settings → Privacy & Security and click <em>Open Anyway</em>.</li>
              <li><b>Windows:</b> if SmartScreen appears, click <em>More info</em>, then <em>Run anyway</em>. Edge WebView2 is required (it ships with Windows 11).</li>
              <li><b>Linux:</b> install the <code>.deb</code> or <code>.rpm</code> with your package manager. For the AppImage, run <code>chmod +x</code> on it first. It needs GTK 3 and WebKitGTK 4.1.</li>
            </ul>
          </section>

          <section id="first-run">
            <h2>Your first run</h2>
            <ol className="docs-steps">
              <li><b>Add a project.</b> Click <em>Add project</em> and choose a folder. Act Dock looks in <code>.github/workflows</code> for <code>.yml</code> and <code>.yaml</code> files.</li>
              <li><b>Pick a workflow.</b> Its jobs, triggers, and manual inputs appear under <em>Workflow details</em>. Run the whole workflow or choose a single job.</li>
              <li><b>Run it.</b> The workflow card gets a green outline. The pinned <em>Current step</em> bar shows the active step, and that step’s log lines are highlighted.</li>
              <li><b>Iterate.</b> Edit your files and run again. Every run is saved to <em>Run history</em>, which you can search and filter by project, status, source, and date.</li>
            </ol>
            <p className="docs-note">The first run of a workflow pulls the <code>catthehacker/ubuntu:act-latest</code> image, which can take a few minutes. Later runs reuse it.</p>
          </section>

          <section id="mcp">
            <h2>Connect your agents</h2>
            <p>Act Dock ships an MCP server over stdio. Any MCP-capable agent can register projects, start pipelines, and read their logs. Agent runs use the same queue as the app, so they wait their turn and show up in your history with an <em>MCP</em> source.</p>
            <ol className="docs-steps">
              <li><b>Open the desktop app once.</b> This installs the standalone runner binary. It doesn’t need Bun or Node.</li>
              <li><b>Copy the configuration</b> from <em>Agent connections</em> in the sidebar. It already contains the exact path for your machine.</li>
              <li><b>Add it to your agent</b> using one of the snippets below, then restart or reconnect the agent.</li>
            </ol>
            <div className="docs-toolbar"><span>Default runner location for</span><PlatformTabs value={platform} onChange={setPlatform}/></div>
            <div className="docs-clients">
              {clients(platform).map(c => <div key={c.name}><h3>{c.name}</h3><CodeBlock label={c.file} code={c.code}/></div>)}
            </div>
            <p className="docs-note">Replace <code>you</code> with your username. MCP clients don’t expand <code>~</code>, so always use an absolute path. In JSON, Windows backslashes must be escaped as shown.</p>
            <h3>What a session looks like</h3>
            <p>Ask something like <em>“Run CI for ~/code/my-app and tell me why it fails.”</em> A typical agent will:</p>
            <ol className="docs-flow">
              <li><code>add_project</code><span>{'{ "path": "/Users/you/code/my-app" }'}</span></li>
              <li><code>list_workflows</code><span>{'{ "projectId": "…" }'}</span></li>
              <li><code>run_pipeline</code><span>{'{ "projectId": "…", "workflowPath": ".github/workflows/ci.yml", "event": "push" }'}</span></li>
              <li><code>get_run</code><span>poll until the state is succeeded, failed, or cancelled</span></li>
              <li><code>get_run_logs</code><span>page through output with nextCursor and read the failing step</span></li>
            </ol>
            <p className="docs-note">There’s no arbitrary shell tool. Agents can only run workflows that exist in a project’s <code>.github/workflows</code> folder, and those run with your user permissions.</p>
          </section>

          <section id="tools">
            <h2>MCP tool reference</h2>
            <p>Every tool returns JSON. Errors come back as <code>{'{ code, message }'}</code> with one of the codes listed in <a href="#troubleshooting">Troubleshooting</a>.</p>
            <div className="docs-table"><Table><TableHeader><TableRow><TableHead>Tool</TableHead><TableHead>Parameters</TableHead><TableHead>What it does</TableHead></TableRow></TableHeader><TableBody>
              {tools.map(([name, params, desc]) => <TableRow key={name}><TableCell><code>{name}</code></TableCell><TableCell className="docs-params">{params}</TableCell><TableCell>{desc}</TableCell></TableRow>)}
            </TableBody></Table></div>
            <p className="docs-note">Run states: <code>queued</code>, <code>running</code>, <code>cancelling</code>, <code>succeeded</code>, <code>failed</code>, <code>cancelled</code>, <code>interrupted</code>. <code>architecture</code> is <code>auto</code> or <code>linux/amd64</code>. <code>source</code> is <code>desktop</code>, <code>cli</code>, or <code>mcp</code>.</p>
          </section>

          <section id="cli">
            <h2>Command line</h2>
            <p>The runner binary is also a CLI that prints JSON, which makes it useful in scripts, git hooks, and agents without MCP support. It lives at the path shown in <a href="#mcp">Connect your agents</a>.</p>
            <CodeBlock label="act-dock" code={`act-dock projects add /absolute/path/to/project
act-dock projects list
act-dock workflows list PROJECT_ID

act-dock run --project PROJECT_ID --workflow .github/workflows/ci.yml --event push
act-dock run --project PROJECT_ID --workflow .github/workflows/ci.yml --job test \\
  --input target=staging --secret-file .secrets

act-dock status RUN_ID
act-dock logs RUN_ID --follow
act-dock cancel RUN_ID

act-dock runs list --status failed --source mcp --search ci.yml
act-dock runner status | start | stop`}/>
          </section>

          <section id="config">
            <h2>Inputs, secrets & config</h2>
            <ul className="docs-list">
              <li><b>Manual inputs.</b> <code>workflow_dispatch</code> inputs appear as typed fields in the run dialog. Agents pass them in <code>inputs</code>, and the CLI uses <code>--input NAME=VALUE</code>.</li>
              <li><b>Secrets and variables.</b> Point a run at a secret, env, or variable file inside the project, such as <code>.secrets</code>. Act Dock stores the file reference, never its contents, and act masks secret values in output. Remember to add those files to <code>.gitignore</code>.</li>
              <li><b>Event payloads.</b> Supply an event JSON file to simulate a specific <code>push</code> or <code>pull_request</code> payload.</li>
              <li><b>Runner images.</b> <code>ubuntu-latest</code>, <code>ubuntu-20.04</code>, <code>ubuntu-22.04</code>, and <code>ubuntu-24.04</code> map to <code>catthehacker/ubuntu:act-latest</code>. Everything else follows your <code>.actrc</code>.</li>
              <li><b>Apple Silicon.</b> If an action ships only x86 binaries, run with architecture <code>linux/amd64</code>.</li>
            </ul>
            <p>Act Dock runs what act supports. Some GitHub-hosted features behave differently or aren’t available locally. See <a href="https://nektosact.com/usage/index.html">act’s usage guide</a> for details.</p>
          </section>

          <section id="runner">
            <h2>Background runner & data</h2>
            <p>A small background process owns the queue. It runs one pipeline at a time, in order. Closing the window doesn’t stop it. To cancel active work and shut it down, use <em>Stop runner</em> in Settings. It starts on demand, and you can also have it start at login.</p>
            <div className="docs-table"><Table><TableHeader><TableRow><TableHead>Platform</TableHead><TableHead>Data folder</TableHead></TableRow></TableHeader><TableBody>
              <TableRow><TableCell>macOS</TableCell><TableCell><code>~/Library/Application Support/Act Dock</code></TableCell></TableRow>
              <TableRow><TableCell>Windows</TableCell><TableCell><code>%LOCALAPPDATA%\Act Dock</code></TableCell></TableRow>
              <TableRow><TableCell>Linux</TableCell><TableCell><code>$XDG_DATA_HOME/act-dock</code> (default <code>~/.local/share/act-dock</code>)</TableCell></TableRow>
            </TableBody></Table></div>
            <ul className="docs-list">
              <li>Projects, settings, and run history live in SQLite. Logs are stored per run as JSONL.</li>
              <li>Clients connect through a private Unix socket, or a per-user named pipe on Windows, with an installation key. No network port is opened.</li>
              <li>Completed runs are kept for 30 days, up to 200 runs. Runs interrupted by a shutdown aren’t retried automatically.</li>
            </ul>
          </section>

          <section id="troubleshooting">
            <h2>Troubleshooting</h2>
            <div className="docs-table"><Table><TableHeader><TableRow><TableHead>Error code</TableHead><TableHead>What to do</TableHead></TableRow></TableHeader><TableBody>
              {errors.map(([code, fix]) => <TableRow key={code}><TableCell><code>{code}</code></TableCell><TableCell>{fix}</TableCell></TableRow>)}
            </TableBody></Table></div>
            <p>Still stuck? <a href={repository + '/issues'}>Open an issue</a> and include the run’s exported log.</p>
          </section>

          <section id="faq">
            <h2>FAQ</h2>
            <dl className="docs-faq">
              <dt>Do I need a GitHub account?</dt><dd>No. Everything runs locally, and there’s no sign-in or hosted service.</dd>
              <dt>Does it commit or push anything?</dt><dd>No. Workflows run against the files on disk, including uncommitted changes.</dd>
              <dt>Can I run several pipelines at once?</dt><dd>Runs from the app, CLI, and agents share one queue and run one at a time, so they don’t compete for Docker resources.</dd>
              <dt>Where’s the source?</dt><dd>Source, releases, and checksums are on <a href={repository}>GitHub <ArrowUpRight size={12}/></a>.</dd>
            </dl>
          </section>
        </main>
      </div>
      <SiteFooter/>
    </div>
  </>
}

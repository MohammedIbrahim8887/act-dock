# Act Dock

Run GitHub Actions locally from a desktop workspace, a CLI, or your AI agents. Select a project, run a workflow or job against your current files, and follow its output and current step. A background runner keeps working when the app closes.

**[Download Act Dock](https://act-dock.mohammedibrahim.dev/#downloads)** · [Docs](https://act-dock.mohammedibrahim.dev/docs) · [Releases and checksums](https://github.com/MohammedIbrahim8887/act-dock/releases) · [Report an issue](https://github.com/MohammedIbrahim8887/act-dock/issues)

## Downloads

| Platform | Package | Requirements |
| --- | --- | --- |
| macOS Apple Silicon | [DMG](https://github.com/MohammedIbrahim8887/act-dock/releases/latest/download/macos-arm64-ActDock.dmg) | macOS 14+ |
| Windows x64 | [Installer](https://github.com/MohammedIbrahim8887/act-dock/releases/latest/download/windows-x64-ActDock-Setup.exe) | Windows 10+, Edge WebView2 |
| Linux x64 | [DEB](https://github.com/MohammedIbrahim8887/act-dock/releases/latest/download/linux-x64-ActDock.deb) | Ubuntu 24.04+ or Debian 13+ |
| Linux x64 | [RPM](https://github.com/MohammedIbrahim8887/act-dock/releases/latest/download/linux-x64-ActDock.rpm) | Fedora 40+ with WebKitGTK 4.1 |
| Linux x64 | [AppImage](https://github.com/MohammedIbrahim8887/act-dock/releases/latest/download/linux-x64-ActDock.AppImage) | glibc 2.39+, GTK 3, WebKitGTK 4.1, Ayatana AppIndicator, librsvg |

Installers are not notarized. The macOS app is ad-hoc signed during packaging so Gatekeeper offers **Open Anyway** (System Settings → Privacy & Security); builds up to v0.2.2 shipped an unsealed bundle that macOS reports as "damaged" — clear it with `xattr -dr com.apple.quarantine "/Applications/Act Dock.app"` or upgrade. Windows packages are assembled from the pinned native Electrobun 2.0.5 core; Windows GUI verification requires a Windows machine. The AppImage uses system GTK/WebKit libraries and is not a universal bundle for older distributions.

Every installer bundles a pinned, checksum-verified [act](https://github.com/nektos/act) engine (v0.2.89, MIT; license shipped as `act-LICENSE.txt`), so there's no separate act install. Docker is the only requirement: install it and start the daemon before running pipelines. Windows needs Linux containers in Docker Desktop. A custom act executable set in **Settings → Dependencies** overrides the bundled one.

## In the app

- Pick a folder and discover `.github/workflows/*.yml` or `*.yaml`. Invalid workflows report individual diagnostics.
- Select a workflow or job, event, typed manual inputs, optional event/env/variable/secrets files, and container architecture.
- Queue runs with explicit waiting reasons, follow durable live logs, search/copy/export output, cancel, and run again. Green outlines and a current-step summary identify active work.
- Search run history and filter by project, status, source, and date, with counted pagination.
- Copy an MCP configuration from **Agent connections**, or use the same runner through the CLI.

Run configurations store file references rather than secret contents. Workflows run against current working files. The app honors managed `.actrc` preferences. Ubuntu labels resolve independently: `ubuntu-latest` and `ubuntu-24.04` use `catthehacker/ubuntu:act-24.04`, while 22.04 and legacy 20.04 use their matching tags. Medium remains the default; full/custom images are optional. This is local GitHub Actions execution with [act's supported functionality](https://nektosact.com/usage/index.html).

## Execution preferences

Global settings, recognized `.actrc` flags, project preferences and explicit run overrides share one validated execution contract. **Project settings** contains runner mappings, optional npm/pnpm/Bun download caches, reservations, cache maintenance, and **Secrets & environment**. The run dialog previews effective configuration and provenance. Copied workspaces and fresh containers remain the default; `auto` architecture follows Docker's Linux architecture.

Image pulls default to `if-missing`; compatible cached images need no registry request. Action sources use immutable project snapshots: pinned commits are reused, floating refs refresh after 24 hours, and **Cached sources only** refuses acquisition. pnpm needs the documented `--store-dir /var/cache/act-dock/pnpm` command in your workflow; commands are never rewritten.

Saved project secrets live in macOS Keychain, Windows Credential Manager, or Linux Secret Service. Only names and opaque references enter SQLite/history. Existing secret files work; selected saved secrets override them, then unsaved run values take precedence. Unsaved values are lost on runner restart and must be resupplied. Background reads never request an unlock dialog; unlock/authorize the vault or replace a secret when access is unavailable. Linux file-backed secrets remain usable without Secret Service.

Workflow concurrency is opt-in (initially two, configurable 1–8). Shared worktrees, Act namespaces, writable caches and uncertain resources serialize. CPU/RAM reservations govern admission against 75% of Docker capacity; they are not hard container limits. Ambiguous resources remain visible and are never deleted automatically.

See [optimization architecture and verification](docs/research/act-engine/optimization/README.md) for contracts, reproducible benchmarks and platform release gates. Official Act remains the shipping engine; the isolated readiness patch is research only. No release is triggered by these local changes.

## AI agents (MCP)

Open the packaged app once to install the standalone runner, then copy its configuration from **Agent connections**. Use the absolute executable path displayed there:

```json
{
  "mcpServers": {
    "act-dock": {
      "command": "/absolute/path/to/act-dock",
      "args": ["mcp"]
    }
  }
}
```

Windows uses `act-dock.exe`; JSON configurations must escape backslashes. No Bun installation is required for the packaged runner. Agents can register local folders and enqueue workflows without desktop confirmation. No arbitrary shell-command MCP tool is exposed.

| Tool | Purpose |
| --- | --- |
| `list_projects` | List saved projects |
| `add_project` | Register an absolute local folder |
| `list_workflows` | Discover workflows and diagnostics |
| `run_pipeline` | Enqueue a workflow or job and return a run ID |
| `list_runs` | Read history with optional filters |
| `get_run` | Inspect status and results |
| `get_run_logs` | Read logs with reconnect cursors |
| `cancel_run` | Cancel queued or active work |
| `check_health` | Check Docker, the act engine, the job image, disk space, and GitHub access, with a fix for each problem |
| `get_capabilities`, `get_runner_snapshot` | Negotiate features and begin an event subscription |
| `preflight_run` | Preview effective setup, provenance, dependencies, images, caches and secret names |
| `list_runner_images`, `inspect_image`, `list_image_operations` | Inspect presets, platform compatibility and preparation |
| `pull_image`, `cancel_image_pull` | **Mutating:** start/cancel shared image downloads |
| `list_caches` | Inspect project cache metadata and leases |
| `clear_cache`, `refresh_project_cache` | **Mutating:** remove inactive app-owned caches |
| `list_project_secrets` | Read names, grants and revisions; never values |
| `read_events`, `get_run_metrics` | Resume progress and resource samples with cursors |


## Bun workspace

- `apps/desktop/`: Electrobun 2.0.5 + React + shadcn/ui, standalone Bun runner, CLI/MCP, SQLite, platform packaging.
- `apps/web/`: TanStack Start + React + shadcn/ui, served by Cloudflare Workers.
- `scripts/`: local CI, release orchestration, verified platform bundles, and self-hosted runner installation.
- `.github/workflows/ci.yml`: checks executed locally with act through Act Dock.
- `.github/workflows/release.yml`: pushes to `main` publish through a self-hosted runner on the owner's Mac.

Use Bun 1.3.14 and Go 1.25.0 for the bundled native helper. End users need neither toolchain. Hutch remains pinned in the desktop app. Install Hutch using its official installer if it is not already on PATH:

```sh
curl -fsSL https://hutch.blackboard.sh/hutch/install.sh | sh
bun install --frozen-lockfile
bun run prepare:desktop
bun run dev:desktop
```

Run the website with `bun run dev` (use the local URL Vite prints). Checks and builds:

```sh
bun run typecheck
bun run test
bun run build:web
bun run build:desktop
bun run ci:local
```

`ci:local` adds this repository to Act Dock, enqueues the Local CI workflow, streams masked output, and exits with its result. It uses the same runner and queue as the app and MCP. A running user pipeline finishes before queued CI begins.

CLI examples:

```sh
bun run cli projects list
bun run cli projects add /absolute/project/path
bun run cli workflows list PROJECT_ID
bun run cli run --project PROJECT_ID --workflow .github/workflows/ci.yml --event push
bun run cli runs list --status failed --source mcp --search ci.yml
bun run cli status RUN_ID
bun run cli logs RUN_ID --follow
bun run cli cancel RUN_ID
bun run cli doctor
bun run cli images list
bun run cli cache list --project PROJECT_ID
bun run cli secrets list --project PROJECT_ID
# Read unsaved run overrides as a JSON object on stdin:
bun run cli run --project PROJECT_ID --workflow .github/workflows/ci.yml --secrets-stdin < run-overrides.json
# After a restart, resupply a queued run with a JSON object on stdin:
bun run cli secrets resupply RUN_ID < run-overrides.json
bun run cli events RUN_ID --cursor 0 --wait 10000
bun run cli metrics RUN_ID
bun run cli runner status
```

## Local releases on main

The GitHub workflow uses only the `self-hosted, act-dock-release, macOS, ARM64` runner. It does not consume GitHub-hosted Actions minutes. PRs do not trigger the release job.

To install or reconnect that runner on an Apple Silicon Mac, authenticate `gh` to this repository, authenticate Wrangler to the Cloudflare account, have Docker running, then run:

```sh
bun run install:release-runner
```

A user LaunchAgent keeps the release runner online. Its installation, GitHub credentials, and service logs live outside the repository under `~/Library/Application Support/Act Dock/release-runner`. Job workspaces use `~/.local/share/act-dock-release-work` to avoid spaces in GitHub shell paths. Remove or unload `~/Library/LaunchAgents/sh.actdock.release-runner.plist` to stop automatic local releases. When this Mac is offline, a release waits in GitHub’s queue. Once started, it waits up to 15 minutes for Docker before reporting a dependency error.

For every push to `main`, the job runs `bun run release`. It creates an isolated checkout, chooses a new patch version (honoring a higher source version), runs CI through Act Dock, builds all five installer formats, generates SHA-256 checksums and a download manifest, publishes one GitHub Release, and deploys the website with Wrangler. A failed build leaves the public release unchanged. Version stamps stay in the isolated checkout, preserving a clean source tree.

The act engine is pinned in `scripts/act.ts` (version plus per-platform SHA-256 from the release's `checksums.txt`). Builds download it into the app's `Resources/app/` beside the runner, and the desktop app installs both into the data folder's `bin/`. To upgrade act, bump the version and all three hashes together.

macOS uses the existing custom Finder DMG. Windows is bundled with the verified native Electrobun core and Bun runtime, then packaged with NSIS. Linux uses the verified native core and Bun runtime, then Docker builds DEB, RPM, and AppImage packages. This avoids a Rosetta limitation in Hutch's x64 Linux executable on Apple Silicon; the normal native Hutch workflow remains available on native hosts. Package outputs live in ignored `artifacts/` directories.

The web app obtains a short-lived cached manifest from the latest published GitHub Release. Its download buttons link to exact versioned assets; unpublished package formats show **Build pending**. `apps/web/wrangler.jsonc` binds the personal Cloudflare account and `act-dock.mohammedibrahim.dev` custom domain.

## Local data

macOS uses `~/Library/Application Support/Act Dock`, Linux uses `$XDG_DATA_HOME/act-dock` (default `~/.local/share/act-dock`), and Windows uses `%LOCALAPPDATA%\Act Dock`. SQLite metadata, user settings, and per-run JSONL logs persist there. `ACT_DOCK_DATA_DIR` provides an isolated data directory for tests.

Clients use a private Unix socket on macOS/Linux and a per-user named pipe on Windows, plus a private installation key. No TCP port is exposed. Start at login uses a macOS LaunchAgent, a Linux user autostart entry, or a Windows user Startup command. Closing the desktop app leaves the runner working; **Stop runner** explicitly cancels active work. Completed runs are retained for 30 days, up to 200. Interrupted runs are not retried automatically.

## Engineering research

See the [execution-engine feasibility study](docs/research/act-engine/README.md) for the comparison of keeping Act, expanding orchestration, or building an engine, with reproducible benchmarks and REA findings.

# Act Dock

A macOS-first Electrobun app for running local GitHub Actions with `act`. Includes a persistent background runner, CLI, and MCP stdio server for local AI agents. The React interface uses shadcn/ui with grayscale light and dark themes and green indicators for running pipelines.

## Requirements

- macOS (the packaged build targets your current architecture).
- [Hutch](https://framework.blackboard.sh/electrobun/) 0.28.2 and Bun on your PATH for development.
- [act](https://nektosact.com/installation/index.html) and a running Docker engine for real workflows. On macOS, `brew install act` installs act; install and start your preferred Docker engine separately.

Act Dock checks dependencies and reports missing executables or Docker connectivity. It does not install dependencies automatically. Standard Ubuntu runner labels map to `catthehacker/ubuntu:act-latest`; the first run may download a sizable image. macOS/Windows runners and reusable-workflow-only jobs are not supported in v1.

## Development

```sh
hutch install
hutch run dev:hmr
```

The desktop application starts the runner automatically. For browser-only UI development, use two terminals:

```sh
bun run cli runner start
bunx vite --host 127.0.0.1
```

The Vite bridge exists only during development. Production uses typed Electrobun RPC and a user-only Unix socket, without a network listener.

```sh
bun run typecheck
bun test
bun run build:ui
bun run build:runner
hutch run build
# Optional preview channel
hutch run build:canary
```

The stable macOS `.app` is emitted under `build/stable-macos-arm64/` on Apple Silicon. The branded drag-to-Applications installer is `artifacts/macos-arm64-ActDock.dmg`; canary builds use `artifacts/canary-macos-arm64-ActDock-canary.dmg`. They are local unsigned builds; notarization, signing, and hosted updates are not configured.

## Desktop use

1. Click **Add project**, choose a folder with the native picker or built-in folder browser, then confirm **Add project**. No path typing is required.
2. Select a workflow and click **Run workflow**.
3. Choose the trigger, optional job, and manual inputs. Expand **Files and runner options** for event JSON, environment/variable/secrets files, and architecture.
4. Follow or pause output, search/copy visible lines, export complete logs, cancel, or run again.

Project-relative file references resolve from the project directory. Normal act configuration (including `.actrc`, `.env`, and `.secrets`) still applies. Act Dock forces secret masking and supplies explicit runner mappings. The Run details tab records the generated argument vector; act may add settings from its own configuration files.

The runner executes current working files without checking out branches. Workflows can affect files, containers, networks, and external services with your user's permissions. Closing the desktop app does not cancel pipelines. **Settings → Stop runner** explicitly cancels queued/active work. Start at login is optional and defaults off.

## CLI

During development prefix commands with `bun run cli`. After opening the packaged desktop app once, the stable executable is:

```text
~/Library/Application Support/Act Dock/bin/act-dock
```

```sh
bun run cli projects add /absolute/path/to/project
bun run cli projects list
bun run cli workflows list PROJECT_ID
bun run cli run --project PROJECT_ID --workflow .github/workflows/ci.yml --event push
bun run cli run --project PROJECT_ID --workflow .github/workflows/manual.yml \
  --event workflow_dispatch --input environment=development --secret-file .secrets
bun run cli runs list --project PROJECT_ID --limit 100 --cursor 0
bun run cli status RUN_ID
bun run cli logs RUN_ID --follow
bun run cli cancel RUN_ID
bun run cli runner status
bun run cli runner stop
```

Use `--help` for all supported flags. Commands return JSON, except `logs --follow` and help. History cursor is an offset; log cursors are monotonically increasing per-run sequence numbers. `run` returns immediately with a queued run ID. Optional `--idempotency-key` deduplicates equivalent requests while retained; reuse with a different request returns an error.

## MCP

Open **Agent connections** for configuration with the resolved absolute executable path. Example after opening the packaged app:

```json
{
  "mcpServers": {
    "act-dock": {
      "command": "/Users/YOUR_USER/Library/Application Support/Act Dock/bin/act-dock",
      "args": ["mcp"]
    }
  }
}
```

For source development use an absolute Bun executable as `command` and `["/absolute/path/to/act-dock/src/cli/index.ts", "mcp"]` as `args`.

Tools: `list_projects`, `add_project`, `list_workflows`, `run_pipeline`, `list_runs`, `get_run`, `get_run_logs`, `cancel_run`. Tool input schemas are available through MCP discovery. Agents can add any absolute local folder and execute its workflows without per-run desktop prompts. There is no arbitrary shell-command tool. MCP writes protocol messages only to stdout and works with the desktop app closed.

## Data and lifecycle

State lives in `~/Library/Application Support/Act Dock`: versioned SQLite metadata, indexed JSONL logs, a private socket, runner diagnostics, and the installed CLI. `ACT_DOCK_DATA_DIR` overrides this location for isolated testing. File references are persisted; secrets-file contents are not stored in metadata. Act's secret masking remains enabled.

One workflow runs at a time, FIFO. Cancellation signals the process group, escalating after five seconds, then removes only containers carrying that run's `act-dock.run` label. Arbitrary containers created by workflow scripts are outside that labeling mechanism. If the runner crashes, formerly active work is marked interrupted and is not retried. Review potentially orphaned workflow processes/containers before running again. Queued work resumes after restart.

Completed runs expire after 30 days, capped at 200. Project removal keeps history and never deletes project files. Runner updates wait until queued/active work has drained; if busy when the app opens, the replacement is deferred until a later app launch. Start at login uses a per-user LaunchAgent named `sh.actdock.runner`.

## Verification

The test suite uses isolated fake act/Docker executables. It covers YAML errors, inputs, runner labels, path escapes, FIFO execution, partial stdout chunks, stderr, log cursors, cancellation, idempotency conflicts, restart recovery, retention, concurrent startup, and MCP/CLI interoperability. It does not run a real Docker workflow.

For a labeled, isolated UI fixture run `bun scripts/preview-fixture.ts`, then launch Vite with the printed `ACT_DOCK_DATA_DIR`. Its pipeline output is simulated and it never writes to the production database.

The frontend uses React 19 to match the current shadcn components' ref handling. Electrobun remains pinned at 2.0.5.

## Branded macOS installer

Open the disk image, drag **Act Dock** onto **Applications**, eject the disk image, and open the app from Applications. The installer uses the selected Pipeline Loop logo, a Retina background, native draggable Finder items, a custom Applications-folder alias icon, and the matching Dock icon. The DMG contains the expanded runnable app rather than a setup wrapper, so copying it is the complete installation step.

macOS release builds generate artwork and iconsets in the `preBuild` hook and create the branded DMG in `postPackage`. This keeps Electrobun’s update archive intact. Build-only requirements are Xcode Command Line Tools (`swift`, `sips`, `iconutil`, `hdiutil`) and [uv](https://docs.astral.sh/uv/). The installer packaging command uses uv’s isolated environment with `dmgbuild==1.6.7`; these tools are not runtime requirements for people installing the app.

```sh
# Complete stable release with branded native installer
hutch run build
# Regenerate brand/icon artwork only
bun run build:brand
# Repackage an already-built stable application archive
bun run installer:mac
# Mount read-only, verify Finder layout/icons/alias/payload, then unmount
bun run verify:installer
```

`assets/brand/` contains the approved source, transparent symbol, app icon, and image-generation provenance. `assets/macos/installer-layout.json` shares coordinates between the background renderer and Finder settings. The build also emits `artifacts/macos-arm64-ActDock-preview.png` as an artwork/layout preview. macOS supplies the real window chrome and native icon rendering.

## Run history filters and pagination

Run history searches workflow filenames, project names, job IDs, and run IDs. Combine project, status, starter (Desktop / CLI / AI agent), and creation-date filters. Choose 10, 25, 50, or 100 rows per page; counts and page boundaries reflect the complete matching history. Filters/page selection remain when you open a run and return. Removed projects stay available as history filters. If results shrink while a page is open, the page is clamped to the last matching page.

The existing MCP `list_runs` tool also accepts `state`, `source`, `query`, and `since` (UTC ISO timestamp), retaining its array response and cursor/limit semantics. Equivalent CLI filters:

```sh
bun run cli runs list --status failed --source mcp --search ci.yml --limit 25 --cursor 0
```

The desktop uses `get_run_history` for counted pages and `browse_folders` for folder-only navigation. These internal service methods share validated schemas; folder browsing does not add projects or read file contents. In browser development the built-in folder browser replaces the unavailable OS dialog.

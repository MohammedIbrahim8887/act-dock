# Act Dock

## Platform
Electrobun 2.0.5 desktop app for macOS Apple Silicon, Windows x64, and Linux x64, with a React webview and independent Bun background runner. The Bun workspace also contains a TanStack Start landing page hosted on Cloudflare Workers.

## People and purpose
Developers and their local AI agents run GitHub Actions against local working files, inspect results, and iterate without pushing commits. Successful use means adding a project, finding a workflow, running it, and understanding its result from logs.

## Confirmed behavior
Saved local projects, workflow/job discovery, manual inputs, file-based environment/secrets, FIFO execution, cancellation, persisted history, CLI and MCP stdio. Agents may register any local folder and run without per-run prompts. Closing the desktop app preserves runs. On-demand startup is default; macOS login startup is optional.

## Constraints
Electrobun 2.0.5 and Hutch; shadcn/ui components; grayscale light/dark themes following the system by default, with green reserved for actively running pipelines. System fonts, accessible keyboard controls, and labeled status icons. No workflow editor, remote runners, hosted service, or GitHub login. Signing and notarization are outside v1.

## Project selection and history
Projects are selected using the native folder picker or the built-in folder browser, then explicitly confirmed; path typing is not required. Run history supports literal workflow/project/job/ID search, project/status/starter/date filters, counted pagination, and 10/25/50/100 rows per page. Filters and page selection survive opening a run and returning; removed projects remain filterable in retained history.

## Running feedback
Running workflows have a green animated outline, visible Running label, green status/count indicators, and a pinned current-step summary above output. Highlight the current step's log section while retaining readable neutral text. Parallel and nested steps follow act's lifecycle messages. Completed, queued, and cancelling runs use neutral status treatments. Reduced motion preserves the green outline without animation.

## Distribution and releases
The personal repository is MohammedIbrahim8887/act-dock. Public downloads live on GitHub Releases and are linked from https://act-dock.mohammedibrahim.dev. Packages include DMG, Windows installer, DEB, RPM, and AppImage. Native macOS and Linux startup can be checked locally; Windows GUI verification requires a Windows host. Main releases use a self-hosted runner on the owner's Mac, run checks through Act Dock, select a new patch version, publish installers and a checksummed manifest, and deploy the site without GitHub-hosted Actions minutes.

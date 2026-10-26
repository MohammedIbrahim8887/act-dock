# Act Dock

## Platform
macOS-first Electrobun 2.x desktop app with a React webview and independent Bun background runner.

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

# Act Dock

## Platform
macOS-first Electrobun 2.x desktop app with a React webview and independent Bun background runner.

## People and purpose
Developers and their local AI agents run GitHub Actions against local working files, inspect results, and iterate without pushing commits. Successful use means adding a project, finding a workflow, running it, and understanding its result from logs.

## Confirmed behavior
Saved local projects, workflow/job discovery, manual inputs, file-based environment/secrets, FIFO execution, cancellation, persisted history, CLI and MCP stdio. Agents may register any local folder and run without per-run prompts. Closing the desktop app preserves runs. On-demand startup is default; macOS login startup is optional.

## Constraints
Electrobun 2.0.5 and Hutch; shadcn/ui components; strictly grayscale light/dark themes following the system by default. System fonts, accessible keyboard controls, and labeled status icons. No workflow editor, remote runners, hosted service, or GitHub login. Signing and notarization are outside v1.

## Project selection and history
Projects are selected using the native folder picker or the built-in folder browser, then explicitly confirmed; path typing is not required. Run history supports literal workflow/project/job/ID search, project/status/starter/date filters, counted pagination, and 10/25/50/100 rows per page. Filters and page selection survive opening a run and returning; removed projects remain filterable in retained history.

# Connection setup

## Locate the runner

Prefer the exact executable shown in Act Dock → Agent connections. If shell access is available, check for `act-dock` on PATH, then test the applicable location below. Resolve environment variables and the home directory to an absolute path; do not blindly copy placeholders into client config.

| OS | Installed executable |
| --- | --- |
| macOS | `$HOME/Library/Application Support/Act Dock/bin/act-dock` |
| Linux | `${XDG_DATA_HOME:-$HOME/.local/share}/act-dock/bin/act-dock` |
| Windows | `%LOCALAPPDATA%\Act Dock\bin\act-dock.exe` |

`ACT_DOCK_DATA_DIR`, when explicitly configured, overrides the data directory: use its `bin/act-dock` (or `bin/act-dock.exe`). Only inspect relevant path variables, not the full environment. If the executable is absent, ask the user to install Act Dock from https://act-dock.mohammedibrahim.dev/#downloads and open it once. Do not download or execute unverified scripts. Start Docker and run the resolved executable with `doctor`. CLI use requires no MCP configuration.

## Optional persistent MCP setup

Use the client's installed version/help or official docs to confirm its configuration format. Explain the proposed change and obtain permission before changing agent configuration. Merge the `act-dock` entry without deleting other servers. Use an absolute executable path, quote paths with spaces for shell commands, and escape Windows backslashes in JSON. No authentication token or HTTP URL is needed: this is a local stdio server.

For clients using `mcpServers` (including Cursor's `.cursor/mcp.json` and Claude Code's project `.mcp.json`):

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

For Codex's `config.toml`, merge:

```toml
[mcp_servers.act-dock]
command = "/absolute/path/to/act-dock"
args = ["mcp"]
```

Do not assume other clients (including VS Code) use `mcpServers`; some use `servers` and an explicit `type = stdio`/`"type": "stdio"`. Follow their current schema. Ask whether configuration should be project-local or user-wide if the scope is unclear. Do not commit personal absolute paths or overwrite config. Restart/reconnect the agent after setup, then verify by calling `list_projects` or `check_health`. If tools cannot be refreshed in the current session, use the CLI and explain that MCP verification remains pending.

## Installing this skill

From a public checkout containing `skills/act-dock/SKILL.md`:

```sh
npx skills add MohammedIbrahim8887/act-dock --skill act-dock
```

The Skills CLI prompts for available agents and installation scope. Use `-g` only when the user wants user-wide installation. Reload the agent if it does not discover new skills automatically. Agent skill support varies by client/version; use the CLI's supported targets rather than promising universal native support. Agents with local shell access can use the CLI route; sandboxed/hosted agents need Act Dock and Docker in that same environment.

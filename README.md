# Chatgpt Sol Local Bridge: Community Archive
[![M8ven Verified](https://m8ven.ai/badge/mcp/pandorka132-chatgpt-sol-local-bridge-1b2wqo?variant=verified&v=ebeafb09d42a4bbda45892e6fb8460ff)](https://m8ven.ai/mcp/pandorka132-chatgpt-sol-local-bridge-1b2wqo?s=readme)

A production-grade, cross-platform implementation of the original **ChatGPT Web → OpenAI Secure MCP Tunnel → local workstation** workflow.

It exposes the same **44 MCP tools** as the full macOS reference implementation while supporting macOS, Linux, and Windows through platform adapters. ChatGPT can read and edit projects, run git/tests/builds, supervise processes, drive browsers and native applications, work with Office files, and optionally delegate to local Codex.

The local MCP endpoint binds to loopback by default. Tunnel connectivity is initiated outbound by `tunnel-client` over HTTPS—no public port or inbound firewall rule is required. Invoked tools such as `web_fetch`, browsers, package managers, project scripts, Codex, and tests may make their own outbound connections.

> [!IMPORTANT]
> This bridge gives an AI agent the authority of the local user running it. The no-delete layer is a strong policy seatbelt with exact, expiring approval tokens; it is **not an OS sandbox**. For sensitive work, use a dedicated OS account, VM/container, filesystem snapshots, limited workspace roots, and—when available—an independent external approval verifier.

---
# Credits
This repository is an archive of the original mingrath/chatgpt-sol-local-bridge project.

The original repository is currently unavailable at its former GitHub URL. This archive preserves the project for existing users and anyone interested in continuing its development.

This is an independent community archive and is not affiliated with or endorsed by the original author or OpenAI.

The original MIT license and copyright notice are retained.

## Why this exists

ChatGPT can reason about a bug, but without tools a human still has to copy patches, run commands, paste logs, switch to a browser, and report results. This bridge closes that execution loop while keeping the workstation private:

- Operate a development machine from ChatGPT Web—including from another device.
- Reuse the ChatGPT product surface as the orchestrator while keeping local Codex optional.
- Avoid public tunnel URLs and inbound network exposure.
- Keep tool authority, workspace roots, output limits, and destructive approvals under code you control.
- Preserve the original rule: **create/update/edit are allowed; delete/reset/quit must be previewed and confirmed first**.

ChatGPT and Codex limits/billing are product- and plan-dependent and can change. `codex_run` always uses the local Codex CLI and therefore consumes the Codex usage pool associated with that CLI authentication.

## Architecture

```text
ChatGPT Web / desktop browser
           │
           ▼
OpenAI-hosted Secure MCP Tunnel endpoint
           ▲
           │ outbound HTTPS :443 only
           │
     tunnel-client (local)
           │ loopback HTTP
           ▼
 http://127.0.0.1:8765/mcp
 chatgpt-sol-local-bridge
           │
 ┌─────────┼─────────────┬──────────────┐
 │         │             │              │
files/git  processes   browser/CDP   OS adapter
projects   Codex CLI   Penpot web    macOS/Linux/Windows
```

The bridge and tunnel are separate processes so they can be tested, restarted, logged, and supervised independently.

## Exact 44-tool contract

The tool names are frozen and contract-tested:

| Family | Tools |
|---|---|
| Policy | `bridge_instructions`, `confirm_destructive`, `pending_destructive`, `penpot_status` |
| Workspace | `workspace_list`, `workspace_open`, `workspace_add_root`, `workspace_tree`, `workspace_snapshot` |
| Files | `read_file`, `search_text`, `write_file`, `apply_patch`, `edit_file` |
| Git | `git_status`, `git_diff`, `git_log`, `git_run` |
| Project | `project_test`, `project_lint`, `project_typecheck`, `project_build`, `project_dev` |
| Process/system | `shell`, `process_start`, `process_list`, `process_logs`, `process_stop`, `codex_run`, `health`, `system_info` |
| Desktop/network/docs | `dom_cdp`, `accessibility`, `input_event`, `vision`, `window`, `clipboard`, `notification`, `file_dialog`, `screen_record`, `audio`, `scheduler`, `web_fetch`, `office` |

`project_*` uses documented heuristics for Node/npm/pnpm/yarn/bun, Python/uv, Rust/Cargo, and Go projects; an explicit `command` override remains available. It does not implicitly download TypeScript. `office` reads and writes DOCX/XLSX cross-platform using document libraries rather than requiring Microsoft Office.

## Platform support

| Capability | macOS | Linux | Windows |
|---|---|---|---|
| Files/git/project/process/Codex | Native | Native | Native |
| Browser `dom_cdp` | `interceptor` | `interceptor` | `interceptor` |
| Native accessibility/input/window | `interceptor macos` | `xdotool`/`wmctrl` (X11; compositor-dependent on Wayland) | PowerShell + Windows UI Automation/Win32 |
| Screenshot/OCR | interceptor or `screencapture`; Tesseract | grim/gnome-screenshot/scrot + Tesseract | System.Drawing + Tesseract |
| Clipboard/dialog/notification | native macOS | wl-clipboard/xclip, zenity/kdialog, notify-send | PowerShell/WinForms |
| Screen/audio | ffmpeg + avfoundation/afplay | ffmpeg + X11/PulseAudio | ffmpeg gdigrab/dshow/ffplay |
| Scheduler | launchd | systemd user timers | Windows Task Scheduler |
| Always-on user service | LaunchAgent | systemd `--user` | per-user Scheduled Tasks |

Every tool is registered on every OS. If an optional backend is missing, the tool returns a clear capability-unavailable error and `npm run doctor` reports the dependency.

Wayland intentionally prevents some global input/window operations. Exact support depends on the compositor and portal permissions; this cannot be bypassed safely by an application.

Optional backend examples:

```bash
# macOS
brew install ripgrep ffmpeg tesseract
ffmpeg -f avfoundation -list_devices true -i ""  # discover capture devices

# Ubuntu/Debian X11 (choose Wayland equivalents where appropriate)
sudo apt install ripgrep ffmpeg tesseract-ocr xdotool wmctrl wl-clipboard xclip zenity libnotify-bin scrot
```

On Windows, install Node/Git/tunnel-client and place optional `interceptor`, ffmpeg, Tesseract, and Codex executables on PATH before service installation. Discover DirectShow devices with `ffmpeg -list_devices true -f dshow -i dummy`. Linux screen recording currently uses X11 (`DISPLAY` and optional `SCREEN_SIZE`); Wayland screenshots can use `grim`, but recording depends on compositor/portal support.

---

## Quick start: local server

### 1. Requirements

Required:

- Node.js 20+
- Git
- `tunnel-client` from OpenAI
- An eligible ChatGPT web account with Developer Mode available (managed workspaces may require an admin grant)
- An OpenAI Platform organization with tunnel permissions and a runtime API key

Recommended/optional:

```bash
# macOS examples
brew install openai/tools/tunnel-client
brew install ripgrep ffmpeg tesseract
# interceptor and codex are optional integrations
```

Windows users should install the current `tunnel-client` release from [openai/tunnel-client](https://github.com/openai/tunnel-client/releases).

### 2. Install

```bash
git clone https://github.com/Pandorka132/chatgpt-sol-local-bridge.git
cd chatgpt-sol-local-bridge
npm ci
cp .env.example .env
```

Edit `.env` and grant only the directories ChatGPT actually needs:

```dotenv
HOST=127.0.0.1
PORT=8765
WORKSPACE_ROOTS=/Users/you/projects
DEFAULT_WORKSPACE=/Users/you/projects
ALLOW_TOOL_ROOT_REGISTRATION=false
INCLUDE_COMMON_WORKSPACE_ROOTS=false
DESTRUCTIVE_APPROVAL_MODE=chat
```

On Windows, separate multiple roots with `;`. On macOS/Linux, use `:`.

Workspace roots constrain the structured file/Office tools and command working directories; they are not a filesystem sandbox for absolute paths used inside `shell`, project scripts, browser tools, or Codex. `workspace_add_root` exists for contract compatibility but is disabled by default because allowing the model to expand its own filesystem authority is unsafe. No Desktop/Documents/home-directory roots are implicit unless `INCLUDE_COMMON_WORKSPACE_ROOTS=true`. Add roots to `.env`, or explicitly opt into broader authority only if you accept that risk. `DEFAULT_WORKSPACE` accepts exactly one directory, not a delimiter-separated list.

### 3. Diagnose, start, and smoke-test

```bash
npm run doctor
npm start
```

In another terminal:

```bash
npm run smoke
```

Expected result: exactly 44 tools, a write/read/edit round trip in a unique directory under `BRIDGE_SCRATCH_DIR`, a blocked destructive command, and a successful single-use confirmation.

Health endpoints:

```bash
curl http://127.0.0.1:8765/healthz
curl http://127.0.0.1:8765/readyz
```

---

## Connect through OpenAI Secure MCP Tunnel

### 1. Create the OpenAI resources

1. Create a tunnel at <https://platform.openai.com/settings/organization/tunnels>.
2. Associate it with the ChatGPT workspace that should discover it.
3. Create a runtime API key at <https://platform.openai.com/settings/organization/api-keys> with Tunnels **Read + Use**.
4. Enable ChatGPT Developer Mode/custom apps in the target workspace.

Platform tunnel roles and ChatGPT workspace Developer Mode are separate permissions.

### 2. Guided configuration

macOS/Linux:

```bash
./scripts/connect-chatgpt.sh
```

Windows PowerShell:

```powershell
.\scripts\windows\configure-tunnel.ps1
```

The wizard seeds a user-only `runtime.env` from the repository `.env` (intentionally omitting `MCP_TOKEN` because the documented tunnel profile uses `sample_mcp_remote_no_auth`), prompts separately for workspace roots/default workspace, initializes the profile from the configured MCP endpoint, and runs `tunnel-client doctor`. API keys are not embedded in service descriptors or process arguments. For persistent services, `runtime.env` is authoritative—edit it rather than `.env`, then restart the affected service.

Default runtime config locations:

- macOS/Linux: `~/.config/chatgpt-sol-local-bridge/runtime.env` (`0600`)
- Windows: `%APPDATA%\chatgpt-sol-local-bridge\runtime.env` (user-only ACL)

### 3. Equivalent manual commands

```bash
export CONTROL_PLANE_API_KEY="sk-..."
tunnel-client init \
  --sample sample_mcp_remote_no_auth \
  --profile sol-local-bridge \
  --tunnel-id tunnel_0123456789abcdef0123456789abcdef \
  --health-listen-addr 127.0.0.1:8766 \
  --mcp-server-url http://127.0.0.1:8765/mcp

tunnel-client doctor --profile sol-local-bridge --explain
tunnel-client run --profile sol-local-bridge
```

Leave both `npm start` and `tunnel-client run` running, use `npm run start:all` to start them in dependency order, or install the user services below. The tunnel wrapper waits for `/readyz` before launching `tunnel-client`, avoiding a cold-start probe race. If `HOST`/`PORT` changes, rerun tunnel profile initialization so its `--mcp-server-url` stays in sync. Service status also checks tunnel readiness at `http://127.0.0.1:8766/readyz`.

### 4. Attach ChatGPT on the website or desktop app

See **[ChatGPT website and desktop setup](docs/CHATGPT_SETUP.md)** for the complete, current walkthrough and troubleshooting guide.

#### ChatGPT website

1. On ChatGPT web, open **Settings → Security and login** and enable **Developer mode**.
2. Open <https://chatgpt.com/plugins>, select **+**, and create a developer-mode connection.
3. Choose **Connection = Tunnel**, select/paste your `tunnel_...` ID, and choose **No Authentication**.
4. Verify that discovery returns exactly 44 tools.
5. In a new conversation, choose **Developer mode** from the composer's **+** menu, enable the app, and ask:

> Use SOL Local Bridge only. Call `bridge_instructions`, then `workspace_list`, then `workspace_snapshot`. Do not modify anything.

#### ChatGPT desktop app

OpenAI currently registers custom MCP connections on the website first. Sign into the desktop app with the same account/workspace and check its Plugins/Developer Mode picker. If the connection does not appear directly, copy its `plugin_asdk_app_...` technical ID from the website URL and use `@plugin-creator` in desktop **Work mode** to package it with a personal marketplace entry. Restart the desktop app, install it from the Plugins Directory, and test it in a new conversation. The detailed guide explains each step and the difference between `tunnel_...` and `plugin_asdk_app_...` IDs.

If **Developer mode** is absent on the website, confirm account/workspace eligibility and—on a managed workspace—ask its admin for access. If Work mode or the Plugins Directory is absent from the desktop app, update it; if the surface remains unavailable for that account/build, use the website integration.

---

## Run persistently

Desktop automation must run in the logged-in user's session. Do not run it as a macOS LaunchDaemon, Windows Session-0 service, or headless system service if you expect UI control.

### macOS LaunchAgents

```bash
./scripts/service-macos.sh install
./scripts/service-macos.sh status
./scripts/service-macos.sh logs
# restart / stop / start / uninstall are also supported
```

Two LaunchAgents are installed: one for the MCP server and one for `tunnel-client`. The plist files contain only paths—not secrets.

### Linux systemd user services

```bash
./scripts/service-linux.sh install
./scripts/service-linux.sh status
./scripts/service-linux.sh logs
```

For an interactive desktop, keep these as user services. A dedicated system user is appropriate only for headless file/git/build workflows. User services normally follow the user's login session; intentional headless persistence may require `loginctl enable-linger <user>` and is not universally available in containers, minimal distributions, or WSL.

### Windows Scheduled Tasks

```powershell
.\scripts\windows\service.ps1 install
.\scripts\windows\service.ps1 status
.\scripts\windows\service.ps1 logs
```

Tasks run at user logon with limited privileges and `MultipleInstances=IgnoreNew`. They do not request highest privileges.

---

## Delete/rollback approval model

The following are intercepted before execution at the structured file/command/network layer:

- Unix/Windows/PowerShell file deletion and truncation
- `git clean`, `reset --hard`, restore/checkout discard, branch deletion, force push
- SQL drop/truncate/delete
- destructive Docker/Podman prune and `kubectl delete`
- patch-based file deletion
- HTTP `DELETE`
- native window close/quit/kill

A blocked operation returns:

```text
DELETE BLOCKED — no destructive command was executed.
Token: del_...
Expires: ...
Preview: ...
```

The code-level default is `deny` (no destructive execution). The supplied `.env.example` and guided setup explicitly select `chat` to reproduce the original workflow. In `chat` mode, after the human explicitly confirms the exact preview, ChatGPT calls:

```text
confirm_destructive(token=<same token>, userSaidYes=true)
```

Tokens are bound to the exact canonical operation, stored atomically, expire after ten minutes by default, and are single-use. `chat` mode relies on the MCP caller honestly representing the human's reply; it is a review workflow, not independent proof against a malicious/prompt-injected caller.

For independently enforced approval, configure a read-only verifier backed by a separate human-controlled channel/account:

```dotenv
DESTRUCTIVE_APPROVAL_MODE=external
APPROVAL_VERIFIER_COMMAND=/absolute/path/to/read-only-approval-verifier
APPROVAL_VERIFIER_SHA256=<pinned sha256 of that executable>
```

At confirmation time the bridge executes:

```text
<verifier> verify <token> <operation-fingerprint>
```

The verifier must only report whether a separate human approval already exists; it must not let the bridge's shell create that approval. A same-user file or local CLI is not independent because the unrestricted shell tool could invoke it itself.

Browser/native UI tools are marked `destructiveHint=true`, and obvious Delete/Trash/Close actions are token-gated, but coordinate clicks, JavaScript evaluation, and keyboard input cannot be semantically proven non-destructive. Likewise, no generic regex can make unrestricted shell access mathematically unable to delete data—for example, an interpreter can implement deletion indirectly. Use OS isolation/snapshots when that guarantee matters. See [`docs/SECURITY.md`](docs/SECURITY.md).

---

## Security defaults

- Loopback-only bind is enforced. Non-loopback operation is intentionally refused; any external TLS/auth proxy requires a separate security design and keeps the bridge itself on loopback.
- Host-header validation against DNS rebinding.
- Optional bearer authentication with timing-safe comparison.
- Explicit workspace roots; tool-driven authority expansion disabled. A dedicated `BRIDGE_SCRATCH_DIR` is the only automatic tool root.
- Internal approvals/process metadata/audit state is never a file-tool root; realpath/symlink-aware containment and protected credential/system paths are enforced.
- Bridge-owned process IDs only, with start-identity checks and process-tree termination.
- Bounded request bodies, command output, fetch/Office responses, timeouts, concurrent tool calls, process-log size, record count, and retention.
- Hash-chained, redacted audit JSONL under `~/.chatgpt-sol-local-bridge/audit/`.
- `web_fetch` blocks private, loopback, link-local, multicast, mapped-IPv6/NAT64, and cloud-metadata ranges by default; redirects are revalidated and cross-origin redirects are rejected unless explicitly enabled (then downgraded to header-safelisted GET).
- Runtime API keys live only in a user-owned secret file. The tunnel key is excluded from the MCP server, and secret-like environment variables are stripped from shell/project/Codex children unless explicitly allowlisted.

To intentionally call local/intranet HTTP services:

```dotenv
WEB_FETCH_ALLOW_HOSTS=localhost,api.dev.internal.example
# or, broader and riskier:
ALLOW_PRIVATE_NETWORK=true
```

Tool arguments/results can include source code or local data and are sent through the calling OpenAI product. Do not expose a workspace whose data policy forbids that processing.

---

## Penpot

Two supported shapes:

1. Run Penpot MCP as a second local server and attach it through another Secure MCP Tunnel profile.
2. Use `dom_cdp` to drive <https://design.penpot.app> in an already signed-in browser.

```bash
npx -y @penpot/mcp@stable
# manifest: http://127.0.0.1:4400/manifest.json
# MCP:      http://127.0.0.1:4401/mcp
```

`penpot_status` reports these endpoints; the bridge intentionally does not impersonate or proxy Penpot's own MCP tools.

## Development and validation

```bash
npm run lint
npm test                 # unit + integration
npm run test:unit
npm run test:integration
npm run check            # lint + all tests
npm run doctor -- --json
npm run doctor -- --live       # require local /readyz
# For service configuration, load runtime.env without echoing secrets:
node scripts/run-with-env.mjs ~/.config/chatgpt-sol-local-bridge/runtime.env -- npm run doctor -- --tunnel
```

The test suite covers:

- exact 44-tool contract
- authenticated Streamable HTTP MCP lifecycle
- workspace and symlink escape protection
- read/write/edit/patch round trips
- destructive detection and one-time confirmations
- managed-process ownership/logging/stopping
- DOCX/XLSX round trips
- private-network blocking
- project command detection

## Repository layout

```text
src/
  server.js              Streamable HTTP MCP server
  tool-contract.js       frozen exact 44-tool list
  lib/                   policy, paths, process, audit, Office, fetch
  platform/              macOS/Linux/Windows adapters
  tools/                 seven tool-family modules
docs/
  CHATGPT_SETUP.md       website + desktop app connection guide
  SECURITY.md            trust boundaries and hardening
  OPERATIONS.md          service and incident runbook
scripts/
  connect-chatgpt.sh     Unix tunnel setup wizard
  service-macos.sh       LaunchAgent lifecycle
  service-linux.sh       systemd-user lifecycle
  windows/               PowerShell setup/service scripts
  smoke.mjs              live MCP smoke test
examples/python-minimal/  original small FastMCP teaching example
```

## Operational caveats

- The workstation must be awake, logged in, connected, and running both services.
- macOS Accessibility/Screen Recording/Microphone permissions are granted to the executable actually running the bridge (Terminal/Node/interceptor).
- Linux Wayland support varies by compositor.
- Windows desktop automation requires an interactive user session.
- Cross-platform DOCX/XLSX support covers document data, not Office macros, rendering fidelity, or Excel formula recalculation.
- Attaching browser automation to a personal profile exposes that profile's signed-in sessions to the agent.

## References

- [ChatGPT Developer Mode](https://developers.openai.com/api/docs/guides/developer-mode)
- [OpenAI Secure MCP Tunnel guide](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)
- [Package plugins for ChatGPT desktop/Codex](https://developers.openai.com/plugins/build/plugins)
- [openai/tunnel-client](https://github.com/openai/tunnel-client)
- [OpenAI private MCP server announcement](https://developers.openai.com/blog/connect-private-mcp-servers-to-openai-products)
- [Model Context Protocol](https://modelcontextprotocol.io/)

## License

MIT. `tunnel-client` itself is OpenAI's separate Apache-2.0 project; it is not vendored here.

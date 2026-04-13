# OpenCode Systemd Integration Design

## Goal

Make OpenCode use the systemd-started `agentmemory` service as the single backend for both MCP tools and automatic memory capture/context injection, without changing OpenCode source code.

## Current Problem

- OpenCode is configured to launch `node /opt/agentmemory/dist/cli.mjs mcp`.
- That command starts `src/mcp/standalone.ts`, which uses `InMemoryKV` backed by `~/.agentmemory/standalone.json`.
- The running systemd service exposes the real REST, viewer, and MCP-like endpoints on `http://127.0.0.1:3111/agentmemory/*` and `http://127.0.0.1:3113`.
- As a result, OpenCode MCP usage and the viewer/dashboard do not share storage.
- Claude Code-style automatic recall is also absent because OpenCode currently has no agentmemory plugin/hooks configured.

## Constraints

- Do not modify OpenCode source code.
- Implement the fix in the `linuxdevel/agentmemory` fork.
- Keep deployment to `/opt/agentmemory` possible through a repo-owned install/deploy script.
- Mirror the Claude Code integration behavior for automatic recall/capture as closely as OpenCode’s plugin API allows.
- Verify behavior end-to-end against the running systemd service before considering the work done.

## Chosen Approach

### 1. Replace standalone MCP storage with a REST-backed stdio MCP bridge

Patch `src/mcp/standalone.ts` so `agentmemory mcp` becomes a stdio MCP bridge to the running service instead of a separate in-memory implementation.

Behavior:

- `tools/list` fetches `GET /agentmemory/mcp/tools`
- `tools/call` forwards to `POST /agentmemory/mcp/call`
- `resources/list`, `resources/read`, `prompts/list`, and `prompts/get` proxy to the matching REST endpoints already implemented in `src/mcp/server.ts`
- authentication uses `AGENTMEMORY_SECRET` when set
- the bridge talks to `AGENTMEMORY_URL` with default `http://127.0.0.1:3111`

Result:

- OpenCode can keep using a normal local stdio MCP command
- the MCP command now uses the systemd-backed store and tool surface
- the viewer and MCP tools share the same backend

### 2. Add an OpenCode plugin inside agentmemory

Create an OpenCode plugin in the fork that mirrors the Claude hook behavior using OpenCode’s config-loaded plugin API.

Hooks to implement:

- `experimental.chat.system.transform`
  - inject session-start context once per session by calling `/agentmemory/session/start`
- `experimental.chat.messages.transform`
  - before each model turn, inspect the latest user message and call `/agentmemory/context` when needed
  - keep the logic conservative to avoid excess token injection
- `tool.execute.before`
  - for file/search tools, call `/agentmemory/enrich` and append returned context into the prompt stream when OpenCode allows output mutation
- `tool.execute.after`
  - POST observations to `/agentmemory/observe` for successes and failures

This gives OpenCode the same core mechanism Claude uses:

- automatic capture via REST hooks
- automatic recall/context injection via REST hooks
- MCP remains available for manual/fallback use, not as the primary automatic path

### 3. Add a repo-owned install/deploy script

Add a script that:

- builds the fork with the correct Node toolchain
- copies `dist/` and plugin assets into `/opt/agentmemory`
- installs or updates the OpenCode plugin file under `~/.config/opencode/plugins/`
- updates `~/.config/opencode/opencode.json` to:
  - keep a local MCP command using `/opt/agentmemory/dist/cli.mjs mcp`
  - load the new agentmemory OpenCode plugin

The script should be idempotent and scoped to this repo’s integration.

## Why This Is Better Than Alternatives

### Better than changing OpenCode

- keeps the integration portable to stock OpenCode
- places the fix in the product that currently owns the broken local-vs-server split

### Better than a separate custom bridge repository

- one fork owns the MCP bridge, plugin behavior, and installer
- easier to version, build, deploy, and eventually upstream

### Better than relying on automatic MCP recall

- Claude Code does not do automatic recall through MCP tool calls
- hook-driven context injection is the proven token-saving path already used by agentmemory

## Files To Change

### agentmemory runtime

- `src/mcp/standalone.ts`
- possibly `src/mcp/transport.ts`
- new helper module if needed for REST proxy logic

### tests

- `test/mcp-standalone.test.ts`
- new focused tests for REST bridge behavior and OpenCode plugin behavior

### OpenCode integration shipped from fork

- new plugin file under the repo, likely `integrations/opencode/plugin.js` or similar
- new install/deploy script under `scripts/`
- README updates for OpenCode installation from fork

### local user config deployment target

- `~/.config/opencode/opencode.json`
- `~/.config/opencode/plugins/agentmemory.js`

## Verification Strategy

Because the repo has unrelated baseline test failures, verification must be focused and explicit.

Required checks:

1. focused unit tests for the new MCP REST bridge behavior
2. focused unit tests for the OpenCode plugin logic where practical
3. build using the Node 22 toolchain used by the systemd service
4. deploy the built artifacts into `/opt/agentmemory`
5. restart or verify the running service if required by changed runtime files
6. confirm OpenCode MCP can list and call tools through the patched `cli.mjs mcp`
7. confirm activity appears in the systemd-backed viewer/service, not a standalone store
8. confirm automatic context/capture paths hit `/agentmemory/session/start`, `/agentmemory/context`, `/agentmemory/enrich`, and `/agentmemory/observe`

## Risks

- OpenCode plugin hooks may not allow injection at exactly the same boundary as Claude hooks. Mitigation: use the closest supported hooks and verify observed behavior.
- The systemd service may need a restart after installing built files. Mitigation: explicit deploy and health verification.
- Existing unrelated repo test failures mean full-suite green is not a useful gate. Mitigation: focused tests plus end-to-end verification.

## Success Criteria

- OpenCode no longer uses `~/.agentmemory/standalone.json` as its primary MCP backend
- OpenCode MCP reads/writes hit the systemd-started agentmemory service
- OpenCode automatically captures session/tool activity into the shared backend
- OpenCode automatically injects relevant past context in the same style as Claude integration
- `http://localhost:3113` reflects OpenCode activity from the shared backend

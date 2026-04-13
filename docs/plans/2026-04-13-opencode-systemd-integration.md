# OpenCode Systemd Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make OpenCode use the systemd-started agentmemory service as the shared backend for MCP tools and automatic memory capture/context injection, with all implementation living in the `linuxdevel/agentmemory` fork.

**Architecture:** Replace agentmemory's standalone stdio MCP mode with a REST-backed bridge to the running systemd service, then ship an OpenCode plugin from the fork that mirrors Claude Code's automatic recall/capture behavior using OpenCode's supported plugin hooks. Add a repo-owned install/deploy script so the built fork can be deployed back into `/opt/agentmemory` and `~/.config/opencode/` reliably.

**Tech Stack:** TypeScript, Node.js, Vitest, agentmemory REST API, OpenCode config-installed plugins, systemd deployment.

---

### Task 1: Add failing tests for stdio MCP REST bridge

**Files:**
- Modify: `test/mcp-standalone.test.ts`
- Read for context: `src/mcp/standalone.ts`, `src/mcp/server.ts`

**Step 1: Write failing tests**

Add tests that assert:

- `tools/list` is sourced from the REST endpoint rather than the in-memory allowlist
- `tools/call` forwards payloads to REST and returns the remote result
- resources/prompts methods are supported by the stdio bridge

**Step 2: Run focused test to verify it fails**

Run: `PATH=/home/abols/.nvm/versions/node/v22.22.2/bin:$PATH npm test -- test/mcp-standalone.test.ts`

Expected: FAIL because `src/mcp/standalone.ts` still uses `InMemoryKV` and does not proxy REST.

**Step 3: Do not implement yet**

Leave production code unchanged until Task 2.

### Task 2: Implement stdio MCP REST bridge

**Files:**
- Modify: `src/mcp/standalone.ts`
- Modify if needed: `src/mcp/transport.ts`
- Possibly create: `src/mcp/rest-client.ts`
- Test: `test/mcp-standalone.test.ts`

**Step 1: Write minimal implementation**

Implement a REST client that:

- reads `AGENTMEMORY_URL` defaulting to `http://127.0.0.1:3111`
- sends `Authorization: Bearer ...` when `AGENTMEMORY_SECRET` exists
- maps stdio MCP requests to the existing REST endpoints under `/agentmemory/mcp/*`

Support at minimum:

- `initialize`
- `notifications/initialized`
- `tools/list`
- `tools/call`
- `resources/list`
- `resources/read`
- `prompts/list`
- `prompts/get`

Remove dependence on `InMemoryKV` for normal MCP behavior.

**Step 2: Run focused test to verify it passes**

Run: `PATH=/home/abols/.nvm/versions/node/v22.22.2/bin:$PATH npm test -- test/mcp-standalone.test.ts`

Expected: PASS for the new bridge-focused tests.

**Step 3: Self-review**

Check that:

- error responses from REST become MCP `isError` payloads or JSON-RPC errors consistently
- no standalone persistence path is used for normal operation

### Task 3: Add failing tests for OpenCode plugin integration

**Files:**
- Create: `test/opencode-plugin.test.ts`
- Read for context: `src/hooks/session-start.ts`, `src/hooks/pre-tool-use.ts`, `src/hooks/post-tool-use.ts`, `src/hooks/post-tool-failure.ts`, `src/hooks/prompt-submit.ts`

**Step 1: Write failing tests**

Add focused tests for a new OpenCode plugin module asserting:

- session start triggers `/agentmemory/session/start`
- system/message transforms inject returned context into model input
- relevant file/search tools trigger `/agentmemory/enrich`
- tool completion posts observations to `/agentmemory/observe`

**Step 2: Run focused test to verify it fails**

Run: `PATH=/home/abols/.nvm/versions/node/v22.22.2/bin:$PATH npm test -- test/opencode-plugin.test.ts`

Expected: FAIL because the plugin file does not exist yet.

### Task 4: Implement OpenCode plugin mirroring Claude behavior

**Files:**
- Create: `integrations/opencode/plugin.js`
- Possibly create: `integrations/opencode/lib/*.js`
- Test: `test/opencode-plugin.test.ts`
- Reference: `plugin/scripts/*.mjs`

**Step 1: Write minimal implementation**

Implement a config-loadable OpenCode plugin that uses supported hooks:

- `experimental.chat.system.transform`
  - ensure per-session startup registration with `/agentmemory/session/start`
  - inject returned context into system prompt only once per session
- `experimental.chat.messages.transform`
  - conservatively inject `/agentmemory/context` results based on current messages
- `tool.execute.before`
  - for file/search tools, call `/agentmemory/enrich`
- `tool.execute.after`
  - call `/agentmemory/observe` for successful/failing tool executions

Keep the implementation minimal and re-use logic already present in `src/hooks/*.ts` wherever practical.

**Step 2: Run focused test to verify it passes**

Run: `PATH=/home/abols/.nvm/versions/node/v22.22.2/bin:$PATH npm test -- test/opencode-plugin.test.ts`

Expected: PASS.

**Step 3: Self-review**

Check that the plugin does not require any OpenCode source changes and can be loaded via `file://` config.

### Task 5: Add deployment/install script

**Files:**
- Create: `scripts/install-opencode-systemd-integration.sh`
- Modify: `README.md`

**Step 1: Write failing verification command**

Define the deployment behavior in the script usage and verify the script is absent before creation.

Run: `test -x scripts/install-opencode-systemd-integration.sh`

Expected: exit non-zero.

**Step 2: Write minimal implementation**

Create a script that:

- builds with Node 22
- copies the built `dist/` into `/opt/agentmemory`
- installs `integrations/opencode/plugin.js` to `~/.config/opencode/plugins/agentmemory.js`
- updates `~/.config/opencode/opencode.json` to:
  - load the plugin
  - use local MCP command `/home/abols/.nvm/versions/node/v22.22.2/bin/node /opt/agentmemory/dist/cli.mjs mcp`

Keep updates idempotent.

**Step 3: Run script in dry-run or safe verification mode if implemented**

Run the script and verify files land in the expected locations.

### Task 6: Deploy and verify end-to-end against systemd service

**Files:**
- Deployment target: `/opt/agentmemory`
- Deployment target: `~/.config/opencode/opencode.json`
- Deployment target: `~/.config/opencode/plugins/agentmemory.js`

**Step 1: Build with correct Node toolchain**

Run: `PATH=/home/abols/.nvm/versions/node/v22.22.2/bin:$PATH npm run build`

Expected: successful build.

**Step 2: Run deploy script**

Run the new install script.

Expected: `/opt/agentmemory` and OpenCode config/plugin targets updated.

**Step 3: Restart or verify service if needed**

Run the appropriate service verification command and ensure `/agentmemory/health` is healthy enough for testing.

**Step 4: Verify shared MCP backend**

Confirm that OpenCode-facing MCP operations no longer depend on `~/.agentmemory/standalone.json` and that memory operations surface in the running service.

**Step 5: Verify automatic recall/capture**

Trigger a minimal OpenCode interaction path and confirm:

- session starts appear in the systemd backend
- observations increment in the running service
- returned context is injected automatically
- viewer on `http://localhost:3113` reflects the activity

**Step 6: Document residual issues**

If any unrelated repo baseline failures remain, note them explicitly and separate them from the verified integration path.

# Copilot Provider Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add GitHub Copilot as an explicit AgentMemory provider using local OpenCode auth state, while removing silent fallback to Claude `agent-sdk`.

**Architecture:** Add a native `copilot` provider that reads runtime auth from a local auth file and calls the Copilot API directly with OpenAI-compatible chat payloads. Make provider selection explicit in config so AgentMemory fails loudly when no provider is configured instead of silently defaulting to `agent-sdk`.

**Tech Stack:** TypeScript, Node.js fetch, Vitest, runtime file-based auth loading

---

### Task 1: Add config tests for explicit provider selection

**Files:**
- Create: `test/config-provider.test.ts`
- Modify: `src/config.ts`
- Modify: `src/types.ts`

**Step 1: Write the failing tests**

Add tests covering:
- `PROVIDER=copilot` selects `copilot`
- `COPILOT_MODEL` overrides the default Copilot model
- missing explicit provider config no longer silently resolves to `agent-sdk`
- `PROVIDER=agent-sdk` still works when explicitly set

**Step 2: Run test to verify it fails**

Run: `npm test -- test/config-provider.test.ts`
Expected: FAIL because `copilot` is not yet a valid provider and config still silently defaults to `agent-sdk`

**Step 3: Write minimal implementation**

Update:
- `src/types.ts` to add `copilot` to `ProviderType`
- `src/config.ts` to support explicit provider selection through `PROVIDER`
- `src/config.ts` to stop silently defaulting to `agent-sdk` when no explicit provider is configured

**Step 4: Run test to verify it passes**

Run: `npm test -- test/config-provider.test.ts`
Expected: PASS

### Task 2: Add Copilot auth-file parsing tests

**Files:**
- Create: `test/copilot-provider.test.ts`
- Create: `src/providers/copilot.ts`

**Step 1: Write the failing tests**

Add tests covering:
- auth file loaded from default path
- `COPILOT_AUTH_PATH` override is respected
- malformed auth file throws clear error
- missing token fields throw clear error

Use mocked filesystem reads only. Do not use any real auth file content.

**Step 2: Run test to verify it fails**

Run: `npm test -- test/copilot-provider.test.ts`
Expected: FAIL because `CopilotProvider` does not exist yet

**Step 3: Write minimal implementation**

Implement `src/providers/copilot.ts` with:
- runtime auth-path resolution
- auth-file parsing
- token extraction compatible with local OpenCode auth shape
- explicit errors for missing/malformed auth

**Step 4: Run test to verify it passes**

Run: `npm test -- test/copilot-provider.test.ts`
Expected: PASS

### Task 3: Add Copilot request-construction tests

**Files:**
- Modify: `test/copilot-provider.test.ts`
- Modify: `src/providers/copilot.ts`

**Step 1: Write the failing tests**

Add tests covering:
- request goes to default Copilot base URL
- `COPILOT_BASE_URL` override is respected
- request uses OpenAI-compatible chat payload
- required headers are present:
  - `Authorization`
  - `Openai-Intent`
  - `X-Initiator`
  - `User-Agent`
- provider returns the extracted assistant text for both `compress()` and `summarize()`

Use mocked `fetch` and fake token data only.

**Step 2: Run test to verify it fails**

Run: `npm test -- test/copilot-provider.test.ts`
Expected: FAIL on missing request logic/assertions

**Step 3: Write minimal implementation**

Extend `src/providers/copilot.ts` to:
- issue direct HTTP requests to Copilot
- build correct headers
- build request payload from system and user prompts
- parse text response into plain string result

**Step 4: Run test to verify it passes**

Run: `npm test -- test/copilot-provider.test.ts`
Expected: PASS

### Task 4: Wire Copilot into provider factory

**Files:**
- Modify: `src/providers/index.ts`
- Modify: `src/types.ts`
- Test: `test/config-provider.test.ts`
- Test: `test/copilot-provider.test.ts`

**Step 1: Write the failing test**

Add coverage proving `createProvider()` returns a resilient wrapper around the Copilot provider when config selects `copilot`.

**Step 2: Run test to verify it fails**

Run: `npm test -- test/config-provider.test.ts test/copilot-provider.test.ts`
Expected: FAIL because factory does not create Copilot provider yet

**Step 3: Write minimal implementation**

Update `src/providers/index.ts` to construct `CopilotProvider` for explicit `copilot` config.

**Step 4: Run test to verify it passes**

Run: `npm test -- test/config-provider.test.ts test/copilot-provider.test.ts`
Expected: PASS

### Task 5: Verify targeted suite and document migration behavior

**Files:**
- Modify if needed: `docs/plans/2026-04-13-copilot-provider-design.md`

**Step 1: Run targeted verification**

Run:
- `npm test -- test/config-provider.test.ts test/copilot-provider.test.ts`
- `npm test -- test/fallback-chain.test.ts test/circuit-breaker.test.ts`

Expected: PASS

**Step 2: Record migration notes**

Ensure docs clearly state:
- `agent-sdk` is no longer selected implicitly
- `PROVIDER=copilot` is required for Copilot mode
- auth file stays local and is never committed

### Task 6: Runtime validation without secrets in repo

**Files:**
- No committed secret changes

**Step 1: Configure local runtime only**

Use local environment or `~/.agentmemory/.env` outside git to set:
- `PROVIDER=copilot`
- optional `COPILOT_AUTH_PATH`
- optional `COPILOT_MODEL`

**Step 2: Validate startup**

Run the relevant local startup path and confirm:
- provider logs show `copilot`
- health endpoint stays healthy when auth is valid
- startup fails clearly when auth file is absent or malformed

**Step 3: Do not commit any secret material**

Verify `git diff --cached` and `git status --short` do not contain auth files, tokens, or local runtime secrets.

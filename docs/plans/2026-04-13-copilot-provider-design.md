# Copilot Provider Backend Design

## Context

AgentMemory currently selects a text-generation provider from local environment state. If no explicit provider API key is present, it silently falls back to `agent-sdk`, which routes work through the local Claude Code SDK.

That default behavior is undesirable for this deployment. The requested direction is:

- support GitHub Copilot as a first-class provider backend
- base authentication on local machine state rather than committed credentials
- avoid committing any secrets to the repository
- stop silently using Claude when Copilot is intended

## Goals

- Add a `copilot` provider for `compress()` and `summarize()` operations.
- Reuse local Copilot/OpenCode auth state from the host filesystem.
- Keep all auth material runtime-only and outside git.
- Fail loudly for invalid Copilot auth/config instead of silently using Claude.

## Non-Goals

- No secret material committed into docs, tests, config examples, or fixtures.
- No broad generic secret-broker framework in this change.
- No OpenCode subprocess bridge for provider calls.
- No automatic fallback to unrelated providers unless explicitly configured.

## Options Considered

### 1. Native Copilot HTTP provider using local auth file

Read local auth state from the existing OpenCode auth file shape and call the Copilot API directly using an OpenAI-compatible request body.

Pros:

- matches existing local auth model already used by OpenCode
- avoids Claude SDK dependency entirely
- stable provider interface inside AgentMemory
- easy to test with mocked auth-file content and mocked fetch

Cons:

- requires implementing auth-file parsing and Copilot-specific header logic

### 2. Reuse local Copilot CLI shim

Shell out to a local Copilot helper/CLI and parse text output.

Pros:

- less HTTP code inside AgentMemory

Cons:

- brittle process contract
- harder error handling
- more runtime failure modes
- poor testability compared with direct HTTP

### 3. General OpenAI-compatible provider abstraction first

Build a generic adapter layer, then plug Copilot into it.

Pros:

- reusable abstraction

Cons:

- larger refactor than needed
- delays solving the immediate Copilot requirement

## Decision

Use option 1.

Implement a native `copilot` provider that reads the local auth file at runtime and talks directly to the Copilot API. Keep this change narrow and explicit.

## Proposed Architecture

### Provider type

Add `copilot` to the provider type union and config validation.

### Provider implementation

Add `src/providers/copilot.ts` implementing `MemoryProvider`.

Responsibilities:

- load auth file from local path
- extract bearer token from the auth file shape already used by local OpenCode onboarding
- send chat-completions style requests to Copilot
- return plain text content for `compress()` and `summarize()`

### Auth path

Default auth path:

- `~/.local/share/opencode/auth.json`

Config override:

- `COPILOT_AUTH_PATH`

This path must be read at runtime only. No auth-file contents should ever be copied into project files.

### Config behavior

Provider selection is explicit.

Recommended env behavior:

- `PROVIDER=copilot`
- optional `COPILOT_MODEL`
- optional `COPILOT_BASE_URL`
- optional `COPILOT_AUTH_PATH`

`PROVIDER=copilot` is required for Copilot mode. When Copilot is selected, auth/config errors fail clearly at provider construction. Existing implicit `agent-sdk` fallback remains for backward-compatible installs.

## Request Model

Use OpenAI-compatible chat payloads against the Copilot API endpoint.

Headers should follow the same general contract as the local OpenCode Copilot plugin:

- `Authorization: Bearer <token>`
- `Openai-Intent: conversation-edits`
- `X-Initiator: user`
- `User-Agent: agentmemory/<version>`

Default base URL:

- `https://api.githubcopilot.com`

Optional enterprise/base override should remain possible through config.

## Error Handling

The provider must fail clearly in these cases:

- auth file missing
- auth file malformed
- expected token fields absent
- Copilot returns authentication/authorization failure

These failures should be explicit provider/config errors. They should not silently trigger Claude usage.

## Security Handling

Secret material classification: strictly confidential.

Rules for implementation:

- do not log raw tokens
- do not include real auth content in tests
- do not persist auth content in memory records, docs, or snapshots
- use mocked auth payloads in unit tests only

## Testing Strategy

Add unit coverage for:

- config chooses `copilot` when explicitly configured
- config no longer silently defaults to `agent-sdk`
- auth-file parsing succeeds for expected shape
- missing/malformed auth file fails clearly
- request construction includes Copilot-specific headers
- provider returns text content from Copilot response payload

## Rollout

1. Implement provider and config changes.
2. Verify unit tests.
3. Point local runtime to `PROVIDER=copilot`.
4. Restart service and verify health/provider behavior.

## Risks

- auth-file shape may differ from the current OpenCode assumption
- Copilot may require additional request headers or endpoint nuances
- removing implicit `agent-sdk` fallback may break environments that relied on it without explicit configuration

## Mitigations

- keep auth parsing narrow and validated
- add focused tests for malformed shapes
- make provider selection errors explicit and actionable
- document exact env required for migration

# Session Crystallize Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Verify and harden session crystallization enough to safely ship it in current PR.

**Architecture:** Add focused unit tests around `mem::session-crystallize`, then make the smallest idempotency fix needed so reruns reuse prior session-derived actions instead of creating duplicates. Reuse existing KV/SDK mock pattern from crystallize tests.

**Tech Stack:** TypeScript, Vitest, iii-sdk function registration, in-memory KV mocks

---

### Task 1: Add session crystallize tests

**Files:**
- Create: `test/session-crystallize.test.ts`
- Reference: `test/crystallize.test.ts`
- Reference: `src/functions/session-crystallize.ts`

**Step 1: Write failing test**

Add tests for:
- creates actions and crystal from meaningful observations
- skips when crystal already exists for session
- reuses existing session-derived actions when retrying after prior partial failure

**Step 2: Run test to verify it fails**

Run: `npm test -- test/session-crystallize.test.ts`

Expected: at least one failure due to missing idempotency behavior.

### Task 2: Apply minimal fix

**Files:**
- Modify: `src/functions/session-crystallize.ts`

**Step 1: Implement smallest code change**

- Detect existing `session-crystallize` actions for same session before creating new ones.
- Reuse those action IDs when continuing into `mem::crystallize`.
- Preserve current happy-path behavior.

**Step 2: Run test to verify it passes**

Run: `npm test -- test/session-crystallize.test.ts`

Expected: PASS.

### Task 3: Verify surrounding regressions

**Files:**
- Test: `test/crystallize.test.ts`
- Test: `test/session-crystallize.test.ts`

**Step 1: Run targeted suite**

Run: `npm test -- test/crystallize.test.ts test/session-crystallize.test.ts`

Expected: PASS.

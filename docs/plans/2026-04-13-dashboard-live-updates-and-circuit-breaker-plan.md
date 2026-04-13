# Dashboard Live Updates And Circuit Breaker Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove dashboard flicker during live updates and make circuit breaker status reflect real current failures instead of stale counts.

**Architecture:** Keep the initial dashboard render but patch live values in place on refresh instead of replacing the whole dashboard DOM. Tighten circuit breaker bookkeeping so failures expire with the window and successful closed-state calls clear old failures.

**Tech Stack:** TypeScript, inline viewer HTML/JS, Vitest

---

### Task 1: Add circuit breaker regression tests

**Files:**
- Modify: `test/circuit-breaker.test.ts`

**Step 1: Write failing tests**

Add tests for:
- success while closed clears previous failures
- stale failures age out from reported state after the failure window

**Step 2: Run test to verify it fails**

Run: `npm test -- test/circuit-breaker.test.ts`
Expected: FAIL on the new assertions

### Task 2: Fix circuit breaker bookkeeping

**Files:**
- Modify: `src/providers/circuit-breaker.ts`

**Step 1: Implement minimal fix**

Update the breaker to:
- expire stale failures before reporting state or recording success
- clear failures on success while closed
- preserve existing open and half-open behavior

**Step 2: Run targeted tests**

Run: `npm test -- test/circuit-breaker.test.ts`
Expected: PASS

### Task 3: Stop full dashboard redraw on refresh

**Files:**
- Modify: `src/viewer/index.html`

**Step 1: Refactor dashboard rendering**

Split dashboard behavior into:
- first render that creates the dashboard structure
- update path that patches individual metric and summary nodes in place

**Step 2: Route refreshes through the patch path**

Change websocket and timer-driven refresh behavior so it refreshes dashboard data and updates existing nodes instead of replacing `#view-dashboard.innerHTML`.

**Step 3: Keep safe fallback**

If the dashboard structure is missing or not yet loaded, fall back to the initial full render.

### Task 4: Verify viewer behavior

**Files:**
- Modify if needed: `src/viewer/index.html`

**Step 1: Run relevant tests/build**

Run:
- `npm test -- test/circuit-breaker.test.ts test/viewer-security.test.ts`
- `npm test`

Expected: PASS

**Step 2: Manual verification**

Start the app and confirm:
- dashboard metrics update without full-page flicker
- circuit breaker does not keep stale failure counts after healthy calls/window expiry

### Task 5: Hand off for user validation

**Files:**
- No additional file changes expected

**Step 1: Summarize changes**

Tell the user what changed and what to verify in the running dashboard.

**Step 2: Do not commit yet**

Wait for user validation before any git commit or push.

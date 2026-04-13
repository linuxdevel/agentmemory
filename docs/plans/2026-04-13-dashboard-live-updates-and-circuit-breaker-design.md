# Dashboard Live Updates And Circuit Breaker Design

## Context

The real-time viewer dashboard visibly flickers whenever live updates arrive. The current implementation reloads dashboard data and replaces the entire dashboard DOM with a single `innerHTML` assignment on websocket events and periodic refresh.

The dashboard also reports circuit breaker failures in a way that can look unhealthy even after recovery. The current breaker keeps stale failure counts while closed and only resets counters on half-open success.

## Goals

- Remove visible dashboard flicker during live updates.
- Keep the existing dashboard layout and data sources.
- Make circuit breaker status reflect real end-to-end provider failures.
- Avoid broad refactors or UI redesigns.

## Chosen Approach

### Dashboard updates

Keep the initial dashboard render, but stop replacing the full dashboard DOM for every update. Instead:

- Render the dashboard structure once.
- Add stable DOM hooks for metric values and sections that need live updates.
- Refresh dashboard data in memory, then patch only the affected DOM nodes.
- Keep full render as a fallback for first load or missing structure.

This is the smallest change that fixes the root cause: whole-view DOM replacement.

### Circuit breaker behavior

Keep a single breaker around the end-to-end provider call, but make the state more accurate:

- Expire stale failures when the failure window has passed.
- Clear failures after successful calls while the breaker is closed.
- Continue counting failures only when the wrapped provider call fails end-to-end.

Because fallback-chain calls only throw when every provider fails, successful fallback should not count as a breaker failure.

## Alternatives Considered

### Debounce full dashboard redraws

Rejected because it reduces the symptom frequency but keeps the same root cause.

### Per-provider circuit breakers in fallback chain

Rejected for now because it is a larger architectural change and not necessary to fix the misleading dashboard state.

## Implementation Outline

1. Refactor dashboard rendering so the first render creates structure and later updates patch specific nodes.
2. Add focused helpers for updating dashboard metrics and summary sections in place.
3. Change websocket dashboard refresh handling to call the patch path rather than full redraw.
4. Update circuit breaker state handling so stale failures age out and successful closed-state calls clear counters.
5. Add tests covering stale-failure expiry and success reset behavior.

## Verification

- Run the relevant unit tests for circuit breaker behavior.
- Build or run the test suite for the repo.
- Manually verify the dashboard no longer flashes during live updates and that circuit breaker values only reflect current failures.

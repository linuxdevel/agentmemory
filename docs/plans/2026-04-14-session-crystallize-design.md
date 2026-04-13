# Session Crystallize Design

## Goal

Add enough verification around automatic session crystallization to safely include the feature in the current PR.

## Scope

- Keep existing feature shape: session-end trigger can derive actions from meaningful observations and crystallize them.
- Add focused test coverage for happy path and idempotency.
- Fix only behavior exposed by those tests.

## Risks Being Covered

- Duplicate done actions if a prior run created actions but failed before crystal persisted.
- Silent regressions in rerun behavior.
- Shipping new API/runtime behavior without direct tests.

## Chosen Approach

Use a dedicated `session-crystallize` unit test file with the same lightweight KV/SDK harness style already used by `test/crystallize.test.ts`.

Tests cover:

1. successful extraction of actions and crystal from meaningful observations
2. rerun skip when session already has a crystal
3. idempotent recovery when matching session-derived actions already exist before crystallization reruns

## Non-Goals

- No broad redesign of crystals/lessons/actions pipeline.
- No new persistence schema.
- No UI changes.

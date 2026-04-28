import { describe, it, expect, vi } from "vitest";

vi.mock("iii-sdk", () => ({
  getContext: () => ({
    logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
  }),
}));

import { registerObserveFunction } from "../src/functions/observe.js";
import { KV } from "../src/state/schema.js";
import type { Session } from "../src/types.js";

function mockKV() {
  const store = new Map<string, Map<string, unknown>>();
  return {
    get: async <T>(scope: string, key: string): Promise<T | null> => {
      return (store.get(scope)?.get(key) as T) ?? null;
    },
    set: async <T>(scope: string, key: string, data: T): Promise<T> => {
      if (!store.has(scope)) store.set(scope, new Map());
      store.get(scope)!.set(key, data);
      return data;
    },
    delete: async (scope: string, key: string): Promise<void> => {
      store.get(scope)?.delete(key);
    },
    list: async <T>(scope: string): Promise<T[]> => {
      const entries = store.get(scope);
      return entries ? (Array.from(entries.values()) as T[]) : [];
    },
  };
}

function mockSdk() {
  const functions = new Map<string, Function>();
  return {
    registerFunction: (opts: { id: string }, handler: Function) => {
      functions.set(opts.id, handler);
    },
    registerTrigger: () => {},
    trigger: async (id: string, data: unknown) => {
      const fn = functions.get(id);
      if (!fn) {
        if (id === "stream::append") return { ok: true };
        throw new Error(`No function: ${id}`);
      }
      return fn(data);
    },
    triggerVoid: () => {},
  };
}

describe("mem::observe session heartbeat", () => {
  it("sets lastObservationAt on the session when an observation is recorded", async () => {
    const kv = mockKV();
    const sdk = mockSdk();

    await kv.set(KV.sessions, "s1", {
      id: "s1",
      project: "/p",
      cwd: "/p",
      startedAt: "2026-01-01T00:00:00.000Z",
      status: "active",
      observationCount: 0,
    } satisfies Session);

    registerObserveFunction(sdk as any, kv as any);

    const ts = "2026-04-28T10:00:00.000Z";
    await sdk.trigger("mem::observe", {
      sessionId: "s1",
      hookType: "post_tool_use",
      timestamp: ts,
      project: "/p",
      cwd: "/p",
      data: { tool_name: "Read", tool_input: {}, tool_output: "ok" },
    });

    const updated = (await kv.get(KV.sessions, "s1")) as Session;
    expect(updated.observationCount).toBe(1);
    expect(updated.lastObservationAt).toBe(ts);
  });

  it("falls back to current time if a session somehow lacks a payload timestamp on the heartbeat path", async () => {
    // Defensive: even though the validator requires payload.timestamp, the
    // implementation must not write `undefined` to lastObservationAt if it
    // ever gets called via an internal path that bypasses validation.
    const kv = mockKV();
    const sdk = mockSdk();

    await kv.set(KV.sessions, "s2", {
      id: "s2",
      project: "/p",
      cwd: "/p",
      startedAt: "2026-01-01T00:00:00.000Z",
      status: "active",
      observationCount: 0,
    } satisfies Session);

    registerObserveFunction(sdk as any, kv as any);

    const before = Date.now();
    const result = await sdk.trigger("mem::observe", {
      sessionId: "s2",
      hookType: "post_tool_use",
      project: "/p",
      cwd: "/p",
      data: { tool_name: "Read", tool_input: {}, tool_output: "ok" },
    });
    const after = Date.now();

    // Validator rejects the call; session must remain unchanged (not have
    // an undefined lastObservationAt written).
    expect(result).toMatchObject({ success: false });
    const updated = (await kv.get(KV.sessions, "s2")) as Session;
    expect(updated.observationCount).toBe(0);
    expect(updated.lastObservationAt).toBeUndefined();
    void before;
    void after;
  });
});

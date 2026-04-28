import { describe, it, expect, vi } from "vitest";

vi.mock("iii-sdk", () => ({
  getContext: () => ({
    logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
  }),
}));

import { registerApiTriggers } from "../src/triggers/api.js";
import { registerEventTriggers } from "../src/triggers/events.js";
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
  const fns = new Map<string, Function>();
  const sdk = {
    registerFunction: (o: { id: string }, h: Function) => {
      fns.set(o.id, h);
    },
    registerTrigger: () => {},
    trigger: async (id: string, data: unknown) => {
      const fn = fns.get(id);
      if (!fn) {
        if (id === "mem::context") return { context: "" };
        throw new Error(`No function: ${id}`);
      }
      return fn(data);
    },
    triggerVoid: () => {},
    __getFn: (id: string) => fns.get(id)!,
  };
  return sdk;
}

describe("api::session::start idempotency", () => {
  it("creates a fresh session when none exists", async () => {
    const kv = mockKV();
    const sdk = mockSdk();
    registerApiTriggers(sdk as any, kv as any, "");
    const handler = sdk.__getFn("api::session::start");

    const res = await handler({
      headers: {},
      body: { sessionId: "new1", project: "/p", cwd: "/p" },
    });
    expect(res.status_code).toBe(200);

    const stored = (await kv.get(KV.sessions, "new1")) as Session;
    expect(stored.status).toBe("active");
    expect(stored.observationCount).toBe(0);
    expect(stored.resumeCount).toBeUndefined();
    expect(stored.endedAt).toBeUndefined();
    expect(stored.startedAt).toBeDefined();
  });

  it("reactivates existing session, preserves startedAt and observationCount, clears endedAt, bumps resumeCount", async () => {
    const kv = mockKV();
    const sdk = mockSdk();
    registerApiTriggers(sdk as any, kv as any, "");
    const handler = sdk.__getFn("api::session::start");

    await kv.set(KV.sessions, "s1", {
      id: "s1",
      project: "/p",
      cwd: "/p",
      startedAt: "2026-01-01T00:00:00.000Z",
      endedAt: "2026-01-01T01:00:00.000Z",
      status: "completed",
      observationCount: 42,
    } satisfies Session);

    const res = await handler({
      headers: {},
      body: { sessionId: "s1", project: "/p", cwd: "/p" },
    });
    expect(res.status_code).toBe(200);

    const updated = (await kv.get(KV.sessions, "s1")) as Session;
    expect(updated.status).toBe("active");
    expect(updated.startedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(updated.endedAt).toBeUndefined();
    expect(updated.observationCount).toBe(42);
    expect(updated.resumeCount).toBe(1);
  });

  it("bumps resumeCount on each subsequent reactivation", async () => {
    const kv = mockKV();
    const sdk = mockSdk();
    registerApiTriggers(sdk as any, kv as any, "");
    const handler = sdk.__getFn("api::session::start");

    await kv.set(KV.sessions, "s2", {
      id: "s2",
      project: "/p",
      cwd: "/p",
      startedAt: "2026-01-01T00:00:00.000Z",
      status: "abandoned",
      observationCount: 5,
      resumeCount: 2,
    } satisfies Session);

    await handler({
      headers: {},
      body: { sessionId: "s2", project: "/p", cwd: "/p" },
    });
    const updated = (await kv.get(KV.sessions, "s2")) as Session;
    expect(updated.resumeCount).toBe(3);
    expect(updated.status).toBe("active");
  });
});

describe("event::session::started idempotency", () => {
  it("reactivates existing session preserving startedAt and bumping resumeCount", async () => {
    const kv = mockKV();
    const sdk = mockSdk();
    registerEventTriggers(sdk as any, kv as any);
    const handler = sdk.__getFn("event::session::started");

    await kv.set(KV.sessions, "ev1", {
      id: "ev1",
      project: "/p",
      cwd: "/p",
      startedAt: "2026-01-01T00:00:00.000Z",
      endedAt: "2026-01-02T00:00:00.000Z",
      status: "completed",
      observationCount: 7,
    } satisfies Session);

    const result = await handler({
      sessionId: "ev1",
      project: "/p",
      cwd: "/p",
    });
    expect(result.session.startedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(result.session.status).toBe("active");
    expect(result.session.observationCount).toBe(7);
    expect(result.session.resumeCount).toBe(1);
    expect(result.session.endedAt).toBeUndefined();
  });
});

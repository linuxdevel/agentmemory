import { beforeEach, describe, expect, it, vi } from "vitest";

if (!(globalThis as { crypto?: { randomUUID: () => string } }).crypto) {
  (globalThis as { crypto?: { randomUUID: () => string } }).crypto = {
    randomUUID: () => "12345678-1234-1234-1234-123456789abc",
  };
}

vi.mock("iii-sdk", () => ({
  getContext: () => ({
    logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
  }),
}));

import { registerCrystallizeFunction } from "../src/functions/crystallize.js";
import { registerSessionCrystallizeFunction } from "../src/functions/session-crystallize.js";
import { KV } from "../src/state/schema.js";
import type {
  Action,
  CompressedObservation,
  Crystal,
  MemoryProvider,
  Session,
} from "../src/types.js";

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
      if (!fn) throw new Error(`No function: ${id}`);
      return fn(data);
    },
  };
}

function mockProvider(): MemoryProvider {
  return {
    name: "test",
    compress: vi.fn(),
    summarize: vi
      .fn()
      .mockResolvedValueOnce(
        JSON.stringify([
          {
            title: "Fix auth bug",
            description: "Patched auth middleware and verified behavior",
            tags: ["auth", "bugfix"],
            observationIds: ["obs_1", "obs_2"],
          },
        ]),
      )
      .mockResolvedValue(
        '{"narrative":"Completed session work","keyOutcomes":["auth fixed"],"filesAffected":["src/auth.ts"],"lessons":["Prefer explicit auth checks"]}',
      ),
  };
}

function makeSession(id = "sess_1"): Session {
  return {
    id,
    project: "/app",
    cwd: "/app",
    startedAt: new Date("2026-04-14T00:00:00Z").toISOString(),
    status: "completed",
    observationCount: 4,
  };
}

function makeObservation(
  id: string,
  overrides: Partial<CompressedObservation> = {},
): CompressedObservation {
  return {
    id,
    sessionId: "sess_1",
    timestamp: new Date("2026-04-14T00:00:00Z").toISOString(),
    type: "discovery",
    title: `Observation ${id}`,
    facts: [],
    narrative: `Narrative for ${id}`,
    concepts: [],
    files: ["src/auth.ts"],
    importance: 5,
    ...overrides,
  };
}

function makeCrystal(sessionId = "sess_1"): Crystal {
  return {
    id: "crys_existing",
    narrative: "Existing crystal",
    keyOutcomes: ["done"],
    filesAffected: ["src/auth.ts"],
    lessons: ["lesson"],
    sourceActionIds: ["act_existing"],
    project: "/app",
    sessionId,
    createdAt: new Date("2026-04-14T01:00:00Z").toISOString(),
  };
}

function makeExistingAction(id = "act_existing"): Action {
  return {
    id,
    title: "Fix auth bug",
    description: "Patched auth middleware and verified behavior",
    status: "done",
    priority: 5,
    createdAt: new Date("2026-04-14T00:30:00Z").toISOString(),
    updatedAt: new Date("2026-04-14T00:30:00Z").toISOString(),
    createdBy: "session-crystallize",
    project: "/app",
    tags: ["auth", "bugfix"],
    sourceObservationIds: ["obs_1", "obs_2"],
    sourceMemoryIds: [],
    result: "Completed during session sess_1",
  };
}

describe("Session crystallize function", () => {
  let sdk: ReturnType<typeof mockSdk>;
  let kv: ReturnType<typeof mockKV>;
  let provider: MemoryProvider;

  beforeEach(() => {
    sdk = mockSdk();
    kv = mockKV();
    provider = mockProvider();
    registerCrystallizeFunction(sdk as never, kv as never, provider);
    registerSessionCrystallizeFunction(sdk as never, kv as never, provider);
  });

  it("creates done actions and crystal from meaningful observations", async () => {
    await kv.set(KV.sessions, "sess_1", makeSession());
    await kv.set(KV.observations("sess_1"), "obs_1", makeObservation("obs_1"));
    await kv.set(KV.observations("sess_1"), "obs_2", makeObservation("obs_2"));
    await kv.set(KV.observations("sess_1"), "obs_3", makeObservation("obs_3"));

    const result = (await sdk.trigger("mem::session-crystallize", {
      sessionId: "sess_1",
    })) as { success: boolean; actionsCreated?: number; crystal?: Crystal };

    expect(result.success).toBe(true);
    expect(result.actionsCreated).toBe(1);
    expect(result.crystal?.sessionId).toBe("sess_1");

    const actions = await kv.list<Action>(KV.actions);
    expect(actions).toHaveLength(1);
    expect(actions[0].createdBy).toBe("session-crystallize");
    expect(actions[0].status).toBe("done");
    expect(actions[0].sourceObservationIds).toEqual(["obs_1", "obs_2"]);

    const crystals = await kv.list<Crystal>(KV.crystals);
    expect(crystals).toHaveLength(1);
  });

  it("skips rerun when session already has crystal", async () => {
    await kv.set(KV.sessions, "sess_1", makeSession());
    await kv.set(KV.crystals, "crys_existing", makeCrystal());
    await kv.set(KV.observations("sess_1"), "obs_1", makeObservation("obs_1"));
    await kv.set(KV.observations("sess_1"), "obs_2", makeObservation("obs_2"));
    await kv.set(KV.observations("sess_1"), "obs_3", makeObservation("obs_3"));

    const result = (await sdk.trigger("mem::session-crystallize", {
      sessionId: "sess_1",
    })) as {
      success: boolean;
      skipped?: boolean;
      existingCrystals?: number;
    };

    expect(result.success).toBe(true);
    expect(result.skipped).toBe(true);
    expect(result.existingCrystals).toBe(1);
    expect(await kv.list<Action>(KV.actions)).toHaveLength(0);
  });

  it("reuses existing session-derived actions instead of creating duplicates on retry", async () => {
    await kv.set(KV.sessions, "sess_1", makeSession());
    await kv.set(KV.actions, "act_existing", makeExistingAction());
    await kv.set(KV.observations("sess_1"), "obs_1", makeObservation("obs_1"));
    await kv.set(KV.observations("sess_1"), "obs_2", makeObservation("obs_2"));
    await kv.set(KV.observations("sess_1"), "obs_3", makeObservation("obs_3"));

    const result = (await sdk.trigger("mem::session-crystallize", {
      sessionId: "sess_1",
    })) as { success: boolean; actionsCreated?: number; crystal?: Crystal };

    expect(result.success).toBe(true);
    expect(result.actionsCreated).toBe(1);
    expect(result.crystal?.sourceActionIds).toEqual(["act_existing"]);

    const actions = await kv.list<Action>(KV.actions);
    expect(actions).toHaveLength(1);
    expect(actions[0].id).toBe("act_existing");
  });
});

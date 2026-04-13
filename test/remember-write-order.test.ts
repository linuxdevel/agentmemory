import { beforeEach, describe, expect, it, vi } from "vitest";

if (!(globalThis as { crypto?: { randomUUID: () => string } }).crypto) {
  (globalThis as { crypto?: { randomUUID: () => string } }).crypto = {
    randomUUID: () => "12345678-1234-1234-1234-123456789abc",
  };
}

const triggerVoid = vi.fn();

vi.mock("iii-sdk", () => ({
  getContext: () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  }),
}));

vi.mock("../src/functions/access-tracker.js", () => ({
  deleteAccessLog: vi.fn(),
}));

import { registerRememberFunction } from "../src/functions/remember.js";
import type { Memory } from "../src/types.js";

function makeMemory(overrides: Partial<Memory> = {}): Memory {
  return {
    id: "mem_old",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    type: "fact",
    title: "Old memory",
    content: "same content",
    concepts: [],
    files: [],
    sessionIds: [],
    strength: 7,
    version: 1,
    isLatest: true,
    ...overrides,
  };
}

describe("mem::remember write order", () => {
  let handlers: Record<string, Function>;
  let kv: {
    list: ReturnType<typeof vi.fn>;
    set: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  let sdk: { registerFunction: (meta: { id: string }, handler: Function) => void; triggerVoid: typeof triggerVoid };

  beforeEach(() => {
    handlers = {};
    kv = {
      list: vi.fn().mockResolvedValue([makeMemory()]),
      set: vi.fn().mockImplementation(async (_scope: string, _key: string, value: unknown) => value),
      delete: vi.fn(),
    };
    sdk = {
      registerFunction: (meta, handler) => {
        handlers[meta.id] = handler;
      },
      triggerVoid,
    };
    triggerVoid.mockReset();

    registerRememberFunction(sdk as never, kv as never);
  });

  it("writes the new latest memory before demoting the superseded one", async () => {
    const result = await handlers["mem::remember"]({ content: "same content" });

    expect(result.success).toBe(true);
    expect(kv.set).toHaveBeenCalledTimes(2);
    const firstSaved = kv.set.mock.calls[0][2] as Memory;
    const secondSaved = kv.set.mock.calls[1][2] as Memory;
    expect(firstSaved.id).not.toBe("mem_old");
    expect(firstSaved.isLatest).toBe(true);
    expect(secondSaved.id).toBe("mem_old");
    expect(secondSaved.isLatest).toBe(false);
  });

  it("keeps new latest persisted if demotion write fails", async () => {
    const writes = new Map<string, Memory>();
    kv.set = vi.fn(async (_scope: string, key: string, value: unknown) => {
      writes.set(key, value as Memory);
      if (key === "mem_old" && (value as Memory).isLatest === false) {
        throw new Error("demotion failed");
      }
      return value;
    });

    await expect(handlers["mem::remember"]({ content: "same content" })).rejects.toThrow(
      /demotion failed/i,
    );

    const persistedNew = Array.from(writes.values()).find((m) => m.id !== "mem_old");
    expect(persistedNew).toBeDefined();
    expect(persistedNew!.isLatest).toBe(true);
    expect(writes.get("mem_old")?.isLatest).toBe(false);
  });
});

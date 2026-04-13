import { describe, it, expect, beforeEach, vi } from "vitest";

const transportState = vi.hoisted(() => ({
  handler: null as
    | ((method: string, params: Record<string, unknown>) => Promise<unknown>)
    | null,
  start: vi.fn(),
  stop: vi.fn(),
}));

vi.mock("iii-sdk", () => ({
  getContext: () => ({
    logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
  }),
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

vi.mock("../src/mcp/transport.js", () => ({
  createStdioTransport: vi.fn(
    (
      handler: (method: string, params: Record<string, unknown>) => Promise<unknown>,
    ) => {
      transportState.handler = handler;
      return { start: transportState.start, stop: transportState.stop };
    },
  ),
}));

vi.mock("../src/config.js", () => ({
  getStandalonePersistPath: vi.fn(() => "/tmp/test-standalone.json"),
}));

import {
  getAllTools,
  CORE_TOOLS,
  V040_TOOLS,
} from "../src/mcp/tools-registry.js";
import { InMemoryKV } from "../src/mcp/in-memory-kv.js";
import { handleToolCall } from "../src/mcp/standalone.js";
import { writeFileSync } from "node:fs";

describe("standalone MCP stdio bridge", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env.AGENTMEMORY_URL;
    delete process.env.AGENTMEMORY_SECRET;
  });

  it("tools/list is sourced from the REST endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        tools: [
          {
            name: "remote_only_tool",
            description: "Returned by service",
            inputSchema: { type: "object", properties: {} },
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await transportState.handler?.("tools/list", {});

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:3111/agentmemory/mcp/tools",
      expect.objectContaining({ method: "GET" }),
    );
    expect(result).toEqual({
      tools: [
        {
          name: "remote_only_tool",
          description: "Returned by service",
          inputSchema: { type: "object", properties: {} },
        },
      ],
    });
  });

  it("initialize advertises tools, resources, and prompts capabilities", async () => {
    await expect(transportState.handler?.("initialize", {})).resolves.toEqual({
      protocolVersion: "2024-11-05",
      capabilities: {
        tools: { listChanged: false },
        resources: { listChanged: false },
        prompts: { listChanged: false },
      },
      serverInfo: {
        name: "agentmemory",
        version: expect.any(String),
      },
    });
  });

  it("tools/call forwards payloads to REST and returns the remote result", async () => {
    process.env.AGENTMEMORY_URL = "http://agentmemory.example:4010";
    process.env.AGENTMEMORY_SECRET = "top-secret";

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ type: "text", text: '{"saved":"mem_remote"}' }],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await transportState.handler?.("tools/call", {
      name: "memory_save",
      arguments: { content: "Persist this remotely" },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://agentmemory.example:4010/agentmemory/mcp/call",
      expect.objectContaining({
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer top-secret",
        },
        body: JSON.stringify({
          name: "memory_save",
          arguments: { content: "Persist this remotely" },
        }),
        signal: expect.any(AbortSignal),
      }),
    );
    expect(result).toEqual({
      content: [{ type: "text", text: '{"saved":"mem_remote"}' }],
    });
  });

  it("supports resources and prompts methods through the REST bridge", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          resources: [{ uri: "agentmemory://status", name: "Status" }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          contents: [{ uri: "agentmemory://status", text: "{}" }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          prompts: [{ name: "recall_context", description: "Recall context" }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          messages: [{ role: "user", content: { type: "text", text: "ctx" } }],
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    await expect(transportState.handler?.("resources/list", {})).resolves.toEqual({
      resources: [{ uri: "agentmemory://status", name: "Status" }],
    });
    await expect(
      transportState.handler?.("resources/read", { uri: "agentmemory://status" }),
    ).resolves.toEqual({
      contents: [{ uri: "agentmemory://status", text: "{}" }],
    });
    await expect(transportState.handler?.("prompts/list", {})).resolves.toEqual({
      prompts: [{ name: "recall_context", description: "Recall context" }],
    });
    await expect(
      transportState.handler?.("prompts/get", {
        name: "recall_context",
        arguments: { task_description: "Investigate bridge" },
      }),
    ).resolves.toEqual({
      messages: [{ role: "user", content: { type: "text", text: "ctx" } }],
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://127.0.0.1:3111/agentmemory/mcp/resources",
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:3111/agentmemory/mcp/resources/read",
      expect.objectContaining({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ uri: "agentmemory://status" }),
        signal: expect.any(AbortSignal),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "http://127.0.0.1:3111/agentmemory/mcp/prompts",
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      "http://127.0.0.1:3111/agentmemory/mcp/prompts/get",
      expect.objectContaining({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "recall_context",
          arguments: { task_description: "Investigate bridge" },
        }),
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("normalizes non-tools REST failures into MCP error payloads", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => JSON.stringify({ error: "service unavailable" }),
      headers: new Headers({ "content-type": "application/json" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(transportState.handler?.("resources/list", {})).resolves.toEqual({
      content: [{ type: "text", text: "Error: service unavailable" }],
      isError: true,
    });
  });

  it("normalizes tools/list REST failures into MCP error payloads", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => JSON.stringify({ error: "service unavailable" }),
      headers: new Headers({ "content-type": "application/json" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(transportState.handler?.("tools/list", {})).resolves.toEqual({
      content: [{ type: "text", text: "Error: service unavailable" }],
      isError: true,
    });
  });

  it("returns actionable timeout errors for hanging REST requests", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      init?.signal?.throwIfAborted();
      throw new DOMException("The operation was aborted.", "AbortError");
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(transportState.handler?.("prompts/list", {})).resolves.toEqual({
      content: [{ type: "text", text: "Error: Request timed out" }],
      isError: true,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:3111/agentmemory/mcp/prompts",
      expect.objectContaining({
        method: "GET",
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("returns actionable errors for upstream empty or non-JSON failures", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 502,
        text: async () => "",
        headers: new Headers(),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 502,
        text: async () => "bad gateway",
        headers: new Headers({ "content-type": "text/plain" }),
      });
    vi.stubGlobal("fetch", fetchMock);

    await expect(transportState.handler?.("resources/list", {})).resolves.toEqual({
      content: [{ type: "text", text: "Error: Request failed with status 502" }],
      isError: true,
    });
    await expect(transportState.handler?.("resources/list", {})).resolves.toEqual({
      content: [{ type: "text", text: "Error: bad gateway" }],
      isError: true,
    });
  });
});

describe("Tools Registry", () => {
  it("getAllTools returns all tools with unique names", () => {
    const tools = getAllTools();
    expect(tools.length).toBeGreaterThanOrEqual(41);
    const names = new Set(tools.map((t) => t.name));
    expect(names.size).toBe(tools.length);
    for (const required of [
      "memory_verify",
      "memory_lesson_save",
      "memory_lesson_recall",
      "memory_obsidian_export",
      "memory_save",
      "memory_recall",
    ]) {
      expect(tools.some((t) => t.name === required)).toBe(true);
    }
  });

  it("CORE_TOOLS has 10 items", () => {
    expect(CORE_TOOLS.length).toBe(10);
  });

  it("V040_TOOLS has 8 items", () => {
    expect(V040_TOOLS.length).toBe(8);
  });

  it("all tools have required name, description, inputSchema fields", () => {
    const tools = getAllTools();
    for (const tool of tools) {
      expect(tool.name).toBeDefined();
      expect(typeof tool.name).toBe("string");
      expect(tool.name.length).toBeGreaterThan(0);
      expect(tool.description).toBeDefined();
      expect(typeof tool.description).toBe("string");
      expect(tool.inputSchema).toBeDefined();
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.inputSchema.properties).toBeDefined();
    }
  });
});

describe("InMemoryKV", () => {
  let kv: InMemoryKV;

  beforeEach(() => {
    kv = new InMemoryKV();
  });

  it("get/set/list/delete operations work", async () => {
    await kv.set("scope1", "key1", { value: "hello" });
    const result = await kv.get<{ value: string }>("scope1", "key1");
    expect(result).toEqual({ value: "hello" });

    const list = await kv.list("scope1");
    expect(list.length).toBe(1);

    await kv.delete("scope1", "key1");
    const afterDelete = await kv.get("scope1", "key1");
    expect(afterDelete).toBeNull();
  });

  it("list returns empty array for unknown scope", async () => {
    const result = await kv.list("nonexistent");
    expect(result).toEqual([]);
  });

  it("persist writes JSON", async () => {
    const kvWithPersist = new InMemoryKV("/tmp/test-kv.json");
    await kvWithPersist.set("scope1", "key1", { data: "test" });
    kvWithPersist.persist();

    expect(writeFileSync).toHaveBeenCalledWith(
      "/tmp/test-kv.json",
      expect.any(String),
      "utf-8",
    );
    const written = vi.mocked(writeFileSync).mock.calls[0][1] as string;
    const parsed = JSON.parse(written);
    expect(parsed.scope1.key1).toEqual({ data: "test" });
  });

  it("set overwrites existing values", async () => {
    await kv.set("scope1", "key1", "first");
    await kv.set("scope1", "key1", "second");
    const result = await kv.get("scope1", "key1");
    expect(result).toBe("second");
    const list = await kv.list("scope1");
    expect(list.length).toBe(1);
  });
});

describe("handleToolCall", () => {
  beforeEach(() => {
    vi.mocked(writeFileSync).mockClear();
  });

  it("memory_save persists to disk immediately after saving", async () => {
    const kv = new InMemoryKV("/tmp/test-handle.json");
    const result = await handleToolCall(
      "memory_save",
      { content: "Test memory content" },
      kv,
    );
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.saved).toMatch(/^mem_/);
    expect(writeFileSync).toHaveBeenCalledWith(
      "/tmp/test-handle.json",
      expect.any(String),
      "utf-8",
    );
  });

  it("memory_save without persist path does not call writeFileSync", async () => {
    const kv = new InMemoryKV();
    await handleToolCall("memory_save", { content: "No persist path" }, kv);
    expect(writeFileSync).not.toHaveBeenCalled();
  });

  it("memory_save throws when content is missing", async () => {
    const kv = new InMemoryKV();
    await expect(
      handleToolCall("memory_save", {}, kv),
    ).rejects.toThrow("content is required");
  });

  it("memory_recall returns matching memories", async () => {
    const kv = new InMemoryKV();
    await handleToolCall("memory_save", { content: "TypeScript is great" }, kv);
    await handleToolCall("memory_save", { content: "Python is also great" }, kv);
    const result = await handleToolCall(
      "memory_recall",
      { query: "typescript" },
      kv,
    );
    const memories = JSON.parse(result.content[0].text);
    expect(memories).toHaveLength(1);
    expect(memories[0].content).toBe("TypeScript is great");
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pluginPath = pathToFileURL(
  resolve(__dirname, "..", "integrations", "opencode", "plugin.js"),
).href;

type PluginHooks = Record<string, (...args: any[]) => Promise<void>>;

async function loadHooks() {
  const mod = (await import(
    `${pluginPath}?t=${Date.now()}-${Math.random().toString(36).slice(2)}`
  )) as {
    AgentMemoryPlugin?: (ctx: Record<string, unknown>) => Promise<PluginHooks>;
    default?: (ctx: Record<string, unknown>) => Promise<PluginHooks>;
  };

  const plugin = mod.AgentMemoryPlugin ?? mod.default;
  expect(plugin).toBeTypeOf("function");

  return plugin({
    project: { id: "proj_1", name: "agentmemory" },
    directory: "/workspace/agentmemory",
    worktree: "/workspace/agentmemory",
    serverUrl: new URL("http://127.0.0.1:4096"),
    client: {
      app: {
        log: vi.fn().mockResolvedValue(undefined),
      },
    },
    $: vi.fn(),
  });
}

function okJson(payload: unknown) {
  return {
    ok: true,
    json: async () => payload,
  };
}

describe("OpenCode agentmemory plugin", () => {
  beforeEach(() => {
    delete process.env.AGENTMEMORY_URL;
    delete process.env.AGENTMEMORY_SECRET;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("session start triggers /agentmemory/session/start and injects context once per session", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(okJson({ context: "session context" }))
      .mockResolvedValueOnce(okJson({ context: "should not be re-added" }));
    vi.stubGlobal("fetch", fetchMock);

    const hooks = await loadHooks();
    const transform = hooks["experimental.chat.system.transform"];
    expect(transform).toBeTypeOf("function");

    const firstOutput = { system: ["base system"] };
    await transform(
      { sessionID: "ses_123", model: { id: "model_1" } },
      firstOutput,
    );

    const secondOutput = { system: ["base system"] };
    await transform(
      { sessionID: "ses_123", model: { id: "model_1" } },
      secondOutput,
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:3111/agentmemory/session/start",
      expect.objectContaining({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId: "ses_123",
          project: "/workspace/agentmemory",
          cwd: "/workspace/agentmemory",
        }),
        signal: expect.any(AbortSignal),
      }),
    );
    expect(firstOutput.system).toEqual(["base system", "session context"]);
    expect(secondOutput.system).toEqual(["base system"]);
  });

  it("message and context transforms inject conservative automatic context", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(okJson({ context: "startup context" }))
      .mockResolvedValueOnce(okJson({ context: "message context" }));
    vi.stubGlobal("fetch", fetchMock);

    const hooks = await loadHooks();

    const systemOutput = { system: ["base system"] };
    await hooks["experimental.chat.system.transform"](
      { sessionID: "ses_234", model: { id: "model_1" } },
      systemOutput,
    );

    const messagesOutput = {
      sessionID: "ses_234",
      messages: [
        {
          info: { role: "user" },
          parts: [{ type: "text", text: "Investigate session start hook" }],
        },
      ],
    };
    await hooks["experimental.chat.messages.transform"]({}, messagesOutput);

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:3111/agentmemory/context",
      expect.objectContaining({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId: "ses_234",
          project: "/workspace/agentmemory",
          budget: 1500,
          prompt: "Investigate session start hook",
        }),
        signal: expect.any(AbortSignal),
      }),
    );
    expect(messagesOutput.messages[0].parts).toEqual([
      { type: "text", text: "message context" },
      { type: "text", text: "Investigate session start hook" },
    ]);
  });

  it("does not inject context when there is no safe current session id", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(okJson({ context: "startup context" }));
    vi.stubGlobal("fetch", fetchMock);

    const hooks = await loadHooks();

    await hooks["experimental.chat.system.transform"](
      { sessionID: "ses_unsafe", model: { id: "model_1" } },
      { system: [] },
    );

    const messagesOutput = {
      messages: [
        {
          info: { role: "user" },
          parts: [{ type: "text", text: "No session id here" }],
        },
      ],
    };

    await hooks["experimental.chat.messages.transform"]({}, messagesOutput);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(messagesOutput.messages[0].parts).toEqual([
      { type: "text", text: "No session id here" },
    ]);
  });

  it("relevant file and search tools trigger /agentmemory/enrich", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okJson({ context: "tool context" }));
    vi.stubGlobal("fetch", fetchMock);

    const hooks = await loadHooks();
    const output = { args: { filePath: "src/hooks/session-start.ts" } };

    await hooks["tool.execute.before"](
      { tool: "read", sessionID: "ses_345", callID: "call_1" },
      output,
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:3111/agentmemory/enrich",
      expect.objectContaining({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId: "ses_345",
          files: ["src/hooks/session-start.ts"],
          terms: [],
          toolName: "Read",
        }),
        signal: expect.any(AbortSignal),
      }),
    );
    expect(output.args.filePath).toBe("src/hooks/session-start.ts");
  });

  it("message transforms stay scoped to the current session", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(okJson({ context: "startup context A" }))
      .mockResolvedValueOnce(okJson({ context: "startup context B" }))
      .mockResolvedValueOnce(okJson({ context: "message context B" }));
    vi.stubGlobal("fetch", fetchMock);

    const hooks = await loadHooks();

    await hooks["experimental.chat.system.transform"](
      { sessionID: "ses_A", model: { id: "model_1" } },
      { system: [] },
    );
    await hooks["experimental.chat.system.transform"](
      { sessionID: "ses_B", model: { id: "model_1" } },
      { system: [] },
    );

    const messagesOutput = {
      sessionID: "ses_B",
      messages: [
        {
          info: { role: "user" },
          parts: [{ type: "text", text: "Only for session B" }],
        },
      ],
    };

    await hooks["experimental.chat.messages.transform"]({}, messagesOutput);

    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "http://127.0.0.1:3111/agentmemory/context",
      expect.objectContaining({
        body: JSON.stringify({
          sessionId: "ses_B",
          project: "/workspace/agentmemory",
          budget: 1500,
          prompt: "Only for session B",
        }),
      }),
    );
    expect(messagesOutput.messages[0].parts).toEqual([
      { type: "text", text: "message context B" },
      { type: "text", text: "Only for session B" },
    ]);
  });

  it("retries session start until it succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValueOnce(okJson({ context: "recovered context" }));
    vi.stubGlobal("fetch", fetchMock);

    const hooks = await loadHooks();
    const firstOutput = { system: ["base system"] };
    const secondOutput = { system: ["base system"] };

    await hooks["experimental.chat.system.transform"](
      { sessionID: "ses_retry", model: { id: "model_1" } },
      firstOutput,
    );
    await hooks["experimental.chat.system.transform"](
      { sessionID: "ses_retry", model: { id: "model_1" } },
      secondOutput,
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(firstOutput.system).toEqual(["base system"]);
    expect(secondOutput.system).toEqual(["base system", "recovered context"]);
  });

  it("retries session start after a non-ok response", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: "unavailable" }),
      })
      .mockResolvedValueOnce(okJson({ context: "recovered after 503" }));
    vi.stubGlobal("fetch", fetchMock);

    const hooks = await loadHooks();
    const firstOutput = { system: ["base system"] };
    const secondOutput = { system: ["base system"] };

    await hooks["experimental.chat.system.transform"](
      { sessionID: "ses_retry_http", model: { id: "model_1" } },
      firstOutput,
    );
    await hooks["experimental.chat.system.transform"](
      { sessionID: "ses_retry_http", model: { id: "model_1" } },
      secondOutput,
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(firstOutput.system).toEqual(["base system"]);
    expect(secondOutput.system).toEqual(["base system", "recovered after 503"]);
  });

  it("tool completion posts success and failure observations to /agentmemory/observe", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    const hooks = await loadHooks();

    await hooks["tool.execute.after"](
      {
        tool: "read",
        sessionID: "ses_456",
        callID: "call_success",
        args: { filePath: "src/hooks/session-start.ts" },
      },
      {
        title: "Read file",
        output: "hook body",
        metadata: {},
      },
    );

    await hooks["tool.execute.after"](
      {
        tool: "grep",
        sessionID: "ses_456",
        callID: "call_failure",
        args: { pattern: "session" },
      },
      {
        title: "Grep failed",
        output: "tool exited with code 1",
        metadata: { error: "tool exited with code 1" },
      },
    );

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://127.0.0.1:3111/agentmemory/observe",
      expect.objectContaining({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: expect.any(String),
        signal: expect.any(AbortSignal),
      }),
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toMatchObject({
      hookType: "post_tool_use",
      sessionId: "ses_456",
      project: "/workspace/agentmemory",
      cwd: "/workspace/agentmemory",
      data: {
        tool_name: "Read",
        tool_input: { filePath: "src/hooks/session-start.ts" },
        tool_output: "hook body",
      },
    });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body as string)).toMatchObject({
      hookType: "post_tool_failure",
      sessionId: "ses_456",
      project: "/workspace/agentmemory",
      cwd: "/workspace/agentmemory",
      data: {
        tool_name: "Grep",
        tool_input: JSON.stringify({ pattern: "session" }),
        error: "tool exited with code 1",
      },
    });
  });

  it("does not carry enrich output into later chat message mutation", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(okJson({ context: "startup context" }))
      .mockResolvedValueOnce(okJson({ context: "tool context" }))
      .mockResolvedValueOnce(okJson({ context: "message context" }));
    vi.stubGlobal("fetch", fetchMock);

    const hooks = await loadHooks();

    await hooks["experimental.chat.system.transform"](
      { sessionID: "ses_no_enrich_leak", model: { id: "model_1" } },
      { system: [] },
    );

    await hooks["tool.execute.before"](
      { tool: "read", sessionID: "ses_no_enrich_leak", callID: "call_1" },
      { args: { filePath: "src/hooks/session-start.ts" } },
    );

    const messagesOutput = {
      sessionID: "ses_no_enrich_leak",
      messages: [
        {
          info: { role: "user" },
          parts: [{ type: "text", text: "Investigate tool output" }],
        },
      ],
    };

    await hooks["experimental.chat.messages.transform"]({}, messagesOutput);

    expect(messagesOutput.messages[0].parts).toEqual([
      { type: "text", text: "message context" },
      { type: "text", text: "Investigate tool output" },
    ]);
  });
});

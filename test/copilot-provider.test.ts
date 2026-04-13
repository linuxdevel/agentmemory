import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

import { existsSync, readFileSync } from "node:fs";
import { CopilotProvider } from "../src/providers/copilot.js";
import { createProvider } from "../src/providers/index.js";

describe("CopilotProvider auth loading", () => {
  const originalEnv = { ...process.env };
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env["COPILOT_AUTH_PATH"];
    delete process.env["COPILOT_BASE_URL"];
    delete process.env["COPILOT_MODEL"];
    vi.mocked(existsSync).mockReset();
    vi.mocked(readFileSync).mockReset();
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    process.env = originalEnv;
    globalThis.fetch = originalFetch;
  });

  it("loads oauth token from default OpenCode auth path", async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({
        "github-copilot": {
          type: "oauth",
          refresh: "fake-refresh-token",
          access: "fake-access-token",
          expires: 0,
        },
      }),
    );
    vi.mocked(globalThis.fetch).mockRejectedValue(new Error("fetch failed"));

    const provider = new CopilotProvider();

    await expect(provider.compress("sys", "user")).rejects.toThrow(
      /fetch failed|network|request/i,
    );
    expect(vi.mocked(readFileSync).mock.calls[0]?.[0]).toContain(
      ".local/share/opencode/auth.json",
    );
  });

  it("respects COPILOT_AUTH_PATH override", async () => {
    process.env["COPILOT_AUTH_PATH"] = "/tmp/copilot-auth.json";
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({
        "github-copilot": {
          type: "oauth",
          refresh: "fake-refresh-token",
          access: "fake-access-token",
          expires: 0,
        },
      }),
    );
    vi.mocked(globalThis.fetch).mockRejectedValue(new Error("fetch failed"));

    const provider = new CopilotProvider();

    await expect(provider.summarize("sys", "user")).rejects.toThrow(
      /fetch failed|network|request/i,
    );
    expect(vi.mocked(readFileSync).mock.calls[0]?.[0]).toBe(
      "/tmp/copilot-auth.json",
    );
  });

  it("throws clear error when auth file is missing", async () => {
    vi.mocked(existsSync).mockReturnValue(false);

    expect(() => new CopilotProvider()).toThrow(/Copilot auth file not found/i);
  });

  it("throws clear error when auth file is malformed", async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue("not-json");

    expect(() => new CopilotProvider()).toThrow(/Invalid Copilot auth file/i);
  });

  it("throws clear error when oauth token fields are missing", async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({
        "github-copilot": {
          type: "oauth",
          expires: 0,
        },
      }),
    );

    expect(() => new CopilotProvider()).toThrow(/Missing Copilot oauth token/i);
  });

  it("uses Copilot API URL, headers, and request payload", async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({
        "github-copilot": {
          type: "oauth",
          refresh: "fake-refresh-token",
          access: "fake-access-token",
          expires: 0,
        },
      }),
    );
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "compressed text" } }],
      }),
    } as Response);

    const provider = new CopilotProvider();
    const result = await provider.compress("system prompt", "user prompt");

    expect(result).toBe("compressed text");
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(globalThis.fetch).mock.calls[0];
    expect(url).toBe("https://api.githubcopilot.com/chat/completions");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({
      Authorization: "Bearer fake-access-token",
      "Content-Type": "application/json",
      "Openai-Intent": "conversation-edits",
      "X-Initiator": "user",
    });
    expect(String((init?.headers as Record<string, string>)["User-Agent"])).toMatch(
      /^agentmemory\//,
    );
    expect(JSON.parse(String(init?.body))).toEqual({
      model: "gpt-4.1",
      messages: [
        { role: "system", content: "system prompt" },
        { role: "user", content: "user prompt" },
      ],
    });
  });

  it("uses base URL override and summarize returns assistant text", async () => {
    process.env["COPILOT_BASE_URL"] = "https://copilot.example.test/v1";
    process.env["COPILOT_MODEL"] = "gpt-5-mini";
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({
        "github-copilot": {
          type: "oauth",
          refresh: "fake-refresh-token",
          access: "fake-access-token",
          expires: 0,
        },
      }),
    );
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "summary text" } }],
      }),
    } as Response);

    const provider = new CopilotProvider();
    const result = await provider.summarize("sys", "user");

    expect(result).toBe("summary text");
    const [url, init] = vi.mocked(globalThis.fetch).mock.calls[0];
    expect(url).toBe("https://copilot.example.test/v1/chat/completions");
    expect(JSON.parse(String(init?.body)).model).toBe("gpt-5-mini");
  });

  it("createProvider wires copilot into resilient provider", () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({
        "github-copilot": {
          type: "oauth",
          refresh: "fake-refresh-token",
          access: "fake-access-token",
          expires: 0,
        },
      }),
    );

    const provider = createProvider({
      provider: "copilot",
      model: "gpt-4.1",
      maxTokens: 4096,
    });

    expect(provider.name).toBe("resilient(copilot)");
    expect(provider.circuitState.state).toBe("closed");
    expect(provider.circuitState.failures).toBe(0);
  });
});

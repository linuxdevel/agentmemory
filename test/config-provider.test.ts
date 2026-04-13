import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig provider selection", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env["AGENTMEMORY_IGNORE_ENV_FILE"] = "true";
    delete process.env["PROVIDER"];
    delete process.env["MAX_TOKENS"];
    delete process.env["COPILOT_MODEL"];
    delete process.env["ANTHROPIC_API_KEY"];
    delete process.env["ANTHROPIC_MODEL"];
    delete process.env["GEMINI_API_KEY"];
    delete process.env["GEMINI_MODEL"];
    delete process.env["OPENROUTER_API_KEY"];
    delete process.env["OPENROUTER_MODEL"];
    delete process.env["MINIMAX_API_KEY"];
    delete process.env["MINIMAX_MODEL"];
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("selects copilot when PROVIDER=copilot", () => {
    process.env["PROVIDER"] = "copilot";
    process.env["COPILOT_MODEL"] = "gpt-4.1";

    const config = loadConfig();

    expect(config.provider.provider).toBe("copilot");
    expect(config.provider.model).toBe("gpt-4.1");
  });

  it("still allows explicit agent-sdk selection", () => {
    process.env["PROVIDER"] = "agent-sdk";

    const config = loadConfig();

    expect(config.provider.provider).toBe("agent-sdk");
    expect(config.provider.model).toBe("claude-sonnet-4-20250514");
  });

  it("falls back to explicit agent-sdk compatibility when nothing else is configured", () => {
    const config = loadConfig();

    expect(config.provider.provider).toBe("agent-sdk");
    expect(config.provider.model).toBe("claude-sonnet-4-20250514");
  });
});

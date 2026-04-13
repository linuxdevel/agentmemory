import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { MemoryProvider } from "../types.js";

type CopilotAuthRecord = {
  type?: string;
  refresh?: string;
  access?: string;
  expires?: number;
};

export class CopilotProvider implements MemoryProvider {
  name = "copilot";

  constructor() {
    this.loadToken();
  }

  async compress(systemPrompt: string, userPrompt: string): Promise<string> {
    return this.query(systemPrompt, userPrompt);
  }

  async summarize(systemPrompt: string, userPrompt: string): Promise<string> {
    return this.query(systemPrompt, userPrompt);
  }

  private getAuthPath(): string {
    return (
      process.env["COPILOT_AUTH_PATH"] ||
      join(homedir(), ".local", "share", "opencode", "auth.json")
    );
  }

  private loadToken(): string {
    const authPath = this.getAuthPath();
    if (!existsSync(authPath)) {
      throw new Error(`Copilot auth file not found: ${authPath}`);
    }

    let parsed: Record<string, CopilotAuthRecord>;
    try {
      parsed = JSON.parse(readFileSync(authPath, "utf-8"));
    } catch {
      throw new Error(`Invalid Copilot auth file: ${authPath}`);
    }

    const auth = parsed["github-copilot"];
    if (!auth || auth.type !== "oauth") {
      throw new Error(`Missing Copilot oauth token in auth file: ${authPath}`);
    }

    const token = auth.access || auth.refresh;
    if (!token) {
      throw new Error(`Missing Copilot oauth token in auth file: ${authPath}`);
    }
    return token;
  }

  private async query(systemPrompt: string, userPrompt: string): Promise<string> {
    const token = this.loadToken();
    const baseUrl =
      process.env["COPILOT_BASE_URL"] || "https://api.githubcopilot.com";
    const url = baseUrl.endsWith("/chat/completions")
      ? baseUrl
      : `${baseUrl.replace(/\/$/, "")}/chat/completions`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Openai-Intent": "conversation-edits",
        "X-Initiator": "user",
        "User-Agent": "agentmemory/0.8.4",
      },
      body: JSON.stringify({
        model: process.env["COPILOT_MODEL"] || "gpt-4.1",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`Copilot request failed: ${response.status}`);
    }

    const json = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return json.choices?.[0]?.message?.content || "";
  }
}

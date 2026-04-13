#!/usr/bin/env node

import { InMemoryKV } from "./in-memory-kv.js";
import { getMcp, postMcp } from "./rest-client.js";
import { createStdioTransport } from "./transport.js";
import { getStandalonePersistPath } from "../config.js";
import { VERSION } from "../version.js";
import { generateId } from "../state/schema.js";

const SERVER_INFO = {
  name: "agentmemory",
  version: VERSION,
  protocolVersion: "2024-11-05",
};

function toMcpErrorResult(err: unknown) {
  return {
    content: [
      {
        type: "text",
        text: `Error: ${err instanceof Error ? err.message : String(err)}`,
      },
    ],
    isError: true,
  };
}

export async function handleToolCall(
  toolName: string,
  args: Record<string, unknown>,
  kvInstance: InMemoryKV = new InMemoryKV(getStandalonePersistPath()),
): Promise<{ content: Array<{ type: string; text: string }> }> {
  switch (toolName) {
    case "memory_save": {
      const content = args.content as string;
      if (!content?.trim()) throw new Error("content is required");
      const id = generateId("mem");
      const isoNow = new Date().toISOString();
      await kvInstance.set("mem:memories", id, {
        id,
        type: (args.type as string) || "fact",
        title: content.slice(0, 80),
        content,
        concepts: args.concepts
          ? (args.concepts as string).split(",").map((c) => c.trim())
          : [],
        files: args.files
          ? (args.files as string).split(",").map((f) => f.trim())
          : [],
        createdAt: isoNow,
        updatedAt: isoNow,
        strength: 7,
        version: 1,
        isLatest: true,
        sessionIds: [],
      });
      kvInstance.persist();
      return {
        content: [{ type: "text", text: JSON.stringify({ saved: id }) }],
      };
    }

    case "memory_recall": {
      const query = (args.query as string)?.toLowerCase() || "";
      const limit = (args.limit as number) || 10;
      const all = await kvInstance.list<Record<string, unknown>>("mem:memories");
      const results = all
        .filter((m) => {
          const text = `${m.title} ${m.content}`.toLowerCase();
          return text.includes(query);
        })
        .slice(0, limit);
      return {
        content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
      };
    }

    case "memory_sessions": {
      const sessions = await kvInstance.list("mem:sessions");
      return {
        content: [
          { type: "text", text: JSON.stringify({ sessions }, null, 2) },
        ],
      };
    }

    case "memory_export": {
      const memories = await kvInstance.list("mem:memories");
      const sessions = await kvInstance.list("mem:sessions");
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { version: VERSION, memories, sessions },
              null,
              2,
            ),
          },
        ],
      };
    }

    case "memory_audit": {
      const entries = await kvInstance.list("mem:audit");
      const limit = (args.limit as number) || 50;
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              (entries as Array<Record<string, unknown>>).slice(0, limit),
              null,
              2,
            ),
          },
        ],
      };
    }

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

const transport = createStdioTransport(async (method, params) => {
  switch (method) {
    case "initialize":
      return {
        protocolVersion: SERVER_INFO.protocolVersion,
        capabilities: {
          tools: { listChanged: false },
          resources: { listChanged: false },
          prompts: { listChanged: false },
        },
        serverInfo: {
          name: SERVER_INFO.name,
          version: SERVER_INFO.version,
        },
      };

    case "notifications/initialized":
      return {};

    case "tools/list":
      try {
        return await getMcp("/agentmemory/mcp/tools");
      } catch (err) {
        return toMcpErrorResult(err);
      }

    case "tools/call": {
      const toolName = params.name as string;
      const toolArgs = (params.arguments as Record<string, unknown>) || {};
      try {
        return await postMcp("/agentmemory/mcp/call", {
          name: toolName,
          arguments: toolArgs,
        });
      } catch (err) {
        return toMcpErrorResult(err);
      }
    }

    case "resources/list":
      try {
        return await getMcp("/agentmemory/mcp/resources");
      } catch (err) {
        return toMcpErrorResult(err);
      }

    case "resources/read":
      try {
        return await postMcp("/agentmemory/mcp/resources/read", params);
      } catch (err) {
        return toMcpErrorResult(err);
      }

    case "prompts/list":
      try {
        return await getMcp("/agentmemory/mcp/prompts");
      } catch (err) {
        return toMcpErrorResult(err);
      }

    case "prompts/get":
      try {
        return await postMcp("/agentmemory/mcp/prompts/get", params);
      } catch (err) {
        return toMcpErrorResult(err);
      }

    default:
      throw new Error(`Unknown method: ${method}`);
  }
});

process.stderr.write(
  `[agentmemory-mcp] Standalone MCP server v${SERVER_INFO.version} starting...\n`,
);
transport.start();

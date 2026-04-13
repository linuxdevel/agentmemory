import { describe, expect, it } from "vitest";

import {
  buildOpenCodeSkillSpec,
  mergeOpenCodeConfig,
  rewriteOpenCodeSkillFrontmatter,
} from "../src/integrations/opencode-installer.js";

describe("OpenCode installer helpers", () => {
  it("merges instructions without duplicating existing entries", () => {
    const existing = {
      plugin: ["file:///existing/plugin.js"],
      instructions: [
        "file:///existing/instructions.md",
        "file:///home/abols/.config/opencode/instructions-agentmemory-skills.md",
      ],
      mcp: {
        other: {
          type: "local",
          command: ["node", "other.mjs"],
        },
      },
    };

    const merged = mergeOpenCodeConfig(existing, {
      pluginUrl: "file:///home/abols/.config/opencode/plugins/agentmemory.js",
      instructionUrl:
        "file:///home/abols/.config/opencode/instructions-agentmemory-skills.md",
      mcpCommandNode: "/home/abols/.nvm/versions/node/v22.22.2/bin/node",
      mcpCommandCli: "/opt/agentmemory/dist/cli.mjs",
    });
    const mergedMcp = merged.mcp as Record<string, unknown>;

    expect(merged.plugin).toEqual([
      "file:///existing/plugin.js",
      "file:///home/abols/.config/opencode/plugins/agentmemory.js",
    ]);
    expect(merged.instructions).toEqual([
      "file:///existing/instructions.md",
      "file:///home/abols/.config/opencode/instructions-agentmemory-skills.md",
    ]);
    expect(mergedMcp.other).toEqual({
      type: "local",
      command: ["node", "other.mjs"],
    });
    expect(mergedMcp.agentmemory).toEqual({
      type: "local",
      command: [
        "/home/abols/.nvm/versions/node/v22.22.2/bin/node",
        "/opt/agentmemory/dist/cli.mjs",
        "mcp",
      ],
    });
  });

  it("creates namespaced OpenCode skill specs from Claude-parity names", () => {
    expect(buildOpenCodeSkillSpec("remember")).toEqual({
      sourceDirName: "remember",
      targetDirName: "agentmemory-remember",
      targetSkillName: "agentmemory-remember",
    });
    expect(buildOpenCodeSkillSpec("session-history")).toEqual({
      sourceDirName: "session-history",
      targetDirName: "agentmemory-session-history",
      targetSkillName: "agentmemory-session-history",
    });
  });

  it("uses the provided Node path instead of a hardcoded home directory", () => {
    const merged = mergeOpenCodeConfig(
      {},
      {
        pluginUrl: "file:///plugin.js",
        instructionUrl: "file:///instructions.md",
        mcpCommandNode: "/srv/custom-node/bin/node",
        mcpCommandCli: "/opt/agentmemory/dist/cli.mjs",
      },
    );
    const mergedMcp = merged.mcp as Record<string, unknown>;

    expect(mergedMcp.agentmemory).toEqual({
      type: "local",
      command: ["/srv/custom-node/bin/node", "/opt/agentmemory/dist/cli.mjs", "mcp"],
    });
  });

  it("rewrites skill frontmatter to the namespaced OpenCode skill name", () => {
    const source = `---\nname: remember\ndescription: Save a memory\n---\n\nBody`;

    expect(
      rewriteOpenCodeSkillFrontmatter(source, "agentmemory-remember"),
    ).toContain("name: agentmemory-remember");
  });

  it("fails when a skill frontmatter name field is missing", () => {
    const source = `---\ndescription: Save a memory\n---\n\nBody`;

    expect(() =>
      rewriteOpenCodeSkillFrontmatter(source, "agentmemory-remember"),
    ).toThrow("Skill frontmatter is missing a name field");
  });
});

function appendUnique(values, nextValue) {
  const list = Array.isArray(values)
    ? values.filter((value) => typeof value === "string")
    : [];
  if (!list.includes(nextValue)) {
    list.push(nextValue);
  }
  return list;
}

export function buildOpenCodeSkillSpec(sourceDirName) {
  return {
    sourceDirName,
    targetDirName: `agentmemory-${sourceDirName}`,
    targetSkillName: `agentmemory-${sourceDirName}`,
  };
}

export function rewriteOpenCodeSkillFrontmatter(content, targetSkillName) {
  const lines = content.split("\n");
  if (lines[0] !== "---") {
    throw new Error("Skill frontmatter is missing opening delimiter");
  }

  let closingIndex = -1;
  let nameIndex = -1;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index] === "---") {
      closingIndex = index;
      break;
    }
    if (/^name:\s*.+$/.test(lines[index])) {
      if (nameIndex !== -1) {
        throw new Error("Skill frontmatter contains multiple name fields");
      }
      nameIndex = index;
    }
  }

  if (closingIndex === -1) {
    throw new Error("Skill frontmatter is missing closing delimiter");
  }
  if (nameIndex === -1) {
    throw new Error("Skill frontmatter is missing a name field");
  }

  lines[nameIndex] = `name: ${targetSkillName}`;
  return lines.join("\n");
}

export function mergeOpenCodeConfig(config, input) {
  const next = { ...config };

  next.plugin = appendUnique(next.plugin, input.pluginUrl);
  next.instructions = appendUnique(next.instructions, input.instructionUrl);

  const mcp =
    next.mcp && typeof next.mcp === "object" && !Array.isArray(next.mcp)
      ? { ...next.mcp }
      : {};
  const agentmemory =
    mcp.agentmemory &&
    typeof mcp.agentmemory === "object" &&
    !Array.isArray(mcp.agentmemory)
      ? { ...mcp.agentmemory }
      : {};

  agentmemory.type = "local";
  agentmemory.command = [input.mcpCommandNode, input.mcpCommandCli, "mcp"];

  mcp.agentmemory = agentmemory;
  next.mcp = mcp;

  return next;
}

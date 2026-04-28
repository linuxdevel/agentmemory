const REST_URL = process.env.AGENTMEMORY_URL || "http://127.0.0.1:3111";
const SECRET = process.env.AGENTMEMORY_SECRET || "";

const sessionState = new Map();
let activeSessionId = null;
const toolNames = {
  read: "Read",
  write: "Write",
  edit: "Edit",
  grep: "Grep",
  glob: "Glob",
};

function authHeaders() {
  const headers = { "content-type": "application/json" };
  if (SECRET) headers.authorization = `Bearer ${SECRET}`;
  return headers;
}

function getSession(sessionId) {
  if (!sessionState.has(sessionId)) {
    sessionState.set(sessionId, {
      started: false,
      startupInjected: false,
      lastPrompt: "",
    });
  }
  return sessionState.get(sessionId);
}

async function postJson(path, body, timeout) {
  const response = await fetch(`${REST_URL}${path}`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  });
  if (!response.ok) return null;
  return response.json();
}

function normalizeToolName(tool) {
  return toolNames[String(tool || "").toLowerCase()] || String(tool || "");
}

function getLatestUserText(messages) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.info?.role !== "user") continue;
    const text = (message.parts || [])
      .filter((part) => part?.type === "text" && typeof part.text === "string")
      .map((part) => part.text.trim())
      .filter(Boolean)
      .join("\n\n");
    if (text) return { message, text };
  }
  return null;
}

function getRelevantFiles(toolName, args) {
  const files = [];
  const add = (value) => {
    if (typeof value === "string" && value.length > 0) files.push(value);
  };

  if (toolName === "Read" || toolName === "Write" || toolName === "Edit") {
    add(args?.filePath);
    add(args?.path);
  }

  if (toolName === "Grep") {
    add(args?.path);
    add(args?.file);
  }

  if (toolName === "Glob") {
    add(args?.path);
    add(args?.pattern);
  }

  return [...new Set(files)];
}

function getTerms(toolName, args) {
  if ((toolName === "Grep" || toolName === "Glob") && typeof args?.pattern === "string") {
    return [args.pattern];
  }
  return [];
}

function truncate(value, max) {
  if (typeof value === "string" && value.length > max) {
    return `${value.slice(0, max)}\n[...truncated]`;
  }
  if (typeof value === "object" && value !== null) {
    const serialized = JSON.stringify(value);
    if (serialized.length > max) {
      return `${serialized.slice(0, max)}...[truncated]`;
    }
    return value;
  }
  return value;
}

function stringifyError(value) {
  if (typeof value === "string") return value.slice(0, 4000);
  return JSON.stringify(value ?? "").slice(0, 4000);
}

export async function AgentMemoryPlugin({ directory }) {
  // On process exit, call session/end to trigger crystallization
  let exitHandlerRegistered = false;
  function registerExitHandler() {
    if (exitHandlerRegistered) return;
    exitHandlerRegistered = true;
    const endSession = () => {
      if (!activeSessionId) return;
      try {
        // Synchronous HTTP via fetch with keepalive for exit handlers
        fetch(`${REST_URL}/agentmemory/session/end`, {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({ sessionId: activeSessionId }),
          keepalive: true,
        }).catch(() => {});
      } catch {}
    };
    process.on("beforeExit", endSession);
    process.on("SIGINT", endSession);
    process.on("SIGTERM", endSession);
  }

  return {
    "experimental.chat.system.transform": async (input, output) => {
      const sessionId = input?.sessionID;
      if (!sessionId) return;

      activeSessionId = sessionId;
      registerExitHandler();
      const session = getSession(sessionId);
      if (!session.started) {
        try {
          const result = await postJson(
            "/agentmemory/session/start",
            { sessionId, project: directory, cwd: directory },
            5000,
          );
          if (!result) return;
          session.started = true;
          if (result?.context) {
            session.startupContext = result.context;
          }
        } catch {
          return;
        }
      }

      if (session.startupContext && !session.startupInjected) {
        output.system.push(session.startupContext);
        session.startupInjected = true;
      }
    },

    "experimental.chat.messages.transform": async (_input, output) => {
      const sessionId = output?.sessionID;
      if (!sessionId) return;

      const session = getSession(sessionId);
      const latest = getLatestUserText(output.messages || []);
      const prompt = latest?.text || "";
      const injected = [];

      if (prompt && prompt !== session.lastPrompt) {
        session.lastPrompt = prompt;
        try {
          const result = await postJson(
            "/agentmemory/context",
            { sessionId, project: directory, budget: 1500, prompt },
            5000,
          );
          if (result?.context) injected.push(result.context);
        } catch {
          return;
        }
      }

      if (!latest || injected.length === 0) return;

      latest.message.parts = [
        ...injected.map((text) => ({ type: "text", text })),
        ...latest.message.parts,
      ];
    },

    "tool.execute.before": async (input, output) => {
      const toolName = normalizeToolName(input?.tool);
      if (!Object.values(toolNames).includes(toolName)) return;

      const files = getRelevantFiles(toolName, output?.args || {});
      if (files.length === 0) return;

      try {
        const result = await postJson(
          "/agentmemory/enrich",
          {
            sessionId: input.sessionID,
            files,
            terms: getTerms(toolName, output?.args || {}),
            toolName,
          },
          2000,
        );
      } catch {
        return;
      }
    },

    "tool.execute.after": async (input, output) => {
      const toolName = normalizeToolName(input?.tool);
      const error = output?.metadata?.error || null;
      const hookType = error ? "post_tool_failure" : "post_tool_use";
      const data = error
        ? {
            tool_name: toolName,
            tool_input: stringifyError(input?.args),
            error: stringifyError(error || output?.output),
          }
        : {
            tool_name: toolName,
            tool_input: input?.args,
            tool_output: truncate(output?.output, 8000),
          };

      try {
        await postJson(
          "/agentmemory/observe",
          {
            hookType,
            sessionId: input.sessionID,
            project: directory,
            cwd: directory,
            timestamp: new Date().toISOString(),
            data,
          },
          3000,
        );
      } catch {
        return;
      }
    },
  };
}

export default AgentMemoryPlugin;

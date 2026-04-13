# Agentmemory Skills

Use these installed agentmemory skills when the user explicitly asks for memory actions that should be handled through the shared agentmemory backend:

- `agentmemory-remember` for requests like "remember this", "save this for later", or "store this decision".
- `agentmemory-recall` for requests like "recall", "what did we do before", or "bring back prior context".
- `agentmemory-forget` for requests like "forget this", "delete this memory", or privacy-driven deletion.
- `agentmemory-session-history` for requests like "session history", "what happened last time", or a timeline of prior work.

These skills complement the automatic agentmemory OpenCode plugin. Use the plugin-driven automatic recall/capture path for normal background behavior, and use the skills above for explicit user-directed memory operations.

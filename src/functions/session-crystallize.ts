import type { ISdk } from "iii-sdk";
import { getContext } from "iii-sdk";
import type {
  CompressedObservation,
  MemoryProvider,
  Session,
  Action,
  Crystal,
} from "../types.js";
import { KV, generateId } from "../state/schema.js";
import { StateKV } from "../state/kv.js";

const MIN_OBSERVATIONS = 3;

const EXTRACT_ACTIONS_SYSTEM = `You extract completed work items from a session's observations.
Group related observations into logical tasks that were accomplished.
Return JSON array: [{ "title": "...", "description": "...", "tags": ["..."], "observationIds": ["..."] }]
Each action should represent a distinct unit of work. Use imperative titles (e.g. "Fix auth bug", "Add pagination").
Only include observations that represent meaningful work — skip trivial reads or failed commands.
Return at most 5 actions. If the session is small, 1-2 actions is fine.`;

function buildObservationsPrompt(
  observations: CompressedObservation[],
): string {
  const lines: string[] = ["## Session Observations\n"];
  for (const obs of observations) {
    lines.push(`### [${obs.id}] ${obs.title}`);
    if (obs.narrative) lines.push(obs.narrative);
    if (obs.files.length > 0) lines.push(`Files: ${obs.files.join(", ")}`);
    lines.push("");
  }
  return lines.join("\n");
}

interface ExtractedAction {
  title: string;
  description: string;
  tags: string[];
  observationIds: string[];
}

function parseActions(response: string): ExtractedAction[] {
  try {
    const match = response.match(/\[[\s\S]*\]/);
    if (!match) return [];
    const parsed = JSON.parse(match[0]) as unknown[];
    return parsed
      .filter(
        (item): item is Record<string, unknown> =>
          typeof item === "object" && item !== null && "title" in item,
      )
      .map((item) => ({
        title: String(item.title || ""),
        description: String(item.description || ""),
        tags: Array.isArray(item.tags)
          ? (item.tags as string[]).map(String)
          : [],
        observationIds: Array.isArray(item.observationIds)
          ? (item.observationIds as string[]).map(String)
          : [],
      }))
      .filter((a) => a.title.length > 0);
  } catch {
    return [];
  }
}

export function registerSessionCrystallizeFunction(
  sdk: ISdk,
  kv: StateKV,
  provider: MemoryProvider,
): void {
  sdk.registerFunction(
    {
      id: "mem::session-crystallize",
      description:
        "Extract actions from session observations, crystallize into digest with lessons",
    },
    async (data: { sessionId: string; minObservations?: number }) => {
      const ctx = getContext();
      const sessionId = data.sessionId;
      const minObs = data.minObservations ?? MIN_OBSERVATIONS;

      const session = await kv.get<Session>(KV.sessions, sessionId);
      if (!session) {
        return { success: false, error: "session_not_found" };
      }

      const observations = await kv.list<CompressedObservation>(
        KV.observations(sessionId),
      );
      const meaningful = observations.filter(
        (o) => o.title && o.importance >= 3,
      );

      if (meaningful.length < minObs) {
        ctx.logger.info("Too few observations for crystallization", {
          sessionId,
          count: meaningful.length,
          min: minObs,
        });
        return {
          success: false,
          error: "insufficient_observations",
          count: meaningful.length,
        };
      }

      // Check if session already has crystals
      const existingCrystals = await kv.list<Crystal>(KV.crystals);
      const sessionCrystals = existingCrystals.filter(
        (c) => c.sessionId === sessionId,
      );
      if (sessionCrystals.length > 0) {
        ctx.logger.info("Session already crystallized", { sessionId });
        return {
          success: true,
          skipped: true,
          existingCrystals: sessionCrystals.length,
        };
      }

      // Step 1: Extract actions from observations via LLM
      const prompt = buildObservationsPrompt(meaningful);
      let extractedActions: ExtractedAction[];

      try {
        const response = await provider.summarize(
          EXTRACT_ACTIONS_SYSTEM,
          prompt,
        );
        extractedActions = parseActions(response);
      } catch (err) {
        ctx.logger.error("Failed to extract actions", {
          sessionId,
          error: String(err),
        });
        return { success: false, error: "action_extraction_failed" };
      }

      if (extractedActions.length === 0) {
        ctx.logger.info("No actions extracted from observations", {
          sessionId,
        });
        return { success: false, error: "no_actions_extracted" };
      }

      // Step 2: Create actions in KV and mark as done
      const actionIds: string[] = [];
      const now = new Date().toISOString();

      for (const ea of extractedActions) {
        const action: Action = {
          id: generateId("act"),
          title: ea.title,
          description: ea.description,
          status: "done",
          priority: 5,
          createdAt: now,
          updatedAt: now,
          createdBy: "session-crystallize",
          project: session.project,
          tags: ea.tags,
          sourceObservationIds: ea.observationIds,
          sourceMemoryIds: [],
          result: "Completed during session " + sessionId,
        };

        await kv.set(KV.actions, action.id, action);
        actionIds.push(action.id);
      }

      ctx.logger.info("Actions created from observations", {
        sessionId,
        actionCount: actionIds.length,
      });

      // Step 3: Crystallize the actions
      try {
        const result = (await sdk.trigger("mem::crystallize", {
          actionIds,
          sessionId,
          project: session.project,
        })) as { success: boolean; crystal?: Crystal };

        if (result.success && result.crystal) {
          ctx.logger.info("Session crystallized", {
            sessionId,
            crystalId: result.crystal.id,
            lessons: result.crystal.lessons.length,
          });
          return {
            success: true,
            actionsCreated: actionIds.length,
            crystal: result.crystal,
          };
        }

        return {
          success: false,
          error: "crystallization_failed",
          actionsCreated: actionIds.length,
        };
      } catch (err) {
        ctx.logger.error("Crystallization failed", {
          sessionId,
          error: String(err),
        });
        return {
          success: false,
          error: "crystallization_failed",
          actionsCreated: actionIds.length,
        };
      }
    },
  );
}

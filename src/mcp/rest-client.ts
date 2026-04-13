const DEFAULT_AGENTMEMORY_URL = "http://127.0.0.1:3111";
const DEFAULT_TIMEOUT_MS = 10_000;

function getBaseUrl(): string {
  return (process.env["AGENTMEMORY_URL"] || DEFAULT_AGENTMEMORY_URL).replace(
    /\/+$/,
    "",
  );
}

function getHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const secret = process.env["AGENTMEMORY_SECRET"];
  if (secret) {
    headers.authorization = `Bearer ${secret}`;
  }
  return headers;
}

function getTimeoutMs(): number {
  const value = Number(process.env["AGENTMEMORY_MCP_TIMEOUT_MS"]);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_TIMEOUT_MS;
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

async function readBody(response: Response): Promise<string> {
  try {
    if (typeof response.text === "function") {
      return await response.text();
    }
    if (typeof response.json === "function") {
      return JSON.stringify(await response.json());
    }
    return await response.text();
  } catch {
    return "";
  }
}

function parseBody(body: string): unknown {
  if (!body.trim()) {
    return null;
  }

  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

async function parseResponse(response: Response): Promise<unknown> {
  const payload = parseBody(await readBody(response));
  if (response.ok) {
    return payload;
  }

  if (
    payload &&
    typeof payload === "object" &&
    "error" in payload &&
    typeof payload.error === "string"
  ) {
    throw new Error(payload.error);
  }

  if (typeof payload === "string" && payload.trim()) {
    throw new Error(payload);
  }

  throw new Error(`Request failed with status ${response.status}`);
}

async function fetchMcp(
  path: string,
  init: Omit<RequestInit, "signal">,
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), getTimeoutMs());

  try {
    const response = await fetch(`${getBaseUrl()}${path}`, {
      ...init,
      signal: controller.signal,
    });
    return await parseResponse(response);
  } catch (err) {
    if (isAbortError(err)) {
      throw new Error("Request timed out");
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

export async function getMcp(path: string): Promise<unknown> {
  return fetchMcp(path, {
    method: "GET",
    headers: getHeaders(),
  });
}

export async function postMcp(
  path: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  return fetchMcp(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...getHeaders(),
    },
    body: JSON.stringify(body),
  });
}

import { afterEach, describe, expect, it, vi } from "vitest";

describe("viewer document loading", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("node:fs");
    vi.doUnmock("node:url");
  });

  it("prefers deployed dist viewer template over stale source template", async () => {
    vi.doMock("node:url", async () => {
      const actual = await vi.importActual<typeof import("node:url")>("node:url");
      return {
        ...actual,
        fileURLToPath: () => "/opt/agentmemory/dist/index.mjs",
      };
    });

    vi.doMock("node:fs", () => ({
      readFileSync: (path: string) => {
        const filePath = String(path);
        if (filePath === "/opt/agentmemory/src/viewer/index.html") {
          return "<script nonce=\"__AGENTMEMORY_VIEWER_NONCE__\">old-viewer</script>";
        }
        if (filePath === "/opt/agentmemory/dist/viewer/index.html") {
          return "<script nonce=\"__AGENTMEMORY_VIEWER_NONCE__\">scheduleDashboardRefresh(250) dashboard-stats</script>";
        }
        throw new Error(`missing ${filePath}`);
      },
    }));

    const { renderViewerDocument } = await import("../src/viewer/document.js");
    const rendered = renderViewerDocument();

    expect(rendered.found).toBe(true);
    if (!rendered.found) return;
    expect(rendered.html).toContain("scheduleDashboardRefresh(250)");
    expect(rendered.html).toContain("dashboard-stats");
    expect(rendered.html).not.toContain("old-viewer");
  });
});

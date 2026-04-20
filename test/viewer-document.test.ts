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

  it("includes focus retention hooks for searchable viewer inputs", async () => {
    const { renderViewerDocument } = await import("../src/viewer/document.js");
    const rendered = renderViewerDocument();

    expect(rendered.found).toBe(true);
    if (!rendered.found) return;

    expect(rendered.html).toContain("function captureInputState(inputId)");
    expect(rendered.html).toContain("function restoreInputState(snapshot)");
    expect(rendered.html).toContain("selectionStart");
    expect(rendered.html).toContain("setSelectionRange");
    expect(rendered.html).toContain("captureInputState('mem-search')");
    expect(rendered.html).toContain("captureInputState('lessons-search')");
    expect(rendered.html).toContain("captureInputState('actions-search')");
    expect(rendered.html).toContain("captureInputState('crystals-search')");
  });

  it("includes audit array fallback and shared toolbar markup", async () => {
    const { renderViewerDocument } = await import("../src/viewer/document.js");
    const rendered = renderViewerDocument();

    expect(rendered.found).toBe(true);
    if (!rendered.found) return;

    expect(rendered.html).toContain("Array.isArray(result) ? result : ((result && result.entries) || [])");
    expect(rendered.html).toContain("var html = '<div class=\"toolbar\">';");
    expect(rendered.html).toContain("<input id=\"lessons-search\" class=\"search-input\"");
    expect(rendered.html).toContain("<input id=\"actions-search\" class=\"search-input\"");
    expect(rendered.html).toContain("<input id=\"crystals-search\" class=\"search-input\"");
    expect(rendered.html).toContain("<select id=\"audit-op-filter\"");
  });

  it("styles search-input fields with the shared toolbar theme", async () => {
    const { renderViewerDocument } = await import("../src/viewer/document.js");
    const rendered = renderViewerDocument();

    expect(rendered.found).toBe(true);
    if (!rendered.found) return;

    expect(rendered.html).toContain(".toolbar input, .toolbar .search-input, .toolbar select {");
    expect(rendered.html).toContain(".toolbar input:focus, .toolbar .search-input:focus, .toolbar select:focus {");
  });

  it("reads dashboard graph totals from graph-stats total keys", async () => {
    const { renderViewerDocument } = await import("../src/viewer/document.js");
    const rendered = renderViewerDocument();

    expect(rendered.found).toBe(true);
    if (!rendered.found) return;

    expect(rendered.html).toContain("var nodeCount = (gs.totalNodes !== undefined) ? gs.totalNodes : ((gs.nodes !== undefined) ? gs.nodes : (gs.nodeCount || 0));");
    expect(rendered.html).toContain("var edgeCount = (gs.totalEdges !== undefined) ? gs.totalEdges : ((gs.edges !== undefined) ? gs.edges : (gs.edgeCount || 0));");
  });
});

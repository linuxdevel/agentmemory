import { describe, it, expect } from "vitest";
import { renderViewerDocument } from "../src/viewer/document.js";

describe("viewer document security", () => {
  it("serves a nonce-backed CSP without unsafe-inline script execution", () => {
    const rendered = renderViewerDocument();
    expect(rendered.found).toBe(true);
    if (!rendered.found) return;

    expect(rendered.csp).toContain("script-src 'nonce-");
    expect(rendered.csp).toContain("script-src-attr 'none'");
    expect(rendered.csp).not.toContain("script-src 'unsafe-inline'");
    expect(rendered.html).toContain("<script nonce=\"");
    expect(rendered.html).not.toContain("__AGENTMEMORY_VIEWER_NONCE__");
  });

  it("does not contain inline DOM event handlers", () => {
    const rendered = renderViewerDocument();
    expect(rendered.found).toBe(true);
    if (!rendered.found) return;

    expect(rendered.html).not.toContain("onclick=");
    expect(rendered.html).not.toContain("oninput=");
    expect(rendered.html).not.toContain("onchange=");
    expect(rendered.html).not.toContain("onmouseover=");
    expect(rendered.html).not.toContain("onmouseout=");
  });

  it("loads the current viewer template with scheduled dashboard refreshes", () => {
    const rendered = renderViewerDocument();
    expect(rendered.found).toBe(true);
    if (!rendered.found) return;

    expect(rendered.html).toContain("scheduleDashboardRefresh(250)");
    expect(rendered.html).toContain("dashboard-stats");
  });

  it("renders heap gauge against heapLimit when available", () => {
    const rendered = renderViewerDocument();
    expect(rendered.found).toBe(true);
    if (!rendered.found) return;

    expect(rendered.html).toContain("snap.memory.heapLimit || snap.memory.heapTotal || 0");
    expect(rendered.html).toContain("gauge-value\">' + heapUsed + ' / ' + heapMax + ' MB");
  });

  it("renders dashboard session count from numeric active session total", () => {
    const rendered = renderViewerDocument();
    expect(rendered.found).toBe(true);
    if (!rendered.found) return;

    expect(rendered.html).toContain("var activeSessionCount = d.sessions.filter(function(s) { return s.status === 'active'; }).length;");
    expect(rendered.html).toContain("<div class=\"sub\">' + activeSessionCount + ' active</div>");
    expect(rendered.html).not.toContain("<div class=\"sub\">' + activeSessions + ' active</div>");
  });
});

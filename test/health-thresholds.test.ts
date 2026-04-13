import { describe, expect, it } from "vitest";
import { evaluateHealth } from "../src/health/thresholds.js";
import type { HealthSnapshot } from "../src/types.js";

function makeSnapshot(overrides?: Partial<HealthSnapshot>): HealthSnapshot {
  return {
    connectionState: "connected",
    workers: [],
    memory: {
      heapUsed: 0,
      heapTotal: 1,
      rss: 0,
      external: 0,
      ...(overrides?.memory || {}),
    },
    cpu: {
      userMicros: 0,
      systemMicros: 0,
      percent: 0,
      ...(overrides?.cpu || {}),
    },
    eventLoopLagMs: 0,
    uptimeSeconds: 0,
    kvConnectivity: { status: "ok" },
    status: "healthy",
    alerts: [],
    ...overrides,
  };
}

describe("health thresholds", () => {
  it("does not warn based only on compacted heapTotal", () => {
    const snapshot = makeSnapshot({
      memory: {
        heapUsed: 46 * 1024 * 1024,
        heapTotal: 51 * 1024 * 1024,
        heapLimit: 256 * 1024 * 1024,
        rss: 0,
        external: 0,
      },
    });

    const result = evaluateHealth(snapshot, {
      memoryWarnPercent: 80,
      memoryCriticalPercent: 95,
    });

    expect(result.status).toBe("healthy");
    expect(result.alerts).not.toContain("memory_warn_90%");
  });
});

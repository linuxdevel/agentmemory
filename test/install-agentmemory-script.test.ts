import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("install-agentmemory.sh", () => {
  it("generates a systemd unit that runs the worker entrypoint directly", () => {
    const script = readFileSync("install-agentmemory.sh", "utf8");

    expect(script).toContain("ExecStart=${NODE_BIN} --max-old-space-size=256 ${INSTALL_DIR}/dist/index.mjs");
    expect(script).not.toContain("ExecStart=${NODE_BIN} --max-old-space-size=256 ${INSTALL_DIR}/dist/cli.mjs");
  });

  it("verifies the installed systemd unit matches the expected worker entrypoint", () => {
    const script = readFileSync("install-agentmemory.sh", "utf8");

    expect(script).toContain('expected_execstart="ExecStart=${NODE_BIN} --max-old-space-size=256 ${INSTALL_DIR}/dist/index.mjs"');
    expect(script).toContain('grep -Fqx "${expected_execstart}" "${SYSTEMD_UNIT_PATH}"');
    expect(script).toContain('error "Systemd unit verification failed');
  });
});

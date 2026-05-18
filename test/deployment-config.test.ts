import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("deployment configuration", () => {
  it("does not rely on shell-based Docker healthchecks", () => {
    const compose = readFileSync("docker-compose.yml", "utf8");

    expect(compose).not.toContain("CMD-SHELL");
    expect(compose).not.toContain("wget -q --spider http://127.0.0.1:3111/");
  });
});

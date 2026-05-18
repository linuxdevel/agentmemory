import { createServer } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { isPortOpen } from "../src/engine-readiness.js";

const servers: Array<ReturnType<typeof createServer>> = [];

afterEach(async () => {
  await Promise.all(
    servers.map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((err) => {
            if (err) reject(err);
            else resolve();
          });
        }),
    ),
  );
  servers.length = 0;
});

describe("engine readiness", () => {
  it("returns true when the local port is accepting TCP connections", async () => {
    const server = createServer();
    servers.push(server);

    await new Promise<void>((resolve, reject) => {
      server.listen(0, "127.0.0.1", () => resolve());
      server.on("error", reject);
    });

    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("expected a TCP address");
    }

    await expect(isPortOpen(address.port)).resolves.toBe(true);
  });

  it("returns false when nothing is listening on the local port", async () => {
    await expect(isPortOpen(65500)).resolves.toBe(false);
  });
});

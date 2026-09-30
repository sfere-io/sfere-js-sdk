// @vitest-environment node
import { describe, expect, it } from "vitest";

describe("outside a browser (no window, no document)", () => {
  it("the CDN entry is a no-op", async () => {
    expect(typeof globalThis.window).toBe("undefined");
    await expect(import("../../src/iife")).resolves.toBeDefined();
  });
});

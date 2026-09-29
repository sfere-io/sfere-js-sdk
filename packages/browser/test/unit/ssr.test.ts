// @vitest-environment node
import { describe, expect, it } from "vitest";

describe("server-side import (no window, no document)", () => {
  it("imports and loads without throwing", async () => {
    expect(typeof globalThis.window).toBe("undefined");
    const { SfereAnalytics, sfereEnrichment } = await import("../../src/index");
    const sfere = SfereAnalytics.load({ writeKey: "k:s", host: "https://ingest.example.com" });
    expect(() => sfere.setConsent({ analytics: true })).not.toThrow();
    await expect(sfere.track("server")).resolves.toBeUndefined();
    expect((sfere as unknown as { then?: unknown }).then).toBeUndefined();

    const plugin = sfereEnrichment();
    const ctx = { event: { type: "track", messageId: "m", properties: {} } } as never;
    expect(() => plugin.track!(ctx)).not.toThrow();
  });

  it("the script-tag entry is a no-op on the server", async () => {
    await expect(import("../../src/cdn/iife")).resolves.toBeDefined();
  });
});

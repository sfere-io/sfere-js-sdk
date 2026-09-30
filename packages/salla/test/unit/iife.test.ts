import { beforeEach, describe, expect, it, vi } from "vitest";

type Win = Window & { Salla?: unknown; sfere?: unknown; SfereSalla?: unknown };
const win = window as Win;

beforeEach(() => {
  vi.resetModules();
  delete win.Salla;
  delete win.sfere;
  delete win.SfereSalla;
  document.head.innerHTML = "";
});

describe("CDN entry", () => {
  it("finds its own <script> by src when document.currentScript is not set", async () => {
    const own = document.createElement("script");
    own.setAttribute("src", "https://cdn.sfere.io/integrations/salla/v0.1.0/sfere-salla.min.js");
    own.setAttribute("data-write-key", "wk");
    own.setAttribute("data-host", "https://ingest.example.com");
    document.head.appendChild(own);
    const registerTracker = vi.fn();
    win.Salla = { onReady: (cb: () => void) => cb(), analytics: { registerTracker } };

    await import("../../src/iife");
    expect(registerTracker).toHaveBeenCalledTimes(1);
    expect(win.SfereSalla).toBeDefined();
  });

  it("stays inert without a configured tag", async () => {
    await import("../../src/iife");
    expect(win.SfereSalla).toBeUndefined();
    expect(win.sfere).toBeUndefined();
  });
});

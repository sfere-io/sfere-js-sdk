import { beforeEach, describe, expect, it, vi } from "vitest";
import { install } from "../../src/cdn/install";
import { captureFetch, clearBrowserState, uniqueKey } from "./helpers";

type Win = Window & { SfereSDK?: unknown; sfere?: unknown };

function script(attrs: Record<string, string>): HTMLScriptElement {
  const el = document.createElement("script");
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

/** The loader snippet's stub, as src/cdn/snippet.html builds it. */
function stub(): unknown[] & Record<string, (...args: unknown[]) => void> {
  const q = [] as unknown as unknown[] & Record<string, (...args: unknown[]) => void>;
  for (const m of ["track", "page", "identify", "group", "alias", "reset", "setConsent"]) {
    q[m] = (...args: unknown[]) => void q.push([m, ...args]);
  }
  return q;
}

beforeEach(() => {
  clearBrowserState();
  delete (window as Win).SfereSDK;
  delete (window as Win).sfere;
});

describe("script-tag install", () => {
  it("exposes window.SfereSDK without auto-init when data attributes are missing", () => {
    const sdk = install(window, script({ src: "https://cdn.sfere.io/sdk/v0.1/sfere.min.js" }));
    expect((window as Win).SfereSDK).toBe(sdk);
    expect(Object.keys(sdk).sort()).toEqual(["load", "sfereEnrichment", "version"]);
    expect((window as Win).sfere).toBeUndefined();
  });

  it("auto-inits from data-write-key/data-host and replays the queued stub", async () => {
    const requests = captureFetch();
    const q = stub();
    q.setConsent!({ advertising: true });
    q.page!();
    q.track!("add_to_cart", { value: 5 });
    q.bogus = undefined as never;
    q.push(["notAMethod"], "not-a-call");
    (window as Win).sfere = q;

    install(
      window,
      script({
        src: "https://cdn.sfere.io/sdk/v0.1/sfere.min.js",
        "data-write-key": uniqueKey(),
        "data-host": "https://ingest.example.com",
      }),
    );
    const instance = (window as Win).sfere as PromiseLike<[{ settings: { cdnURL: string } }]>;
    expect(Array.isArray(instance)).toBe(false);
    const [analytics] = await instance;
    expect(analytics.settings.cdnURL).toBe("https://cdn.sfere.io");

    await vi.waitFor(() => expect(requests).toHaveLength(2));
    expect(requests.map((r) => r.url)).toEqual([
      "https://ingest.example.com/api/s/p",
      "https://ingest.example.com/api/s/t",
    ]);
    const ctx = requests[1]!.body.context as Record<string, unknown>;
    expect(ctx.consent).toEqual({ categoryPreferences: { advertising: true } });
  });

  it("forwards calls made later on a kept reference to the stub", async () => {
    const requests = captureFetch();
    const q = stub();
    (window as Win).sfere = q;
    install(
      window,
      script({ "data-write-key": uniqueKey(), "data-host": "https://ingest.example.com" }),
    );
    // `q` is the pre-load stub a page might have captured in a variable; it must now hit the
    // live instance instead of queueing into a list nobody drains.
    q.setConsent!({ analytics: true });
    await (q.track!("late_call", { n: 1 }) as unknown as Promise<unknown>);
    expect(q).toHaveLength(0);
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]!.url).toBe("https://ingest.example.com/api/s/t");
    expect(requests[0]!.body.event).toBe("late_call");
    const ctx = requests[0]!.body.context as Record<string, unknown>;
    expect(ctx.consent).toEqual({ categoryPreferences: { analytics: true } });
  });

  it("honours data-batching", async () => {
    const requests = captureFetch();
    install(
      window,
      script({
        "data-write-key": uniqueKey(),
        "data-host": "https://ingest.example.com",
        "data-batching": "true",
      }),
    );
    const sfere = (window as Win).sfere as { track: (e: string) => Promise<unknown> };
    await sfere.track("batched");
    await vi.waitFor(() => expect(requests).toHaveLength(1), { timeout: 8_000 });
    expect(requests[0]!.url).toBe("https://ingest.example.com/v1/batch/b");
  }, 10_000);

  it("never replaces an already loaded instance", () => {
    const loaded = { track: () => undefined };
    (window as Win).sfere = loaded;
    install(window, script({ "data-write-key": "k", "data-host": "https://ingest.example.com" }));
    expect((window as Win).sfere).toBe(loaded);
  });

  it("SfereSDK.load defaults cdnURL to the bundle origin, and tolerates no script", async () => {
    captureFetch();
    const sdk = install(window, null);
    const sfere = sdk.load({ writeKey: uniqueKey(), host: "https://ingest.example.com" });
    const [analytics] = await sfere;
    expect(analytics.settings.cdnURL).toBe("https://ingest.example.com");

    const fromCdn = install(window, script({ src: "https://cdn.sfere.io/sdk/v0.1/sfere.min.js" }));
    const [a2] = await fromCdn.load({ writeKey: uniqueKey(), host: "https://ingest.example.com" });
    expect(a2.settings.cdnURL).toBe("https://cdn.sfere.io");
  });

  it("the iife entry installs on import, finding the tag by its data attributes", async () => {
    captureFetch();
    const tag = script({
      "data-write-key": uniqueKey(),
      "data-host": "https://ingest.example.com",
    });
    document.head.appendChild(tag);
    await import("../../src/cdn/iife");
    expect((window as Win).SfereSDK).toBeDefined();
    expect((window as Win).sfere).toBeDefined();
    tag.remove();
  });
});

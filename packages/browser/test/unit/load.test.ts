import { beforeEach, describe, expect, it, vi } from "vitest";
import { SfereAnalytics, sfereEnrichment, version } from "../../src/index";
import { captureFetch, clearBrowserState, setCookie, setUrl, uniqueKey } from "./helpers";

const asRecord = (v: unknown): Record<string, unknown> => (v ?? {}) as Record<string, unknown>;

const HOST = "https://ingest.example.com";

beforeEach(clearBrowserState);

describe("load() argument validation", () => {
  it("rejects a missing writeKey", () => {
    expect(() => SfereAnalytics.load({ host: HOST } as never)).toThrow('"writeKey" is required');
    expect(() => SfereAnalytics.load({ writeKey: "  ", host: HOST })).toThrow(
      '"writeKey" is required',
    );
    expect(() => SfereAnalytics.load(undefined as never)).toThrow('"writeKey" is required');
  });

  it("rejects a missing or non-http host", () => {
    expect(() => SfereAnalytics.load({ writeKey: "k" } as never)).toThrow('"host" is required');
    expect(() => SfereAnalytics.load({ writeKey: "k", host: "ingest.example.com" })).toThrow(
      '"host" is required',
    );
    expect(() => SfereAnalytics.load({ writeKey: "k", host: "ftp://ingest.example.com" })).toThrow(
      "http(s) origin",
    );
  });

  it("rejects a host with a path", () => {
    expect(() => SfereAnalytics.load({ writeKey: "k", host: `${HOST}/api/s` })).toThrow(
      `Use "${HOST}"`,
    );
  });

  it("exports the enrichment factory and a version string", () => {
    expect(typeof sfereEnrichment).toBe("function");
    expect(version).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe("standard delivery", () => {
  it("posts each event to {host}/api/s/{t|p|i|g|a} with Basic auth", async () => {
    const requests = captureFetch();
    const writeKey = uniqueKey();
    const sfere = SfereAnalytics.load({ writeKey, host: HOST });
    await sfere.track("purchase", { value: 10, currency: "SAR", transaction_id: "o1" });
    await sfere.page();
    await sfere.identify("user-1", { email: "a@b.test" });
    await sfere.group("g1");
    await sfere.alias("user-2");

    expect(requests.map((r) => r.url)).toEqual([
      `${HOST}/api/s/t`,
      `${HOST}/api/s/p`,
      `${HOST}/api/s/i`,
      `${HOST}/api/s/g`,
      `${HOST}/api/s/a`,
    ]);
    expect(requests[0]!.headers.Authorization).toBe(`Basic ${btoa(`${writeKey}:`)}`);
  });

  it("carries identify traits into context.traits on later events, and not on identify", async () => {
    const requests = captureFetch();
    const sfere = SfereAnalytics.load({ writeKey: uniqueKey(), host: HOST });
    await sfere.track("before_identify");
    await sfere.identify("a@b.test", { email: "a@b.test", phone: "+966500000000" });
    await sfere.track("generate_lead", { form_type: "demo" });
    await sfere.page();

    const [before, identify, lead, page] = requests.map((r) => r.body);
    expect(asRecord(before!.context).traits).toBeUndefined();
    expect(identify!.traits).toEqual({ email: "a@b.test", phone: "+966500000000" });
    expect(asRecord(identify!.context).traits).toBeUndefined();
    expect(asRecord(lead!.context).traits).toEqual({ email: "a@b.test", phone: "+966500000000" });
    expect(asRecord(page!.context).traits).toEqual({ email: "a@b.test", phone: "+966500000000" });
  });

  it("does not carry traits when carryTraits is false", async () => {
    const requests = captureFetch();
    const sfere = SfereAnalytics.load({ writeKey: uniqueKey(), host: HOST, carryTraits: false });
    await sfere.identify("u1", { email: "a@b.test" });
    await sfere.track("generate_lead");
    expect(asRecord(requests[1]!.body.context).traits).toBeUndefined();
  });

  it("uses http for an http host", async () => {
    const requests = captureFetch();
    const sfere = SfereAnalytics.load({ writeKey: uniqueKey(), host: "http://localhost:8080" });
    await sfere.track("x");
    expect(requests[0]!.url).toBe("http://localhost:8080/api/s/t");
  });

  it("sends no _metadata and no integrations the caller did not set", async () => {
    const requests = captureFetch();
    setCookie("_fbp", "fb.1.1.FBP");
    setUrl("?gclid=G1");
    const sfere = SfereAnalytics.load({ writeKey: uniqueKey(), host: HOST });
    await sfere.track("add_to_cart", { items: [{ item_id: "sku" }] });

    const body = requests[0]!.body;
    expect(body).not.toHaveProperty("_metadata");
    expect(body).not.toHaveProperty("integrations");
    expect(body).not.toHaveProperty("toJSON");
    expect(body.event).toBe("add_to_cart");
    const context = body.context as Record<string, unknown>;
    expect(context.clientIds).toEqual({ fbp: "fb.1.1.FBP", gclid: "G1" });
    expect(context.session).toEqual({ id: expect.any(Number) });
    const properties = body.properties as Record<string, unknown>;
    expect(properties.sfere_dedup_id).toBe(body.messageId);
  });

  it("keeps integrations the caller set on the call", async () => {
    const requests = captureFetch();
    const sfere = SfereAnalytics.load({ writeKey: uniqueKey(), host: HOST });
    await sfere.track("x", {}, { integrations: { Mixpanel: false } });
    expect(requests[0]!.body.integrations).toEqual({ Mixpanel: false });
  });

  it("carries no _metadata.retryCount when an event is retried", async () => {
    let calls = 0;
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        bodies.push(JSON.parse(init.body as string));
        return new Response("{}", { status: ++calls === 1 ? 500 : 200 });
      }),
    );
    const sfere = SfereAnalytics.load({ writeKey: uniqueKey(), host: HOST });
    await sfere.track("retry-me");
    await vi.waitFor(() => expect(bodies.length).toBeGreaterThanOrEqual(2), { timeout: 10_000 });
    for (const body of bodies) expect(body).not.toHaveProperty("_metadata");
  }, 15_000);

  it("reflects setConsent on later events", async () => {
    const requests = captureFetch();
    const sfere = SfereAnalytics.load({
      writeKey: uniqueKey(),
      host: HOST,
      consent: { analytics: true },
    });
    await sfere.track("before");
    sfere.setConsent({ analytics: true, advertising: true });
    await sfere.track("after");
    const consent = requests.map((r) => (r.body.context as Record<string, unknown>).consent);
    expect(consent).toEqual([
      { categoryPreferences: { analytics: true } },
      { categoryPreferences: { analytics: true, advertising: true } },
    ]);
  });

  it("only ever talks to the configured host: no settings fetch, no /m metrics", async () => {
    const requests = captureFetch();
    const sfere = SfereAnalytics.load({ writeKey: uniqueKey(), host: HOST });
    await sfere;
    await sfere.track("a");
    await sfere.page();
    const [analytics] = await sfere;
    expect(analytics.settings.cdnURL).toBe(HOST);
    expect(requests.length).toBeGreaterThan(0);
    for (const { url } of requests) {
      expect(url.startsWith(`${HOST}/api/s/`)).toBe(true);
      expect(url).not.toMatch(/\/m$|segment\.(com|io)/);
    }
  });

  it("uses an explicit cdnURL and turns on debug", async () => {
    captureFetch();
    const sfere = SfereAnalytics.load({
      writeKey: uniqueKey(),
      host: HOST,
      cdnURL: "https://cdn.sfere.io",
      debug: true,
    });
    const [analytics] = await sfere;
    expect(analytics.settings.cdnURL).toBe("https://cdn.sfere.io");
  });
});

describe("blocked storage: the persistence probe", () => {
  const boom = () => {
    throw new DOMException("blocked", "SecurityError");
  };
  type Loaded = [
    { options: { disableClientPersistence?: boolean }; queue: { plugins: { name: string }[] } },
  ];
  const pluginNames = (analytics: Loaded[0]) => analytics.queue.plugins.map((p) => p.name);

  it("stays on the default persistence when storage and cookies work, and leaves no probe residue", async () => {
    captureFetch();
    const sfere = SfereAnalytics.load({ writeKey: uniqueKey(), host: HOST });
    const [analytics] = (await sfere) as unknown as Loaded;
    expect(analytics.options.disableClientPersistence).toBe(false);
    expect(localStorage.getItem("sfere_probe")).toBeNull();
    expect(document.cookie).not.toContain("sfere_probe");
    expect(pluginNames(analytics)).toContain("Page Enrichment");
    expect(pluginNames(analytics)).not.toContain("Sfere Environment");
  });

  /** Shadows the prototype accessor on the instance so both directions throw; `delete` restores it. */
  function blockCookies(): () => void {
    Object.defineProperty(document, "cookie", { configurable: true, get: boom, set: boom });
    return () => {
      delete (document as unknown as Record<string, unknown>).cookie;
    };
  }

  it("switches to in-memory persistence when localStorage throws, and still delivers", async () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(boom);
    const requests = captureFetch();
    const sfere = SfereAnalytics.load({ writeKey: uniqueKey(), host: HOST });
    await sfere.track("blocked");
    const [analytics] = (await sfere) as unknown as Loaded;
    expect(analytics.options.disableClientPersistence).toBe(true);
    expect(pluginNames(analytics)).toContain("Page Enrichment");
    expect(requests).toHaveLength(1);
    expect(requests[0]!.body.anonymousId).toEqual(expect.any(String));
  });

  it("switches to in-memory persistence and a cookie-free environment plugin when document.cookie throws", async () => {
    const unblock = blockCookies();
    try {
      setUrl("?utm_source=meta&utm_campaign=spring");
      const requests = captureFetch();
      const sfere = SfereAnalytics.load({ writeKey: uniqueKey(), host: HOST });
      await sfere.track("blocked");
      const [analytics] = (await sfere) as unknown as Loaded;
      expect(analytics.options.disableClientPersistence).toBe(true);
      expect(pluginNames(analytics)).not.toContain("Page Enrichment");
      expect(pluginNames(analytics)).toContain("Sfere Environment");
      expect(requests).toHaveLength(1);
      const body = requests[0]!.body;
      expect(body.anonymousId).toEqual(expect.any(String));
      const context = body.context as Record<string, unknown>;
      expect(context.userAgent).toEqual(expect.any(String));
      expect(context.campaign).toEqual({ source: "meta", name: "spring" });
      expect(context.library).toEqual({
        name: "@sfere-io/sfere-sdk",
        version,
        base: expect.stringMatching(/^analytics-next@\d+\.\d+\.\d+/),
      });
    } finally {
      unblock();
    }
  });

  it("switches to in-memory persistence when localStorage silently fails the read-back", async () => {
    const silent = { setItem: () => undefined, getItem: () => null, removeItem: () => undefined };
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => silent as unknown as Storage);
    captureFetch();
    const [analytics] = (await SfereAnalytics.load({
      writeKey: uniqueKey(),
      host: HOST,
    })) as unknown as Loaded;
    expect(analytics.options.disableClientPersistence).toBe(true);
  });

  it("can be forced by the caller while keeping the default environment plugin", async () => {
    captureFetch();
    const [analytics] = (await SfereAnalytics.load({
      writeKey: uniqueKey(),
      host: HOST,
      disableClientPersistence: true,
    })) as unknown as Loaded;
    expect(analytics.options.disableClientPersistence).toBe(true);
    expect(pluginNames(analytics)).toContain("Page Enrichment");
  });
});

describe("batching delivery", () => {
  it("posts batches to {host}/v1/batch/b without _metadata or integrations", async () => {
    const requests = captureFetch();
    const writeKey = uniqueKey();
    const sfere = SfereAnalytics.load({ writeKey, host: HOST, batching: { size: 2, timeout: 50 } });
    await sfere.track("one");
    await sfere.track("two", {}, { integrations: { Foo: false } });

    await vi.waitFor(() => expect(requests).toHaveLength(1));
    const { url, body, headers } = requests[0]!;
    expect(url).toBe(`${HOST}/v1/batch/b`);
    expect(headers.Authorization).toBe(`Basic ${btoa(`${writeKey}:`)}`);
    const batch = body.batch as Record<string, unknown>[];
    expect(batch.map((e) => e.event)).toEqual(["one", "two"]);
    for (const event of batch) expect(event).not.toHaveProperty("_metadata");
    expect(batch[0]).not.toHaveProperty("integrations");
    expect(batch[1]!.integrations).toEqual({ Foo: false });
  });

  it("batching: true uses the defaults and flushes on timeout", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const requests = captureFetch();
    const sfere = SfereAnalytics.load({
      writeKey: uniqueKey(),
      host: "http://localhost:9000",
      batching: true,
    });
    await sfere.track("solo");
    expect(requests).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(5_000);
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]!.url).toBe("http://localhost:9000/v1/batch/b");
    vi.useRealTimers();
  });
});

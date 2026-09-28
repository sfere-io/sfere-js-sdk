import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sfereEnrichment } from "../../src/plugins/enrichment";
import { clearBrowserState, fakeCtx, setCookie, setUrl } from "./helpers";

const ALLOWED_KEYS = [
  "fbp",
  "fbc",
  "ttp",
  "ttclid",
  "scid",
  "scclid",
  "epik",
  "li_fat_id",
  "msclkid",
  "oppref",
  "gclid",
  "wbraid",
  "gbraid",
  "twclid",
  "rdt_cid",
];

function run(plugin = sfereEnrichment(), event?: Parameters<typeof fakeCtx>[0]) {
  const ctx = fakeCtx(event);
  plugin.track!(ctx);
  return ctx.event;
}

const ids = (event: ReturnType<typeof run>) => event.context?.clientIds as Record<string, string>;

beforeEach(clearBrowserState);
afterEach(() => vi.useRealTimers());

describe("plugin shape", () => {
  it("is an enrichment plugin that is always loaded", async () => {
    const plugin = sfereEnrichment();
    expect(plugin.type).toBe("enrichment");
    expect(plugin.name).toBe("Sfere Enrichment");
    expect(plugin.isLoaded()).toBe(true);
    await expect(plugin.load(fakeCtx(), {} as never)).resolves.toBeUndefined();
    for (const method of ["track", "page", "identify", "group", "alias", "screen"] as const) {
      expect(typeof plugin[method]).toBe("function");
    }
  });
});

describe("context.clientIds from cookies", () => {
  it("maps every pixel cookie to its clientIds key", () => {
    const cookies: Record<string, [string, string]> = {
      _fbp: ["fbp", "fb.1.1727500000000.123"],
      _fbc: ["fbc", "fb.1.1727500000000.FBC"],
      _ttp: ["ttp", "TTP"],
      ttclid: ["ttclid", "TTCLID"],
      _scid: ["scid", "SCID"],
      _scclid: ["scclid", "SCCLID"],
      _epik: ["epik", "EPIK"],
      li_fat_id: ["li_fat_id", "LI"],
      _uetmsclkid: ["msclkid", "_uetMSCLK"],
      __oppref: ["oppref", "OPPREF"],
    };
    for (const [cookie, [, value]] of Object.entries(cookies)) setCookie(cookie, value);
    const got = ids(run());
    for (const [key, value] of Object.values(cookies)) expect(got[key]).toBe(value);
  });

  it("reads gclid from _gcl_aw as the text after the second dot", () => {
    setCookie("_gcl_aw", "GCL.1727500000.abc.def");
    expect(ids(run()).gclid).toBe("abc.def");
  });

  it("falls back to _gcl_dc and ignores malformed values", () => {
    setCookie("_gcl_dc", "GCL.1727500000.DC");
    expect(ids(run()).gclid).toBe("DC");
    clearBrowserState();
    setCookie("_gcl_aw", "garbage");
    expect(ids(run()).gclid).toBeUndefined();
  });

  it("only ever emits the agreed clientIds keys", () => {
    setCookie("_fbp", "x");
    setCookie("_ga", "GA1.1.1.1");
    setUrl("?gclid=G&utm_source=s&fbclid=F&unknown=1");
    expect(Object.keys(ids(run())).every((k) => ALLOWED_KEYS.includes(k))).toBe(true);
  });

  it("lets clientIds set by the caller win", () => {
    setCookie("_fbp", "cookie");
    const event = run(sfereEnrichment(), { context: { clientIds: { fbp: "caller" } } });
    expect(ids(event).fbp).toBe("caller");
  });
});

describe("context.clientIds from the URL", () => {
  it("maps every click-ID parameter", () => {
    setUrl(
      "?gclid=G&wbraid=W&gbraid=GB&ttclid=T&ScCid=SC&twclid=TW&epik=E&msclkid=M&li_fat_id=L&oppref=O&rdt_cid=R",
    );
    expect(ids(run())).toEqual({
      gclid: "G",
      wbraid: "W",
      gbraid: "GB",
      ttclid: "T",
      scclid: "SC",
      twclid: "TW",
      epik: "E",
      msclkid: "M",
      li_fat_id: "L",
      oppref: "O",
      rdt_cid: "R",
    });
  });

  it("persists click IDs for the session and lets a newer click replace an older one", () => {
    const plugin = sfereEnrichment();
    setUrl("?gclid=FIRST");
    run(plugin);
    setUrl("");
    expect(ids(run(plugin)).gclid).toBe("FIRST");
    expect(sessionStorage.getItem("sfere_click_ids")).toContain("FIRST");
    setUrl("?gclid=SECOND");
    expect(ids(run(plugin)).gclid).toBe("SECOND");
    setUrl("");
    expect(ids(run(sfereEnrichment())).gclid).toBe("SECOND");
  });

  it("uses localStorage when clickIdStorage is local", () => {
    setUrl("?ttclid=T1");
    run(sfereEnrichment({ clickIdStorage: "local" }));
    expect(localStorage.getItem("sfere_click_ids")).toContain("T1");
    expect(sessionStorage.getItem("sfere_click_ids")).toBeNull();
  });

  it("URL click IDs override the same cookie", () => {
    setCookie("ttclid", "COOKIE");
    setUrl("?ttclid=URL");
    expect(ids(run()).ttclid).toBe("URL");
  });

  it("builds fbc = fb.1.<ms>.<fbclid> from fbclid", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(1_727_500_000_123);
    setUrl("?fbclid=ABC");
    expect(ids(run()).fbc).toBe("fb.1.1727500000123.ABC");
  });

  it("keeps the first fbc timestamp while the same fbclid stays in the URL", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const plugin = sfereEnrichment();
    vi.setSystemTime(1000);
    setUrl("?fbclid=ABC");
    run(plugin);
    vi.setSystemTime(5000);
    expect(ids(run(plugin)).fbc).toBe("fb.1.1000.ABC");
  });
});

describe("fbc precedence: URL vs pixel cookie", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(2_000_000_000_000);
  });

  it("uses the cookie when the URL has no fbclid", () => {
    setCookie("_fbc", "fb.1.1.COOKIE");
    expect(ids(run()).fbc).toBe("fb.1.1.COOKIE");
  });

  it("a newer URL fbclid beats an older pixel cookie", () => {
    setCookie("_fbc", "fb.1.1727500000000.OLD");
    setUrl("?fbclid=NEW");
    expect(ids(run()).fbc).toBe("fb.1.2000000000000.NEW");
  });

  it("the pixel cookie wins when it carries the same click", () => {
    setCookie("_fbc", "fb.1.1999999999999.SAME");
    setUrl("?fbclid=SAME");
    expect(ids(run()).fbc).toBe("fb.1.1999999999999.SAME");
  });

  it("the pixel cookie wins when it is newer than the URL click", () => {
    const plugin = sfereEnrichment();
    setUrl("?fbclid=OLDURL");
    run(plugin);
    setUrl("");
    setCookie("_fbc", "fb.1.2000000000500.NEWER");
    expect(ids(run(plugin)).fbc).toBe("fb.1.2000000000500.NEWER");
  });
});

describe("context.campaign gad_* parameters", () => {
  it("merges gad_source and gad_campaignid into the existing campaign object", () => {
    setUrl("?gad_source=1&gad_campaignid=999");
    const event = run(sfereEnrichment(), {
      context: { campaign: { source: "google", medium: "cpc", name: "spring" } },
    });
    expect(event.context?.campaign).toEqual({
      source: "google",
      medium: "cpc",
      name: "spring",
      gad_source: "1",
      gad_campaignid: "999",
    });
  });

  it("persists them for the session and adds nothing when absent", () => {
    const plugin = sfereEnrichment();
    expect(run(plugin).context?.campaign).toBeUndefined();
    setUrl("?gad_source=5");
    run(plugin);
    setUrl("");
    expect(run(plugin).context?.campaign).toEqual({ gad_source: "5" });
  });
});

describe("context.session", () => {
  it("keeps one id while active and rotates after 30 minutes idle", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const plugin = sfereEnrichment();
    const first = (run(plugin).context?.session as { id: number }).id;
    expect(first).toBe(1_000_000);
    vi.advanceTimersByTime(29 * 60_000);
    expect((run(plugin).context?.session as { id: number }).id).toBe(first);
    vi.advanceTimersByTime(29 * 60_000); // active again 29 min later: still the same session
    expect((run(plugin).context?.session as { id: number }).id).toBe(first);
    vi.advanceTimersByTime(30 * 60_000 + 1);
    const rotated = (run(plugin).context?.session as { id: number }).id;
    expect(rotated).not.toBe(first);
    expect(JSON.parse(localStorage.getItem("sfere_session")!).id).toBe(rotated);
  });

  it("honours sessionTimeoutMinutes and emits only { id }", () => {
    vi.useFakeTimers();
    vi.setSystemTime(5_000_000);
    const plugin = sfereEnrichment({ sessionTimeoutMinutes: 1 });
    const first = run(plugin).context?.session;
    expect(first).toEqual({ id: 5_000_000 });
    vi.advanceTimersByTime(61_000);
    expect(run(plugin).context?.session).not.toEqual(first);
  });

  it("replaces a corrupt stored session", () => {
    localStorage.setItem("sfere_session", '{"id":"nope"}');
    expect(typeof (run().context?.session as { id: unknown }).id).toBe("number");
  });
});

describe("context.consent", () => {
  it("is omitted when unset", () => {
    expect(run().context).not.toHaveProperty("consent");
  });

  it("comes from the consent option, then from setConsent", () => {
    const plugin = sfereEnrichment({ consent: { analytics: true } });
    expect(run(plugin).context?.consent).toEqual({ categoryPreferences: { analytics: true } });
    plugin.setConsent({ analytics: true, advertising: false });
    expect(run(plugin).context?.consent).toEqual({
      categoryPreferences: { analytics: true, advertising: false },
    });
  });
});

describe("context.library", () => {
  it("names this SDK and keeps the base library under `base`, replacing what was there", () => {
    const event = run(sfereEnrichment(), {
      context: { library: { name: "analytics.js", version: "npm:next-1.84.3" } },
    });
    expect(event.context?.library).toEqual({
      name: "@fanfinity/sfere-sdk",
      version: expect.stringMatching(/^\d+\.\d+\.\d+/),
      base: expect.stringMatching(/^analytics-next@\d+\.\d+\.\d+/),
    });
  });
});

describe("context.page.lang", () => {
  it("adds the document language to the page object when set", () => {
    document.documentElement.lang = "ar";
    const event = run(sfereEnrichment(), { context: { page: { url: "https://x.test/" } } });
    expect(event.context?.page).toEqual({ url: "https://x.test/", lang: "ar" });
  });

  it("adds nothing when the document has no lang", () => {
    expect(run().context?.page).toBeUndefined();
  });
});

describe("properties.sfere_dedup_id", () => {
  it("defaults to the messageId on track", () => {
    const event = run(sfereEnrichment(), { messageId: "ajs-next-123" });
    expect((event.properties as Record<string, unknown>).sfere_dedup_id).toBe("ajs-next-123");
  });

  it("keeps a value the site set", () => {
    const event = run(sfereEnrichment(), { properties: { sfere_dedup_id: "order-42" } });
    expect((event.properties as Record<string, unknown>).sfere_dedup_id).toBe("order-42");
  });

  it("creates properties when missing and is not added to other event types", () => {
    const tracked = run(sfereEnrichment(), { properties: undefined, messageId: "m" });
    expect(tracked.properties).toEqual({ sfere_dedup_id: "m" });
    const ctx = fakeCtx({ type: "page", properties: {} });
    sfereEnrichment().page!(ctx);
    expect(ctx.event.properties).toEqual({});
  });
});

describe("wire format (toJSON)", () => {
  it("drops _metadata and empty integrations, keeps caller integrations", () => {
    const event = run(sfereEnrichment(), { integrations: {} });
    const wire = JSON.parse(JSON.stringify({ ...event, _metadata: { bundled: [] } }));
    expect(wire).not.toHaveProperty("_metadata");
    expect(wire).not.toHaveProperty("integrations");
    expect(wire).not.toHaveProperty("toJSON");
    const withIntegrations = run(sfereEnrichment(), { integrations: { Foo: false } });
    expect(JSON.parse(JSON.stringify(withIntegrations)).integrations).toEqual({ Foo: false });
  });
});

describe("blocked storage and cookies", () => {
  it("never throws and keeps session and click IDs in memory", () => {
    const boom = () => {
      throw new DOMException("blocked", "SecurityError");
    };
    vi.spyOn(window, "localStorage", "get").mockImplementation(boom);
    vi.spyOn(window, "sessionStorage", "get").mockImplementation(boom);
    vi.spyOn(document, "cookie", "get").mockImplementation(boom);

    const plugin = sfereEnrichment();
    setUrl("?gclid=MEM");
    const first = run(plugin);
    setUrl("");
    const second = run(plugin);
    expect(ids(second).gclid).toBe("MEM");
    expect(second.context?.session).toEqual(first.context?.session);
  });

  it("survives storage that throws on write", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    setUrl("?gclid=Q");
    expect(ids(run()).gclid).toBe("Q");
  });

  it("survives an unreadable location", () => {
    vi.spyOn(window, "location", "get").mockImplementation(() => {
      throw new Error("no location");
    });
    expect(() => run()).not.toThrow();
  });
});

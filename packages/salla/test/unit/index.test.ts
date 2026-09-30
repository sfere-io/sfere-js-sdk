import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BOOT_ATTEMPTS,
  BOOT_INTERVAL_MS,
  install,
  SDK_INTEGRITY,
  SDK_SRC,
  SDK_VERSION,
  SOURCE,
  version,
  type SallaGlobal,
  type SallaTracker,
} from "../../src/index";
import { readConfig, readRemoteConfig } from "../../src/config";

type Call = [string, ...unknown[]];
type Win = Window & {
  Salla?: SallaGlobal;
  salla?: SallaGlobal;
  sfere?: unknown;
  SfereSalla?: unknown;
  SFERE_DEBUG?: unknown;
};
const win = window as Win;

const HOST = "https://ingest.example.com";

function tag(attrs: Record<string, string>, src?: string): HTMLScriptElement {
  const el = document.createElement("script");
  if (src) el.src = src;
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

const configured = (extra: Record<string, string> = {}) =>
  tag({ "data-write-key": "wk", "data-host": HOST, ...extra });

/** A mocked storefront global: `Salla.onReady`, `Salla.analytics`, `Salla.config`. */
function mockSalla(config: Record<string, unknown> = { "store.id": 42 }) {
  const trackers: SallaTracker[] = [];
  const salla = {
    onReady: vi.fn((cb: () => void) => cb()),
    analytics: { registerTracker: vi.fn((t: SallaTracker) => void trackers.push(t)) },
    config: { get: vi.fn((key: string) => config[key]) },
  };
  return { salla, trackers };
}

function queue(): Call[] {
  return Array.from(win.sfere as Call[]);
}

function sdkScript(): HTMLScriptElement | null {
  return document.querySelector<HTMLScriptElement>("script[data-write-key][data-host]");
}

beforeEach(() => {
  delete win.Salla;
  delete win.salla;
  delete win.sfere;
  delete win.SfereSalla;
  delete win.SFERE_DEBUG;
  localStorage.clear();
  history.replaceState(null, "", "/product/p1");
  document.head.innerHTML = "";
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("config", () => {
  it("reads data attributes and strips trailing slashes from the host", () => {
    expect(readConfig(configured({ "data-host": `${HOST}//` }))).toEqual({
      writeKey: "wk",
      host: HOST,
      sdkSrc: SDK_SRC,
      sdkIntegrity: SDK_INTEGRITY,
      debug: false,
    });
  });

  it("falls back to the query string of the script src", () => {
    const src = `https://cdn.sfere.io/integrations/salla/v0.1.0/sfere-salla.min.js?write_key=q&host=${encodeURIComponent(HOST)}&store_id=7&debug=1`;
    expect(readConfig(tag({}, src))).toMatchObject({
      writeKey: "q",
      host: HOST,
      storeId: "7",
      debug: true,
    });
  });

  it("prefers data attributes over the query string", () => {
    const src = `https://cdn.sfere.io/x.js?write_key=q&host=https://other.example.com`;
    expect(readConfig(tag({ "data-write-key": "attr", "data-host": HOST }, src))).toMatchObject({
      writeKey: "attr",
      host: HOST,
    });
  });

  it("pins the immutable SDK build with SRI", () => {
    expect(SDK_SRC).toBe(`https://cdn.sfere.io/sdk/v${SDK_VERSION}/sfere.min.js`);
    expect(SDK_VERSION).toMatch(/^0\.3\.\d+$/);
    expect(SDK_INTEGRITY).toMatch(/^sha384-[A-Za-z0-9+/]{64}$/);
  });

  it("an SDK override carries only the integrity it is given", () => {
    const other = "https://cdn.sfere.io/sdk/v0.3.9/sfere.min.js";
    const without = readConfig(configured({ "data-sdk-src": other }));
    expect(without?.sdkSrc).toBe(other);
    expect(without).not.toHaveProperty("sdkIntegrity");
    const withSri = readConfig(
      configured({ "data-sdk-src": other, "data-sdk-integrity": "sha384-x" }),
    );
    expect(withSri?.sdkIntegrity).toBe("sha384-x");
  });

  it.each([
    ["no tag", null],
    ["no write key", tag({ "data-host": HOST })],
    ["no host", tag({ "data-write-key": "wk" })],
    ["host without a scheme", tag({ "data-write-key": "wk", "data-host": "ingest.example.com" })],
    ["unrendered template", tag({ "data-write-key": "{{ write_key }}", "data-host": HOST })],
    ["unparseable src", tag({}, "http://[")],
  ])("is incomplete with %s", (_label, el) => {
    expect(readConfig(el)).toBeUndefined();
  });

  it("ignores an unrendered store id template", () => {
    expect(readConfig(configured({ "data-store-id": "{{store.id}}" }))).not.toHaveProperty(
      "storeId",
    );
  });
});

describe("install", () => {
  it("does nothing without config", () => {
    const { salla } = mockSalla();
    win.Salla = salla;
    expect(install(window, tag({}))).toBeUndefined();
    expect(win.sfere).toBeUndefined();
    expect(win.SfereSalla).toBeUndefined();
    expect(salla.onReady).not.toHaveBeenCalled();
  });

  it("injects the pinned SDK with SRI and the loading tag's key and host", () => {
    win.Salla = mockSalla().salla;
    install(window, configured());
    const s = sdkScript()!;
    expect(s.src).toBe(SDK_SRC);
    expect(s.async).toBe(true);
    expect(s.getAttribute("integrity")).toBe(SDK_INTEGRITY);
    expect(s.getAttribute("crossorigin")).toBe("anonymous");
    expect(s.getAttribute("data-write-key")).toBe("wk");
    expect(s.getAttribute("data-host")).toBe(HOST);
    expect(win.SfereSalla).toEqual({ version });
  });

  it("omits SRI for an SDK override without an integrity hash", () => {
    win.Salla = mockSalla().salla;
    install(window, configured({ "data-sdk-src": "https://staging.example.com/sfere.min.js" }));
    const s = sdkScript()!;
    expect(s.src).toBe("https://staging.example.com/sfere.min.js");
    expect(s.hasAttribute("integrity")).toBe(false);
    expect(s.hasAttribute("crossorigin")).toBe(false);
  });

  it("reuses a window.sfere the store already has and injects nothing", () => {
    const existing = { track: vi.fn(), page: vi.fn(), identify: vi.fn() };
    win.sfere = existing;
    win.Salla = mockSalla().salla;
    install(window, configured());
    expect(sdkScript()).toBeNull();
    expect(existing.page).toHaveBeenCalledWith({ source: SOURCE, store_id: "42" });
  });

  it("runs once per page", () => {
    const { salla } = mockSalla();
    win.Salla = salla;
    expect(install(window, configured())).toBeDefined();
    expect(install(window, configured())).toBeUndefined();
    expect(salla.analytics.registerTracker).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll("script[data-write-key]")).toHaveLength(1);
  });

  it("sends one page on start and registers exactly one tracker", () => {
    const { salla, trackers } = mockSalla();
    win.Salla = salla;
    install(window, configured());
    expect(trackers).toHaveLength(1);
    expect(trackers[0]!.name).toBe("Sfere");
    expect(queue()).toEqual([["page", { source: "salla_browser", store_id: "42" }]]);
  });

  it("waits for the storefront global and starts on Salla.onReady", () => {
    vi.useFakeTimers();
    const { salla, trackers } = mockSalla();
    install(window, configured());
    expect(win.sfere).toBeUndefined();
    vi.advanceTimersByTime(BOOT_INTERVAL_MS * 3);
    win.salla = salla; // lower-case alias works too
    vi.advanceTimersByTime(BOOT_INTERVAL_MS);
    expect(salla.onReady).toHaveBeenCalledTimes(1);
    expect(trackers).toHaveLength(1);
  });

  it("gives up quietly when the storefront global never appears", () => {
    vi.useFakeTimers();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    install(window, configured({ "data-debug": "true" }));
    vi.advanceTimersByTime(BOOT_INTERVAL_MS * (BOOT_ATTEMPTS + 5));
    expect(vi.getTimerCount()).toBe(0);
    expect(win.sfere).toBeUndefined();
    expect(log).toHaveBeenCalledWith("[Sfere]", "storefront SDK not found");
  });

  it("starts only once when onReady fires twice", () => {
    const { salla } = mockSalla();
    salla.onReady.mockImplementation((cb: () => void) => {
      cb();
      cb();
    });
    win.Salla = salla;
    install(window, configured());
    expect(salla.analytics.registerTracker).toHaveBeenCalledTimes(1);
    expect(queue().filter((c) => c[0] === "page")).toHaveLength(1);
  });

  it("still sends page when the storefront has no analytics API", () => {
    const { salla } = mockSalla();
    win.Salla = { onReady: salla.onReady, config: salla.config };
    install(window, configured());
    expect(queue().map((c) => c[0])).toEqual(["page"]);
  });

  it("uses the snippet's store id when the storefront config has none", () => {
    win.Salla = mockSalla({}).salla;
    install(window, configured({ "data-store-id": "99" }));
    expect(queue()[0]).toEqual(["page", { source: SOURCE, store_id: "99" }]);
  });
});

describe("tracker", () => {
  function started(config?: Record<string, unknown>) {
    const { salla, trackers } = mockSalla(config);
    win.Salla = salla;
    install(window, configured());
    return trackers[0]!;
  }

  it("forwards track with the storefront payload plus store_id and source", () => {
    const tracker = started();
    tracker.track("Product Viewed", { product_id: "p1", price: 10, source: "theme" });
    expect(queue()[1]).toEqual([
      "track",
      "Product Viewed",
      { product_id: "p1", price: 10, source: "salla_browser", store_id: "42" },
    ]);
  });

  it("tolerates a missing or non-object payload and ignores an empty name", () => {
    const tracker = started();
    tracker.track("Cart Viewed");
    tracker.track("Products Searched", "query");
    tracker.track("", { a: 1 });
    expect(queue().slice(1)).toEqual([
      ["track", "Cart Viewed", { source: SOURCE, store_id: "42" }],
      ["track", "Products Searched", { source: SOURCE, store_id: "42" }],
    ]);
  });

  it("sets sfere_dedup_id on Order Completed", () => {
    const tracker = started();
    tracker.track("Order Completed", { order_id: 1001, total: 50 });
    tracker.track("Order Completed", { id: "1002" });
    const props = queue()
      .slice(1)
      .map((c) => (c[2] as Record<string, unknown>).sfere_dedup_id);
    expect(props).toEqual(["salla.purchase.42.1001", "salla.purchase.42.1002"]);
  });

  it("keeps an existing dedup id, truncates to 64 chars, and skips without an order id", () => {
    const tracker = started();
    tracker.track("Order Completed", { order_id: "1", sfere_dedup_id: "custom" });
    tracker.track("Order Completed", { order_id: "x".repeat(80) });
    tracker.track("Order Completed", { total: 1 });
    tracker.track("Product Added", { order_id: "1" });
    const ids = queue()
      .slice(1)
      .map((c) => (c[2] as Record<string, unknown>).sfere_dedup_id);
    expect(ids[0]).toBe("custom");
    expect((ids[1] as string).length).toBe(64);
    expect(ids[1]).toMatch(/^salla\.purchase\.42\.x+$/);
    expect(ids[2]).toBeUndefined();
    expect(ids[3]).toBeUndefined();
  });

  it("drops the storefront's page for the URL already sent, sends it for a new URL", () => {
    const tracker = started();
    tracker.page({});
    expect(queue().filter((c) => c[0] === "page")).toHaveLength(1);
    history.pushState(null, "", "/category/c1");
    tracker.page({});
    tracker.page({});
    expect(queue().filter((c) => c[0] === "page")).toHaveLength(2);
  });

  it("goes through window.sfere per call, so the loaded SDK receives later events", () => {
    const tracker = started();
    const sdk = { track: vi.fn() };
    win.sfere = sdk;
    tracker.track("Product Added", { product_id: "p1" });
    expect(sdk.track).toHaveBeenCalledWith("Product Added", {
      product_id: "p1",
      source: SOURCE,
      store_id: "42",
    });
  });
});

describe("identify", () => {
  const user = {
    "store.id": 42,
    "user.id": 555,
    "user.type": "user",
    "user.email": " fan@example.com ",
    "user.mobile": "",
    "user.phone": "+966500000000",
    "user.first_name": "Sara",
    "user.last_name": null,
  };

  it("identifies a logged-in customer with plain traits before the first page", () => {
    win.Salla = mockSalla(user).salla;
    install(window, configured());
    expect(queue()[0]).toEqual([
      "identify",
      "555",
      { email: "fan@example.com", phone: "+966500000000", firstName: "Sara" },
    ]);
    expect(queue()[1]![0]).toBe("page");
  });

  it("never identifies a guest or an anonymous visitor", () => {
    win.Salla = mockSalla({ ...user, "user.type": "guest" }).salla;
    install(window, configured());
    expect(queue().map((c) => c[0])).toEqual(["page"]);

    delete win.SfereSalla;
    delete win.sfere;
    win.Salla = mockSalla({ "user.type": "user" }).salla;
    install(window, configured());
    expect(queue().map((c) => c[0])).toEqual(["page"]);
  });
});

describe("never throws into the storefront", () => {
  it("survives throwing config, analytics and SDK methods", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    win.SFERE_DEBUG = true;
    win.Salla = {
      onReady: (cb) => cb(),
      config: {
        get: () => {
          throw new Error("config");
        },
      },
      analytics: {
        registerTracker: () => {
          throw new Error("register");
        },
      },
    };
    expect(() => install(window, configured())).not.toThrow();
    expect(log).toHaveBeenCalledWith("[Sfere]", "start failed", expect.any(Error));

    win.sfere = {
      track: () => {
        throw new Error("sdk");
      },
    };
    const trackers: SallaTracker[] = [];
    delete win.SfereSalla;
    win.Salla = { onReady: (cb) => cb(), analytics: { registerTracker: (t) => trackers.push(t) } };
    install(window, configured());
    expect(() => trackers[0]!.track("Product Viewed", {})).not.toThrow();
    expect(log).toHaveBeenCalledWith("[Sfere]", "call failed", "track", expect.any(Error));
  });

  it("survives a throwing onReady and a throwing trait value", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    localStorage.setItem("sfere_debug", "1");
    win.Salla = {
      onReady: () => {
        throw new Error("ready");
      },
    };
    expect(() => install(window, configured())).not.toThrow();
    expect(log).toHaveBeenCalledWith("[Sfere]", "init failed", expect.any(Error));

    delete win.SfereSalla;
    const bad = {
      toString() {
        throw new Error("toString");
      },
    };
    win.Salla = mockSalla({ "user.id": bad }).salla;
    expect(() => install(window, configured())).not.toThrow();
    expect(log).toHaveBeenCalledWith("[Sfere]", "identify failed", expect.any(Error));
    expect(queue().map((c) => c[0])).toEqual(["page"]);
  });

  it("survives a throwing payload spread and a throwing location", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    win.SFERE_DEBUG = true;
    const { salla, trackers } = mockSalla();
    win.Salla = salla;
    install(window, configured());
    const payload = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error("keys");
        },
      },
    );
    expect(() => trackers[0]!.track("Product Viewed", payload)).not.toThrow();
    expect(log).toHaveBeenCalledWith(
      "[Sfere]",
      "track failed",
      "Product Viewed",
      expect.any(Error),
    );

    vi.spyOn(window, "location", "get").mockImplementation(() => {
      throw new Error("location");
    });
    expect(() => trackers[0]!.page()).not.toThrow();
    expect(log).toHaveBeenCalledWith("[Sfere]", "page failed", expect.any(Error));
  });
});

describe("debug logging", () => {
  it("is silent without a debug flag", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    win.Salla = mockSalla().salla;
    install(window, configured());
    expect(log).not.toHaveBeenCalled();
  });

  it("logs [Sfere] lines with ?sfere_debug=1 on the page", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    history.replaceState(null, "", "/product/p1?sfere_debug=1");
    win.Salla = mockSalla().salla;
    install(window, configured());
    expect(log).toHaveBeenCalledWith("[Sfere]", "tracker registered");
    expect(log.mock.calls.every((c) => c[0] === "[Sfere]")).toBe(true);
  });

  it("explains why it stays inert when not configured", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    win.SFERE_DEBUG = true;
    install(window, tag({ "data-host": HOST }));
    expect(log).toHaveBeenCalledWith(
      "[Sfere]",
      "not configured: data-write-key and an http(s) data-host are required",
    );
  });

  it("treats a throwing storage as debug off", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    win.Salla = mockSalla().salla;
    install(window, configured());
    expect(log).not.toHaveBeenCalled();
  });
});

describe("per-store config (data-config-url)", () => {
  const CONFIG_URL = "https://api.example.com/salla/tracker-config";
  const remoteTag = (extra: Record<string, string> = {}) =>
    tag({ "data-config-url": CONFIG_URL, ...extra });
  const reply = (body: unknown, status = 200) =>
    Promise.resolve(new Response(JSON.stringify(body), { status }));
  const flush = async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };
  const good = { write_key: "store-key", host: `${HOST}/` };

  beforeEach(() => {
    sessionStorage.clear();
    win.Salla = mockSalla().salla;
  });

  it("reads the URL from the attribute or the query, and only http(s)", () => {
    expect(readRemoteConfig(remoteTag())?.configUrl).toBe(CONFIG_URL);
    const src = `https://cdn.sfere.io/x.js?config_url=${encodeURIComponent(CONFIG_URL)}`;
    expect(readRemoteConfig(tag({}, src))?.configUrl).toBe(CONFIG_URL);
    expect(readRemoteConfig(tag({ "data-config-url": "javascript:alert(1)" }))).toBeUndefined();
    expect(readRemoteConfig(tag({}))).toBeUndefined();
  });

  it("fetches the store's key, caches it, then loads the SDK as usual", async () => {
    const fetchMock = vi.fn(() => reply(good));
    vi.stubGlobal("fetch", fetchMock);
    const integration = install(window, remoteTag());
    expect(integration?.config).toBeUndefined();
    expect(sdkScript()).toBeNull();
    await flush();
    expect(fetchMock).toHaveBeenCalledWith(`${CONFIG_URL}?store_id=42`, { credentials: "omit" });
    expect(sdkScript()?.getAttribute("data-write-key")).toBe("store-key");
    expect(sdkScript()?.getAttribute("data-host")).toBe(HOST);
    expect(sdkScript()?.src).toBe(SDK_SRC);
    expect(queue().map((c) => c[0])).toContain("page");
    expect(JSON.parse(sessionStorage.getItem("sfere_salla_cfg_42") ?? "{}")).toEqual({
      write_key: "store-key",
      host: HOST,
    });
  });

  it("prefers data-store-id over the storefront's store id", async () => {
    const fetchMock = vi.fn(() => reply(good));
    vi.stubGlobal("fetch", fetchMock);
    install(window, remoteTag({ "data-store-id": "7" }));
    await flush();
    expect(fetchMock).toHaveBeenCalledWith(`${CONFIG_URL}?store_id=7`, expect.anything());
  });

  it("uses the session cache without fetching", async () => {
    sessionStorage.setItem("sfere_salla_cfg_42", JSON.stringify(good));
    const fetchMock = vi.fn(() => reply(good));
    vi.stubGlobal("fetch", fetchMock);
    install(window, remoteTag());
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(sdkScript()?.getAttribute("data-write-key")).toBe("store-key");
  });

  it("ignores a corrupt cache entry and blocked storage", async () => {
    sessionStorage.setItem("sfere_salla_cfg_42", "{nope");
    const fetchMock = vi.fn(() => reply(good));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    install(window, remoteTag());
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sdkScript()?.getAttribute("data-write-key")).toBe("store-key");
  });

  it("does nothing on a 404", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    win.SFERE_DEBUG = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => reply({}, 404)),
    );
    expect(() => install(window, remoteTag())).not.toThrow();
    await flush();
    expect(win.sfere).toBeUndefined();
    expect(sdkScript()).toBeNull();
    expect(sessionStorage.length).toBe(0);
    expect(log).toHaveBeenCalledWith("[Sfere]", "config lookup failed", 404);
    expect(
      (win.Salla as ReturnType<typeof mockSalla>["salla"]).analytics.registerTracker,
    ).not.toHaveBeenCalled();
  });

  it("does nothing on a network error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("offline"))),
    );
    install(window, remoteTag());
    await flush();
    expect(win.sfere).toBeUndefined();
    expect(sdkScript()).toBeNull();
  });

  it.each([
    ["a non-http host", { write_key: "k", host: "javascript:alert(1)" }],
    ["a host without a scheme", { write_key: "k", host: "ingest.example.com" }],
    ["no write key", { host: HOST }],
    ["a non-object body", "nope"],
  ])("rejects %s", async (_label, body) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => reply(body)),
    );
    install(window, remoteTag());
    await flush();
    expect(win.sfere).toBeUndefined();
    expect(sessionStorage.length).toBe(0);
  });

  it("does nothing without any store id", async () => {
    win.Salla = mockSalla({}).salla;
    const fetchMock = vi.fn(() => reply(good));
    vi.stubGlobal("fetch", fetchMock);
    install(window, remoteTag());
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(win.sfere).toBeUndefined();
  });

  it("a static write key wins and never fetches", () => {
    const fetchMock = vi.fn(() => reply(good));
    vi.stubGlobal("fetch", fetchMock);
    const integration = install(window, configured({ "data-config-url": CONFIG_URL }));
    expect(integration?.config?.writeKey).toBe("wk");
    expect(sdkScript()?.getAttribute("data-write-key")).toBe("wk");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

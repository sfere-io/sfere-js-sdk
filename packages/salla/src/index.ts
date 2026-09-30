/**
 * Sfere storefront integration for Salla (one App Snippet for every store).
 *
 * On `Salla.onReady` it injects the Sfere SDK (the loader-stub pattern of
 * packages/browser/src/cdn/snippet.html, pinned to an immutable build with SRI) and registers ONE
 * storefront analytics tracker that forwards every event through `window.sfere`:
 *
 * - `track(name, payload)` -> `sfere.track(name, {...payload, store_id, source: "salla_browser"})`;
 *   the storefront already emits the SDK's event names (`Product Viewed`, `Order Completed`, ...).
 * - one `page` on load; the storefront's own `page()` for the same URL is dropped.
 * - `identify(user.id, traits)` for a logged-in customer, never for a guest. Plain values: hashing
 *   is server-side.
 * - `Order Completed` carries `sfere_dedup_id = salla.purchase.{store}.{order_id}`, the id the
 *   server-side order event uses, so the two are counted once.
 *
 * Never throws into the storefront. Logs only with a debug flag, always prefixed "[Sfere]".
 */
import {
  cleanHost,
  readConfig,
  readRemoteConfig,
  str,
  type RemoteConfig,
  type SallaIntegrationConfig,
} from "./config";

export { readConfig, readRemoteConfig, SDK_INTEGRITY, SDK_SRC, SDK_VERSION } from "./config";
export type { RemoteConfig, SallaIntegrationConfig } from "./config";

declare const __SFERE_SALLA_VERSION__: string | undefined;

/** This integration's version, stamped at build time. */
export const version: string =
  typeof __SFERE_SALLA_VERSION__ === "string" ? __SFERE_SALLA_VERSION__ : "0.0.0-dev";

export const SOURCE = "salla_browser";
export const TRACKER_NAME = "Sfere";
/** Same method list as the SDK's own loader stub; the SDK replays these once it loads. */
const QUEUE_METHODS = ["track", "page", "identify", "group", "alias", "reset", "setConsent"];
/** The storefront global can appear after the snippet runs: poll 50 x 200 ms before giving up. */
export const BOOT_ATTEMPTS = 50;
export const BOOT_INTERVAL_MS = 200;
const DEDUP_ID_MAX = 64;

/** The storefront tracker contract (`Salla.analytics.registerTracker`). */
export interface SallaTracker {
  name: string;
  track: (eventName: string, payload?: unknown) => void;
  page: (payload?: unknown) => void;
}

export interface SallaGlobal {
  onReady?: (cb: () => void) => void;
  analytics?: { registerTracker?: (tracker: SallaTracker) => void };
  config?: { get?: (key: string, fallback?: unknown) => unknown };
}

type Method = (...args: unknown[]) => unknown;
type Win = Window & {
  Salla?: SallaGlobal;
  salla?: SallaGlobal;
  sfere?: unknown;
  SfereSalla?: { version: string };
  SFERE_DEBUG?: unknown;
};

export interface Integration {
  /** The static config, or undefined while a per-store config is still to be fetched. */
  config: SallaIntegrationConfig | undefined;
  tracker: SallaTracker;
}

/** sessionStorage key for a store's fetched config. */
export const CONFIG_CACHE_PREFIX = "sfere_salla_cfg_";

/**
 * Boots the integration against `win`, configured by the loading `script` tag. Returns undefined
 * (and does nothing) when the config is incomplete or the integration already ran on this page.
 */
export function install(win: Window, script: HTMLScriptElement | null): Integration | undefined {
  const w = win as Win;
  const doc = win.document;
  const fromTag = readConfig(script);
  const remote = fromTag ? undefined : readRemoteConfig(script);

  const debug = (): boolean => {
    try {
      if (fromTag?.debug || w.SFERE_DEBUG === true) return true;
      if (/[?&]sfere_debug=1(?:&|$)/.test(w.location.search)) return true;
      return w.localStorage.getItem("sfere_debug") === "1";
    } catch {
      return false;
    }
  };
  const log = (...args: unknown[]): void => {
    try {
      // eslint-disable-next-line no-console -- opt-in debug output is this integration's only log
      if (debug()) console.log("[Sfere]", ...args);
    } catch {
      // never throw into the storefront
    }
  };

  if (w.SfereSalla) {
    log("already installed");
    return undefined;
  }
  if (!fromTag && !remote) {
    log("not configured: data-write-key and an http(s) data-host are required");
    return undefined;
  }
  let config = fromTag;
  w.SfereSalla = { version };

  const salla = (): SallaGlobal | undefined => w.Salla ?? w.salla;
  const cfg = (key: string): unknown => {
    try {
      const store = salla()?.config;
      return typeof store?.get === "function" ? store.get(key) : undefined;
    } catch {
      return undefined;
    }
  };

  /** Inject the SDK once; reuse a `window.sfere` the store already has (stub or instance). */
  const loadSfere = (c: SallaIntegrationConfig): void => {
    if (w.sfere) return;
    const q = [] as unknown as unknown[] & Record<string, Method>;
    for (const m of QUEUE_METHODS) {
      q[m] = (...args: unknown[]) => {
        q.push([m, ...args]);
        return q;
      };
    }
    w.sfere = q;
    const s = doc.createElement("script");
    s.async = true;
    s.src = c.sdkSrc;
    if (c.sdkIntegrity) {
      s.integrity = c.sdkIntegrity;
      s.crossOrigin = "anonymous";
    }
    s.setAttribute("data-write-key", c.writeKey);
    s.setAttribute("data-host", c.host);
    (doc.head ?? doc.documentElement).appendChild(s);
  };

  /** Always resolve `window.sfere` per call: the queue before the SDK loads, the SDK after. */
  const call = (method: string, ...args: unknown[]): void => {
    try {
      const sdk = w.sfere as Record<string, unknown> | undefined;
      const fn = sdk?.[method];
      if (typeof fn === "function") (fn as Method).apply(sdk, args);
    } catch (e) {
      log("call failed", method, e);
    }
  };

  const envelope = (): Record<string, unknown> => {
    const env: Record<string, unknown> = { source: SOURCE };
    const storeId = str(cfg("store.id")) ?? config?.storeId;
    if (storeId) env.store_id = storeId;
    return env;
  };

  const identifyIfLoggedIn = (): void => {
    try {
      identify();
    } catch (e) {
      log("identify failed", e);
    }
  };
  const identify = (): void => {
    const userId = str(cfg("user.id"));
    if (!userId || str(cfg("user.type")) === "guest") return;
    const traits: Record<string, string> = {};
    const add = (trait: string, ...keys: string[]): void => {
      for (const key of keys) {
        const value = str(cfg(key));
        if (value) {
          traits[trait] = value;
          return;
        }
      }
    };
    add("email", "user.email");
    add("phone", "user.mobile", "user.phone");
    add("firstName", "user.first_name");
    add("lastName", "user.last_name");
    call("identify", userId, traits);
    log("identify", userId);
  };

  let lastPageUrl: string | undefined;
  const sendPage = (force: boolean): void => {
    try {
      const url = w.location.href;
      if (!force && url === lastPageUrl) return;
      lastPageUrl = url;
      call("page", envelope());
      log("page", url);
    } catch (e) {
      log("page failed", e);
    }
  };

  const tracker: SallaTracker = {
    name: TRACKER_NAME,
    track: (eventName, payload) => {
      try {
        if (!eventName) return;
        const props: Record<string, unknown> = {
          ...(payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {}),
          ...envelope(),
        };
        if (eventName === "Order Completed" && !props.sfere_dedup_id) {
          const orderId = str(props.order_id) ?? str(props.id);
          const storeId = str(props.store_id);
          if (orderId && storeId) {
            props.sfere_dedup_id = `salla.purchase.${storeId}.${orderId}`.slice(0, DEDUP_ID_MAX);
          }
        }
        call("track", eventName, props);
        log("track", eventName);
      } catch (e) {
        log("track failed", eventName, e);
      }
    },
    // The first page is sent on start; the storefront's page() for that same URL would repeat it.
    page: () => sendPage(false),
  };

  /** `{write_key, host}` as a validated config, or undefined. */
  const fromPayload = (
    r: RemoteConfig,
    data: unknown,
    storeId: string,
  ): SallaIntegrationConfig | undefined => {
    const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
    const writeKey = str(d.write_key);
    const host = cleanHost(d.host);
    if (!writeKey || !host) return undefined;
    return {
      sdkSrc: r.sdkSrc,
      sdkIntegrity: r.sdkIntegrity,
      debug: r.debug,
      writeKey,
      host,
      storeId,
    };
  };

  /** The store's config from sessionStorage, else GET `${configUrl}?store_id=`. Never rejects. */
  const resolveRemote = async (r: RemoteConfig): Promise<SallaIntegrationConfig | undefined> => {
    try {
      const storeId = str(r.storeId) ?? str(cfg("store.id"));
      if (!storeId) {
        log("no store id for the config lookup");
        return undefined;
      }
      const key = CONFIG_CACHE_PREFIX + storeId;
      try {
        const cached = w.sessionStorage.getItem(key);
        const hit = cached ? fromPayload(r, JSON.parse(cached), storeId) : undefined;
        if (hit) return hit;
      } catch {
        // storage blocked or the entry is corrupt: fetch instead
      }
      const url = new URL(r.configUrl);
      url.searchParams.set("store_id", storeId);
      const res = await w.fetch(url.toString(), { credentials: "omit" });
      if (!res.ok) {
        log("config lookup failed", res.status);
        return undefined;
      }
      const data: unknown = await res.json();
      const found = fromPayload(r, data, storeId);
      if (!found) {
        log("config lookup returned no usable write_key and http(s) host");
        return undefined;
      }
      try {
        w.sessionStorage.setItem(
          key,
          JSON.stringify({ write_key: found.writeKey, host: found.host }),
        );
      } catch {
        // storage blocked: the next page fetches again
      }
      return found;
    } catch (e) {
      log("config lookup failed", e);
      return undefined;
    }
  };

  const start = async (): Promise<void> => {
    try {
      config ??= remote ? await resolveRemote(remote) : undefined;
      if (!config) return;
      loadSfere(config);
      identifyIfLoggedIn();
      sendPage(true);
      const analytics = salla()?.analytics;
      if (typeof analytics?.registerTracker === "function") {
        // The storefront replays the current page's Product Viewed to a newly registered tracker.
        analytics.registerTracker(tracker);
        log("tracker registered");
      } else {
        log("storefront analytics API not available");
      }
    } catch (e) {
      log("start failed", e);
    }
  };

  let started = false;
  const startOnce = (): void => {
    if (started) return;
    started = true;
    void start();
  };

  const boot = (attempt: number): void => {
    try {
      const s = salla();
      if (typeof s?.onReady === "function") {
        s.onReady(startOnce);
        return;
      }
      if (attempt < BOOT_ATTEMPTS) {
        win.setTimeout(() => boot(attempt + 1), BOOT_INTERVAL_MS);
      } else {
        log("storefront SDK not found");
      }
    } catch (e) {
      log("init failed", e);
    }
  };

  boot(1);
  return { config, tracker };
}

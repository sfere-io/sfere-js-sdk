/**
 * The Sfere SDK build this integration loads. Pinned to an immutable URL with its SRI hash, per
 * docs/CDN-POLICY.md: the alias would move under every storefront at once, and 0.1.x does not
 * carry identify traits onto later events. Take a new pin from that version's manifest.json
 * (`files[].sha384` of `dist/cdn/sfere.min.js`) and ship it as a new integration version.
 */
export const SDK_VERSION = "0.3.2";
export const SDK_SRC = "https://cdn.sfere.io/sdk/v0.3.2/sfere.min.js";
export const SDK_INTEGRITY =
  "sha384-B4VMpPOnv5Az9k1R/YKDGatyxsP8WLKW98zV5X6vtsCN3gz3kfj5NVQX0g5oJ6ay";

export interface SallaIntegrationConfig {
  /** Browser (ingest-only) write key. */
  writeKey: string;
  /** Ingestion endpoint origin, no trailing slash. */
  host: string;
  /** SDK bundle URL: the pinned immutable build unless `data-sdk-src` overrides it. */
  sdkSrc: string;
  /** SRI for `sdkSrc`; absent for an override without `data-sdk-integrity`. */
  sdkIntegrity?: string;
  /** Store id from the snippet, used only when the storefront config has none. */
  storeId?: string;
  /** Log `[Sfere]` lines to the console. */
  debug: boolean;
}

/** Trimmed non-empty string, or undefined. A Salla template left unrendered counts as missing. */
export function str(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  const s = String(value).trim();
  if (s === "" || s.includes("{{")) return undefined;
  return s;
}

function queryOf(script: HTMLScriptElement | null): URLSearchParams {
  try {
    return new URL(script?.src ?? "").searchParams;
  } catch {
    return new URLSearchParams();
  }
}

const HTTP_ORIGIN = /^https?:\/\/[^/]/i;

/** Normalises a host: trimmed, no trailing slashes, and only http(s). */
export function cleanHost(value: unknown): string | undefined {
  const host = str(value)?.replace(/\/+$/, "");
  return host && HTTP_ORIGIN.test(host) ? host : undefined;
}

function picker(script: HTMLScriptElement | null) {
  const query = queryOf(script);
  return (attr: string, ...params: string[]): string | undefined => {
    const fromAttr = str(script?.getAttribute(`data-${attr}`));
    if (fromAttr) return fromAttr;
    for (const p of params) {
      const fromQuery = str(query.get(p));
      if (fromQuery) return fromQuery;
    }
    return undefined;
  };
}

type Pick = ReturnType<typeof picker>;

function common(pick: Pick): Omit<SallaIntegrationConfig, "writeKey" | "host"> {
  const debugValue = pick("debug", "debug", "sfere_debug");
  const override = pick("sdk-src", "sdk_src");
  const config: Omit<SallaIntegrationConfig, "writeKey" | "host"> = {
    sdkSrc: override ?? SDK_SRC,
    debug: debugValue === "true" || debugValue === "1",
  };
  const integrity = override ? pick("sdk-integrity", "sdk_integrity") : SDK_INTEGRITY;
  if (integrity) config.sdkIntegrity = integrity;
  const storeId = pick("store-id", "store_id");
  if (storeId) config.storeId = storeId;
  return config;
}

/**
 * Reads the config from the loading `<script>`: `data-*` attributes first, then the query string
 * of its `src`. Nothing is baked in at build time: one App Snippet serves every store. Returns
 * undefined (and the integration stays inert) without a write key and an http(s) host.
 */
export function readConfig(script: HTMLScriptElement | null): SallaIntegrationConfig | undefined {
  const pick = picker(script);
  const writeKey = pick("write-key", "write_key", "writeKey");
  const host = cleanHost(pick("host", "host"));
  if (!writeKey || !host) return undefined;
  return { writeKey, host, ...common(pick) };
}

/** Per-store lookup: the tag names a config endpoint instead of carrying a key. */
export type RemoteConfig = Omit<SallaIntegrationConfig, "writeKey" | "host"> & {
  configUrl: string;
};

/**
 * `data-config-url` (or `config_url`), used only when the tag has no `data-write-key`: a static
 * key always wins. Returns undefined without an http(s) config URL.
 */
export function readRemoteConfig(script: HTMLScriptElement | null): RemoteConfig | undefined {
  const pick = picker(script);
  if (pick("write-key", "write_key", "writeKey")) return undefined;
  const configUrl = pick("config-url", "config_url", "configUrl");
  if (!configUrl || !HTTP_ORIGIN.test(configUrl)) return undefined;
  return { configUrl, ...common(pick) };
}

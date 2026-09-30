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

/**
 * Reads the config from the loading `<script>`: `data-*` attributes first, then the query string
 * of its `src`. Nothing is baked in at build time: one App Snippet serves every store. Returns
 * undefined (and the integration stays inert) without a write key and an http(s) host.
 */
export function readConfig(script: HTMLScriptElement | null): SallaIntegrationConfig | undefined {
  const query = queryOf(script);
  const pick = (attr: string, ...params: string[]): string | undefined => {
    const fromAttr = str(script?.getAttribute(`data-${attr}`));
    if (fromAttr) return fromAttr;
    for (const p of params) {
      const fromQuery = str(query.get(p));
      if (fromQuery) return fromQuery;
    }
    return undefined;
  };

  const writeKey = pick("write-key", "write_key", "writeKey");
  const host = pick("host", "host")?.replace(/\/+$/, "");
  const debugValue = pick("debug", "debug", "sfere_debug");
  const debug = debugValue === "true" || debugValue === "1";
  if (!writeKey || !host || !/^https?:\/\/[^/]/i.test(host)) return undefined;

  const override = pick("sdk-src", "sdk_src");
  const config: SallaIntegrationConfig = {
    writeKey,
    host,
    sdkSrc: override ?? SDK_SRC,
    debug,
  };
  const integrity = override ? pick("sdk-integrity", "sdk_integrity") : SDK_INTEGRITY;
  if (integrity) config.sdkIntegrity = integrity;
  const storeId = pick("store-id", "store_id");
  if (storeId) config.storeId = storeId;
  return config;
}

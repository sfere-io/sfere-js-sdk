import {
  Analytics,
  type AnalyticsSettings,
  type Context,
  type HTTPClient,
  type Plugin,
} from "@segment/analytics-node";
import { sfereHttpClient } from "./http-client";
import { version } from "./version";

export { requestContext } from "./context";
export type { IncomingRequestLike, RequestContextOptions, SfereRequestContext } from "./context";
export { version };
export type {
  AliasParams,
  GroupParams,
  GroupTraits,
  HTTPClient,
  IdentifyParams,
  PageParams,
  TrackParams,
  UserTraits,
} from "@segment/analytics-node";

export interface SfereNodeOptions {
  /** Server write key (`keyId:secret`). Secret: never ship it to a browser or app. */
  writeKey: string;
  /** Ingestion endpoint origin: scheme + host, no path. Events go to `{host}/v1/batch`. */
  host: string;
  /** Events per request. Default 15. */
  flushAt?: number;
  /** Max milliseconds an event waits before its batch is sent. Default 10000. */
  flushInterval?: number;
  /** Retries per batch on network errors, 5xx and 429, with backoff. Default 3. */
  maxRetries?: number;
  /** Per-request timeout in milliseconds. Default 10000. */
  httpRequestTimeout?: number;
  /** Accept calls but send nothing (tests, local development). Default false. */
  disable?: boolean;
  /** Replace the transport (proxies, custom agents, tests). The Sfere wire shaping still applies. */
  httpClient?: HTTPClient;
}

function parseHost(host: unknown): string {
  let url: URL | undefined;
  try {
    url = typeof host === "string" && host ? new URL(host) : undefined;
  } catch {
    url = undefined;
  }
  if (!url || (url.protocol !== "https:" && url.protocol !== "http:")) {
    throw new Error(
      'Sfere Node SDK: "host" is required and must be an http(s) origin, e.g. "https://ingest.example.com".',
    );
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new Error(
      `Sfere Node SDK: "host" must be an origin without a path, got "${host as string}". Use "${url.origin}".`,
    );
  }
  return url.origin;
}

/**
 * `properties.sfere_dedup_id` on every `track`: kept when the caller set it (use the order id),
 * otherwise the event's `messageId`. A conversion sent from both the browser and the server must
 * carry the same value (docs/WIRE-CONTRACT.md §4).
 */
const passThrough = (ctx: Context): Context => ctx;
const dedupPlugin: Plugin = {
  name: "Sfere Dedup",
  type: "enrichment",
  version,
  isLoaded: () => true,
  load: () => Promise.resolve(),
  track: (ctx) => {
    const properties = (ctx.event.properties ??= {});
    if (properties.sfere_dedup_id === undefined || properties.sfere_dedup_id === null) {
      properties.sfere_dedup_id = ctx.event.messageId;
    }
    return ctx;
  },
  // Every type goes through the plugin, so every event takes the same path and they leave in call
  // order; with `track` alone, an `identify` sent right after construction overtook earlier tracks.
  identify: passThrough,
  page: passThrough,
  screen: passThrough,
  group: passThrough,
  alias: passThrough,
};

/**
 * The Sfere server SDK: every method of the underlying analytics client (`track`, `identify`,
 * `page`, `screen`, `group`, `alias`, `flush`, `closeAndFlush`, `on`), pointed at Sfere ingestion.
 *
 * ```ts
 * const sfere = new SfereAnalytics({ writeKey: process.env.SFERE_WRITE_KEY!, host: "https://ingest.example.com" });
 * sfere.track({ userId: "user_123", event: "purchase", properties, context: requestContext(req) });
 * await sfere.closeAndFlush(); // on shutdown
 * ```
 */
export class SfereAnalytics extends Analytics {
  constructor(options: SfereNodeOptions) {
    if (!options || typeof options.writeKey !== "string" || !options.writeKey.trim()) {
      throw new Error('Sfere Node SDK: "writeKey" is required.');
    }
    const settings: AnalyticsSettings = {
      writeKey: options.writeKey,
      host: parseHost(options.host),
      path: "/v1/batch",
      httpClient: sfereHttpClient(options.httpClient),
      ...(options.flushAt !== undefined ? { flushAt: options.flushAt } : {}),
      ...(options.flushInterval !== undefined ? { flushInterval: options.flushInterval } : {}),
      ...(options.maxRetries !== undefined ? { maxRetries: options.maxRetries } : {}),
      ...(options.httpRequestTimeout !== undefined
        ? { httpRequestTimeout: options.httpRequestTimeout }
        : {}),
      ...(options.disable !== undefined ? { disable: options.disable } : {}),
    };
    super(settings);
    void this.register(dedupPlugin);
  }
}

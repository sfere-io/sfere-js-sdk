import type { CDNSettings } from "@segment/analytics-next";

export type BatchingOption = boolean | { size?: number; timeout?: number };

export interface Endpoint {
  origin: string;
  hostPart: string;
  protocol: "http" | "https";
}

export function parseHost(host: unknown): Endpoint {
  let url: URL | undefined;
  try {
    url = typeof host === "string" && host ? new URL(host) : undefined;
  } catch {
    url = undefined;
  }
  if (!url || (url.protocol !== "https:" && url.protocol !== "http:")) {
    throw new Error(
      'Sfere SDK: "host" is required and must be an http(s) origin, e.g. "https://ingest.example.com".',
    );
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new Error(
      `Sfere SDK: "host" must be an origin without a path, got "${host as string}". Use "${url.origin}".`,
    );
  }
  return {
    origin: url.origin,
    hostPart: url.host,
    protocol: url.protocol === "http:" ? "http" : "https",
  };
}

/** The settings analytics-next would otherwise fetch from a CDN, built inline for our endpoint. */
export function buildCdnSettings(
  writeKey: string,
  endpoint: Endpoint,
  batching: BatchingOption | undefined,
): CDNSettings {
  // analytics-next builds `${protocol}://${apiHost}/${type[0]}` (standard) or `${apiHost}/b`
  // (batching); apiHost carries no scheme.
  const apiHost = `${endpoint.hostPart}${batching ? "/v1/batch" : "/api/s"}`;
  const batchConfig = typeof batching === "object" ? batching : {};
  return {
    integrations: {
      "Segment.io": {
        apiKey: writeKey,
        apiHost,
        protocol: endpoint.protocol,
        addBundledMetadata: false,
        ...(batching
          ? {
              deliveryStrategy: {
                strategy: "batching",
                config: { size: batchConfig.size ?? 10, timeout: batchConfig.timeout ?? 5000 },
              },
            }
          : {}),
      },
    },
    plan: {
      track: { __default: { enabled: true } },
      identify: { __default: { enabled: true } },
      group: { __default: { enabled: true } },
    },
    // Remote metrics off: with sampleRate 0 analytics-next never starts its flush timer or queues a
    // metric (`src/core/stats/remote-metrics.ts:74,104`). The host is ours anyway, so even a stray
    // flush could not reach a third party.
    metrics: { sampleRate: 0, host: apiHost, protocol: endpoint.protocol },
  } as CDNSettings;
}

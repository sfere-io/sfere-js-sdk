import { FetchHTTPClient, type HTTPClient } from "@segment/analytics-node";
import { baseLibrary, libraryName, version } from "./version";

type Wire = Record<string, unknown> & { context?: Record<string, unknown> };

/**
 * Shapes one event the way docs/WIRE-CONTRACT.md §3 requires, just before it is sent:
 * - no `_metadata` (analytics-node adds `nodeVersion` / `jsRuntime` in its destination plugin,
 *   `plugins/segmentio/index.ts` `normalizeEvent`, after every enrichment plugin has run);
 * - no `integrations` unless the caller set some;
 * - `context.library` is this SDK, with the wrapped library under `base` (the same destination
 *   plugin stamps its own name there, so it can only be replaced here).
 */
export function toWire(event: Wire): Wire {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { _metadata, integrations, ...rest } = event;
  const hasIntegrations =
    integrations !== null &&
    typeof integrations === "object" &&
    Object.keys(integrations as object).length > 0;
  const out: Wire = hasIntegrations ? { ...rest, integrations } : rest;
  out.context = { ...out.context, library: { name: libraryName, version, base: baseLibrary } };
  return out;
}

/** Rewrites a `{ batch, writeKey, sentAt }` body; anything else passes through untouched. */
export function rewriteBody(body: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return body;
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !Array.isArray((parsed as { batch?: unknown }).batch)
  ) {
    return body;
  }
  const payload = parsed as { batch: Wire[] };
  return JSON.stringify({ ...payload, batch: payload.batch.map(toWire) });
}

/**
 * Wraps a transport so every request carries the Sfere wire shape and User-Agent. Tests and
 * callers with their own transport (proxies, custom agents) pass theirs as `inner`.
 */
export function sfereHttpClient(inner: HTTPClient = new FetchHTTPClient()): HTTPClient {
  return {
    makeRequest(request) {
      return inner.makeRequest({
        ...request,
        headers: { ...request.headers, "User-Agent": `${libraryName}/${version}` },
        body: rewriteBody(request.body),
      });
    },
  };
}

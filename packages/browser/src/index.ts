import { AnalyticsBrowser } from "@segment/analytics-next";
import {
  sfereEnrichment,
  type ConsentPreferences,
  type SfereEnrichmentOptions,
  type SfereEnrichmentPlugin,
} from "./plugins/enrichment";
import { sfereEnvironment } from "./plugins/environment";
import { buildCdnSettings, parseHost } from "./settings";
import { probePersistence } from "./storage";
import { version } from "./version";

export { sfereEnrichment, version };
export type { ConsentPreferences, SfereEnrichmentOptions, SfereEnrichmentPlugin };
export type * from "./events";

export interface SfereBatchingOptions {
  /** Events per request. Default 10. */
  size?: number;
  /** Max milliseconds an event waits before its batch is sent. Default 5000. */
  timeout?: number;
}

export interface SfereLoadOptions extends SfereEnrichmentOptions {
  /** Public browser write key (`keyId:secret`). */
  writeKey: string;
  /** Ingestion endpoint origin: scheme + host, no path. */
  host: string;
  /** Send events in batches to `{host}/v1/batch/b` instead of one request per event. */
  batching?: boolean | SfereBatchingOptions;
  /** Origin analytics-next resolves its CDN against. Default: `host`. */
  cdnURL?: string;
  /**
   * Keep the underlying library's event queue, anonymous ID and user traits in memory only,
   * never in localStorage or cookies. Default: automatic. `load()` probes localStorage and
   * `document.cookie` and turns this on by itself when either throws (sandboxed iframes, opaque
   * origins, hardened privacy modes); set `true` to force in-memory mode regardless.
   */
  disableClientPersistence?: boolean;
  /** Log every event and plugin step to the console. Default false. */
  debug?: boolean;
}

export type SfereAnalyticsInstance = AnalyticsBrowser & {
  /** Update `context.consent` on every later event. */
  setConsent(consent: ConsentPreferences): void;
};

/**
 * Server-side rendering: an instance whose methods are no-ops resolving to undefined, so shared
 * code can call `sfere.track()` during SSR. It is not thenable and never loads anything.
 */
function inertInstance(setConsent: SfereAnalyticsInstance["setConsent"]): SfereAnalyticsInstance {
  const noop = (): Promise<undefined> => Promise.resolve(undefined);
  const target: Record<PropertyKey, unknown> = { setConsent };
  return new Proxy(target, {
    get: (t, prop) => (prop in t ? t[prop] : prop === "then" ? undefined : noop),
  }) as unknown as SfereAnalyticsInstance;
}

function load(options: SfereLoadOptions): SfereAnalyticsInstance {
  if (!options || typeof options.writeKey !== "string" || !options.writeKey.trim()) {
    throw new Error('Sfere SDK: "writeKey" is required.');
  }
  const endpoint = parseHost(options.host);
  const plugin = sfereEnrichment(options);
  const setConsent = (consent: ConsentPreferences): void => plugin.setConsent(consent);

  if (typeof window === "undefined") return inertInstance(setConsent);

  // Blocked storage: the underlying library reads localStorage in its persisted queue's mutex and
  // writes cookies in its cookie store without try/catch, and a throw there leaves every
  // track()/page() pending forever. Its own `disableClientPersistence` switches both to memory,
  // so probe first and flip it whenever either surface throws (or the caller asks for it). Its
  // environment plugin also reads a cookie unguarded on every event, so when cookies throw it is
  // swapped for a cookie-free one (see plugins/environment.ts).
  const probe = probePersistence();
  const disableClientPersistence =
    options.disableClientPersistence === true || !probe.storage || !probe.cookies;
  const plugins = probe.cookies ? [plugin] : [plugin, sfereEnvironment()];

  // No `integrations` in the init options: the Segment.io settings live in cdnSettings, so events
  // start with `integrations: {}` and only carry what the caller sets per call.
  const browser = AnalyticsBrowser.load(
    {
      writeKey: options.writeKey,
      cdnURL: options.cdnURL ?? endpoint.origin,
      cdnSettings: buildCdnSettings(options.writeKey, endpoint, options.batching),
      plugins,
    },
    { disableClientPersistence },
  );
  if (options.debug) void browser.debug(true);
  return Object.assign(browser, { setConsent });
}

export const SfereAnalytics = { load };

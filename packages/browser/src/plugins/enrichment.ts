import type { Context, Plugin, SegmentEvent } from "@segment/analytics-next";
import { currentSearch, readCookie, readJSON, writeJSON, type StorageKind } from "../storage";
import {
  CAMPAIGN_PARAMS,
  URL_CLICK_IDS,
  clientIdsFromCookies,
  fbcFromFbclid,
  fbcTime,
} from "@sfere.io/sfere-shared";
import { baseLibrary, libraryName, version } from "../version";

export type ConsentPreferences = Record<string, boolean>;

export interface SfereEnrichmentOptions {
  /** Inactivity after which a new session starts. Default 30. */
  sessionTimeoutMinutes?: number;
  /** Where URL click IDs persist. Default "session" (sessionStorage). */
  clickIdStorage?: StorageKind;
  /** Initial consent categories, sent as `context.consent.categoryPreferences`. */
  consent?: ConsentPreferences;
  /**
   * Copy the visitor's identify traits into `context.traits` on every later event. Default true.
   * Server-side destinations match on the traits of the event they receive (email, phone), and a
   * `track` does not otherwise carry them.
   */
  carryTraits?: boolean;
}

export interface SfereEnrichmentPlugin extends Plugin {
  /** Replace the consent categories carried on every later event. */
  setConsent(consent: ConsentPreferences): void;
}

const SESSION_KEY = "sfere_session";
const CLICK_KEY = "sfere_click_ids";

interface StoredClicks {
  ids: Record<string, string>;
  fbclid?: string;
  campaign: Record<string, string>;
}

interface StoredSession {
  id: number;
  last: number;
}

/**
 * The payload must not carry `_metadata`, nor `integrations` unless the caller set some.
 *
 * analytics-next 1.84.3 has no hook between building the wire body and sending it:
 * - `src/plugins/segmentio/index.ts:129` builds the body as `toFacade(ctx.event).json()`, a
 *   clone made by `@segment/facade` `dist/clone.js:9-11`, which copies every own enumerable
 *   property, functions included;
 * - `src/plugins/segmentio/normalize.ts:25-38` then adds `_metadata.failedInitializations` /
 *   `_metadata.retryCount`, and `normalize.ts:73-80` adds `_metadata.bundled/unbundled/bundledIds`
 *   unless `addBundledMetadata === false` (which `load()` sets);
 * - `@segment/analytics-core` `src/events/index.ts:278-296` always gives the event an
 *   `integrations` object (`{}` when nothing was set);
 * - the body is serialised with `JSON.stringify` in `fetch-dispatcher.ts:45` (standard) and
 *   `batched-dispatcher.ts:112-114,135-137` (batching copies each event with a rest spread,
 *   which keeps own enumerable properties).
 *
 * So a `toJSON` on the event survives into the body and shapes the serialised JSON, while the
 * in-memory event (which analytics-next uses for routing on `integrations`) is untouched.
 */
function wireToJSON(this: Record<string, unknown>): Record<string, unknown> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { _metadata, toJSON, integrations, ...rest } = this;
  const hasIntegrations =
    integrations !== null &&
    typeof integrations === "object" &&
    Object.keys(integrations as object).length > 0;
  return hasIntegrations ? { ...rest, integrations } : rest;
}

export function sfereEnrichment(options: SfereEnrichmentOptions = {}): SfereEnrichmentPlugin {
  const idleMs = (options.sessionTimeoutMinutes ?? 30) * 60_000;
  const clickStorage: StorageKind = options.clickIdStorage ?? "session";
  const carryTraits = options.carryTraits ?? true;
  /** The analytics instance, handed to `load()`; its user holds the identify traits. */
  let userTraits: (() => Record<string, unknown> | undefined) | undefined;
  let consent: ConsentPreferences | undefined = options.consent
    ? { ...options.consent }
    : undefined;

  // In-memory copies keep sessions and click IDs stable within the page when storage is blocked.
  let memoryClicks: StoredClicks = { ids: {}, campaign: {} };
  let memorySession: StoredSession | undefined;

  /** URL click IDs and campaign params seen this session; a newer URL value replaces an older one. */
  function sessionClicks(): StoredClicks {
    const stored = readJSON<StoredClicks>(clickStorage, CLICK_KEY) ?? memoryClicks;
    const clicks: StoredClicks = {
      ids: { ...stored.ids },
      campaign: { ...stored.campaign },
      ...(stored.fbclid ? { fbclid: stored.fbclid } : {}),
    };
    const query = new URLSearchParams(currentSearch());
    let changed = false;
    for (const [param, key] of Object.entries(URL_CLICK_IDS)) {
      const value = query.get(param);
      if (value && clicks.ids[key] !== value) {
        clicks.ids[key] = value;
        changed = true;
      }
    }
    const fbclid = query.get("fbclid");
    if (fbclid && clicks.fbclid !== fbclid) {
      // Meta's documented format: fb.<subdomainIndex>.<creationTime>.<fbclid>
      clicks.fbclid = fbclid;
      clicks.ids.fbc = fbcFromFbclid(fbclid, Date.now());
      changed = true;
    }
    for (const param of CAMPAIGN_PARAMS) {
      const value = query.get(param);
      if (value && clicks.campaign[param] !== value) {
        clicks.campaign[param] = value;
        changed = true;
      }
    }
    if (changed) writeJSON(clickStorage, CLICK_KEY, clicks);
    memoryClicks = clicks;
    return clicks;
  }

  function clientIds(clicks: StoredClicks): Record<string, string> {
    const ids = clientIdsFromCookies(readCookie);

    for (const [key, value] of Object.entries(clicks.ids)) {
      if (key === "fbc" && ids.fbc) {
        // The pixel-set _fbc cookie wins, unless the URL carried a newer fbclid.
        const sameClick = clicks.fbclid !== undefined && ids.fbc.endsWith(`.${clicks.fbclid}`);
        if (sameClick || fbcTime(ids.fbc) >= fbcTime(value)) continue;
      }
      ids[key] = value;
    }
    return ids;
  }

  /** Inactivity-based session in localStorage `sfere_session`. */
  function session(): { id: number } {
    const now = Date.now();
    let current = readJSON<StoredSession>("local", SESSION_KEY) ?? memorySession;
    if (!current || typeof current.id !== "number" || now - current.last > idleMs) {
      current = { id: now, last: now };
    }
    current = { id: current.id, last: now };
    memorySession = current;
    writeJSON("local", SESSION_KEY, current);
    return { id: current.id };
  }

  function enrich(ctx: Context): Context {
    const event = ctx.event as SegmentEvent & Record<string, unknown>;
    // Loosely typed: we add keys (clientIds, session, campaign.gad_*, page.lang) the core types omit.
    const context = (event.context ??= {}) as Record<string, unknown>;
    const clicks = sessionClicks();

    context.clientIds = { ...clientIds(clicks), ...(context.clientIds as object | undefined) };

    // Identify carries its traits at the top level already; every other event gets the stored ones,
    // under any the caller put on the event.
    if (carryTraits && event.type !== "identify" && userTraits) {
      const traits = userTraits();
      if (traits && Object.keys(traits).length > 0) {
        context.traits = { ...traits, ...(context.traits as object | undefined) };
      }
    }

    if (Object.keys(clicks.campaign).length > 0) {
      context.campaign = { ...(context.campaign as object | undefined), ...clicks.campaign };
    }

    context.session = session();

    // The underlying library's own "before" plugin stamps `context.library` with its name; this
    // runs after it (enrichment plugins follow "before" plugins), so the wire carries ours, and the
    // base library moves to `library.base`.
    context.library = { name: libraryName, version, base: baseLibrary };

    if (consent) context.consent = { categoryPreferences: { ...consent } };

    try {
      const lang = typeof document !== "undefined" ? document.documentElement.lang : "";
      if (lang) context.page = { ...(context.page as object | undefined), lang };
    } catch {
      // No document: nothing to add.
    }

    if (event.type === "track") {
      const properties = (event.properties ??= {});
      if (properties.sfere_dedup_id === undefined || properties.sfere_dedup_id === null) {
        properties.sfere_dedup_id = event.messageId;
      }
    }

    // Enumerable on purpose: the facade clone only copies enumerable properties (see wireToJSON).
    event.toJSON = wireToJSON;
    return ctx;
  }

  return {
    name: "Sfere Enrichment",
    type: "enrichment",
    version,
    isLoaded: () => true,
    load: (_ctx, analytics) => {
      userTraits = () => {
        try {
          return analytics?.user?.().traits?.() as Record<string, unknown> | undefined;
        } catch {
          return undefined;
        }
      };
      return Promise.resolve();
    },
    track: enrich,
    page: enrich,
    identify: enrich,
    group: enrich,
    alias: enrich,
    screen: enrich,
    setConsent(next: ConsentPreferences) {
      consent = { ...next };
    },
  };
}

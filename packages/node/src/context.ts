import type { TrackParams } from "@segment/analytics-node";

type ExtraContext = NonNullable<TrackParams["context"]>;
import {
  CAMPAIGN_PARAMS,
  URL_CLICK_IDS,
  clientIdsFromCookies,
  fbcFromFbclid,
} from "@fanfinity/sfere-shared";

/**
 * The parts of an incoming request `requestContext()` reads. Satisfied by Node's `IncomingMessage`
 * (plain `http`, Express, Fastify's `request.raw`, Next.js Pages API routes) and by the Fetch API
 * `Request` (Next.js route handlers and middleware, Hono, Remix, Cloudflare/Deno/Bun servers).
 */
export type IncomingRequestLike =
  | {
      headers: Record<string, string | string[] | undefined>;
      url?: string;
      /** Set by Express when `trust proxy` is configured. */
      ip?: string;
      socket?: { remoteAddress?: string; encrypted?: boolean } | null;
    }
  | { headers: { get(name: string): string | null }; url: string };

export interface RequestContextOptions {
  /**
   * Read the client IP from `X-Forwarded-For` / `X-Real-IP`. Default true: almost every deployment
   * sits behind a load balancer or platform proxy, where the socket address is the proxy's. Set
   * false when the app is reached directly, so a client cannot choose the IP it is reported with.
   */
  trustProxy?: boolean;
  /**
   * The page the visitor is on, when the request is not that page (e.g. an API call made by the
   * checkout page). Its query string supplies landing click IDs and UTM parameters. Default: the
   * request's own URL, then the `Referer` header.
   */
  pageUrl?: string;
  /** Clock for the `fbc` built from a landing `fbclid`; tests pass a fixed one. */
  now?: () => number;
}

/** What `requestContext()` returns: spread it into an event's `context`. */
export interface SfereRequestContext {
  ip?: string;
  userAgent?: string;
  locale?: string;
  page?: { url?: string; path?: string; search?: string; referrer?: string };
  /**
   * Only the UTM / `gad_*` parameters present in the URL. Typed as the underlying library's
   * `Campaign`, which declares `name`, `source` and `medium` as required, so the result can be
   * passed straight to `track({ context })`; any of them may in fact be absent (a Google Ads click
   * often carries only `gad_source`), and none is ever invented.
   */
  campaign?: ExtraContext["campaign"];
  clientIds?: Record<string, string>;
}

const UTM: Readonly<Record<string, string>> = {
  utm_source: "source",
  utm_medium: "medium",
  utm_campaign: "name",
  utm_term: "term",
  utm_content: "content",
};

function headerReader(req: IncomingRequestLike): (name: string) => string | undefined {
  const headers = req.headers as { get?: unknown };
  if (typeof headers.get === "function") {
    const fetchHeaders = req.headers as { get(name: string): string | null };
    return (name) => fetchHeaders.get(name) ?? undefined;
  }
  const record = req.headers as Record<string, string | string[] | undefined>;
  return (name) => {
    const value = record[name.toLowerCase()];
    return Array.isArray(value) ? value.join(", ") : value;
  };
}

/** `::ffff:203.0.113.7` (an IPv4 client on a dual-stack socket) -> `203.0.113.7`. */
const normalizeIp = (ip: string | undefined): string | undefined => {
  const trimmed = ip?.trim();
  if (!trimmed) return undefined;
  return trimmed.startsWith("::ffff:") && trimmed.includes(".") ? trimmed.slice(7) : trimmed;
};

function clientIp(
  req: IncomingRequestLike,
  header: (name: string) => string | undefined,
  trustProxy: boolean,
): string | undefined {
  if (trustProxy) {
    // The left-most entry is the original client; each proxy appends the address it saw.
    const forwarded = header("x-forwarded-for")?.split(",")[0];
    const ip = normalizeIp(forwarded) ?? normalizeIp(header("x-real-ip"));
    if (ip) return ip;
  }
  if ("ip" in req && typeof req.ip === "string" && trustProxy) return normalizeIp(req.ip);
  const socket = "socket" in req ? req.socket : undefined;
  return normalizeIp(socket?.remoteAddress);
}

function absoluteUrl(
  req: IncomingRequestLike,
  header: (name: string) => string | undefined,
  trustProxy: boolean,
): URL | undefined {
  const raw = req.url;
  if (!raw) return undefined;
  try {
    return new URL(raw);
  } catch {
    // A Node request URL is a path: rebuild the origin from the Host header.
  }
  const host = (trustProxy ? header("x-forwarded-host") : undefined) ?? header("host");
  if (!host) return undefined;
  const socket = "socket" in req ? req.socket : undefined;
  const proto =
    (trustProxy ? header("x-forwarded-proto")?.split(",")[0]?.trim() : undefined) ??
    (socket?.encrypted ? "https" : "http");
  try {
    return new URL(raw, `${proto}://${host.split(",")[0]!.trim()}`);
  } catch {
    return undefined;
  }
}

function parseCookies(header: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  for (const part of header?.split(";") ?? []) {
    const eq = part.indexOf("=");
    if (eq < 1) continue;
    const name = part.slice(0, eq).trim();
    let value = part.slice(eq + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    try {
      value = decodeURIComponent(value);
    } catch {
      // Keep the raw value when it is not valid percent-encoding.
    }
    if (!cookies.has(name)) cookies.set(name, value);
  }
  return cookies;
}

const tryUrl = (value: string | undefined): URL | undefined => {
  if (!value) return undefined;
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
};

/**
 * Builds the event `context` a server-side event needs to match on ad platforms, from the end
 * user's request: their IP and user agent (ingestion never fills these in for server events, see
 * docs/WIRE-CONTRACT.md §4), language, page, UTM/Google Ads campaign parameters, and the click IDs
 * in their first-party cookies and landing URL.
 *
 * ```ts
 * sfere.track({ userId, event: "purchase", properties, context: requestContext(req) });
 * ```
 */
export function requestContext(
  req: IncomingRequestLike,
  options: RequestContextOptions = {},
): SfereRequestContext {
  const trustProxy = options.trustProxy ?? true;
  const now = options.now ?? Date.now;
  const header = headerReader(req);
  const context: SfereRequestContext = {};

  const ip = clientIp(req, header, trustProxy);
  if (ip) context.ip = ip;
  const userAgent = header("user-agent");
  if (userAgent) context.userAgent = userAgent;
  const locale = header("accept-language")?.split(",")[0]?.split(";")[0]?.trim();
  if (locale && locale !== "*") context.locale = locale;

  const referrer = header("referer");
  const page = tryUrl(options.pageUrl) ?? absoluteUrl(req, header, trustProxy);
  if (page || referrer) {
    context.page = {
      ...(page ? { url: page.href, path: page.pathname, search: page.search } : {}),
      ...(referrer ? { referrer } : {}),
    };
  }

  // Landing parameters: from the page URL, else the referrer (an API call from the landing page).
  const query = (page?.search ? page : tryUrl(referrer))?.searchParams;
  const campaign: Record<string, string> = {};
  for (const [param, key] of Object.entries(UTM)) {
    const value = query?.get(param);
    if (value) campaign[key] = value;
  }
  for (const param of CAMPAIGN_PARAMS) {
    const value = query?.get(param);
    if (value) campaign[param] = value;
  }
  if (Object.keys(campaign).length > 0) {
    context.campaign = campaign as unknown as NonNullable<ExtraContext["campaign"]>;
  }

  const cookies = parseCookies(header("cookie"));
  const clientIds = clientIdsFromCookies((name) => cookies.get(name) || undefined);
  for (const [param, key] of Object.entries(URL_CLICK_IDS)) {
    const value = query?.get(param);
    if (value) clientIds[key] = value;
  }
  // A landing fbclid is a click happening now: it beats an older `_fbc` cookie, unless the cookie
  // already records this same click.
  const fbclid = query?.get("fbclid");
  if (fbclid && !clientIds.fbc?.endsWith(`.${fbclid}`)) {
    clientIds.fbc = fbcFromFbclid(fbclid, now());
  }
  if (Object.keys(clientIds).length > 0) context.clientIds = clientIds;

  return context;
}

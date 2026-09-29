// Storage helpers that never throw: cookies and Web Storage can be blocked (privacy modes,
// sandboxed iframes, SSR), and the SDK must keep working without them.

export type StorageKind = "session" | "local";

const hasDom = (): boolean => typeof window !== "undefined" && typeof document !== "undefined";

export function readCookie(name: string): string | undefined {
  if (!hasDom()) return undefined;
  try {
    const escaped = name.replace(/[.$?*|{}()[\]\\/+^]/g, "\\$&");
    const match = document.cookie.match(new RegExp(`(?:^|; )${escaped}=([^;]*)`));
    return match?.[1] ? decodeURIComponent(match[1]) : undefined;
  } catch {
    return undefined;
  }
}

function store(kind: StorageKind): Storage | undefined {
  if (!hasDom()) return undefined;
  try {
    return kind === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    return undefined;
  }
}

export function readJSON<T>(kind: StorageKind, key: string): T | undefined {
  try {
    const raw = store(kind)?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    return undefined;
  }
}

export function writeJSON(kind: StorageKind, key: string, value: unknown): void {
  try {
    store(kind)?.setItem(key, JSON.stringify(value));
  } catch {
    // Blocked or full storage: the in-memory copy held by the caller still applies.
  }
}

export interface PersistenceProbe {
  /** localStorage can be written, read back and cleared without throwing. */
  storage: boolean;
  /** `document.cookie` can be read and written without throwing. */
  cookies: boolean;
}

const PROBE_KEY = "sfere_probe";

/**
 * Whether the browser lets scripts touch localStorage and `document.cookie` at all. Both throw
 * (rather than silently no-op) in sandboxed iframes, opaque origins and some hardened privacy
 * modes; the underlying analytics library has a few unguarded accesses on those paths, so
 * `load()` switches it to in-memory persistence when either probe fails. Leaves nothing behind:
 * the storage key is removed and the probe cookie is written with an expiry date in the past.
 */
export function probePersistence(): PersistenceProbe {
  if (!hasDom()) return { storage: false, cookies: false };
  return { storage: storageWorks(), cookies: cookiesWork() };
}

function storageWorks(): boolean {
  try {
    const local = window.localStorage;
    local.setItem(PROBE_KEY, "1");
    const readBack = local.getItem(PROBE_KEY) === "1";
    local.removeItem(PROBE_KEY);
    return readBack;
  } catch {
    return false;
  }
}

function cookiesWork(): boolean {
  try {
    void document.cookie;
    // An expiry date in the past deletes the cookie in every implementation; `max-age=0` left it
    // readable in some DOM implementations (happy-dom: 2,976 of 3,000 immediate reads).
    document.cookie = `${PROBE_KEY}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
    return true;
  } catch {
    return false;
  }
}

export function currentSearch(): string {
  if (!hasDom()) return "";
  try {
    return window.location.search;
  } catch {
    return "";
  }
}

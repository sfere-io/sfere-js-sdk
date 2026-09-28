import type { Context } from "@segment/analytics-next";
import { vi } from "vitest";

export interface CapturedRequest {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

/** Replaces global fetch; records the URL, headers and parsed JSON body of every request. */
export function captureFetch(status = 200): CapturedRequest[] {
  const requests: CapturedRequest[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      requests.push({
        url: String(url),
        headers: (init?.headers ?? {}) as Record<string, string>,
        body:
          typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : {},
      });
      return new Response("{}", { status });
    }),
  );
  return requests;
}

export function clearBrowserState(): void {
  localStorage.clear();
  sessionStorage.clear();
  for (const cookie of document.cookie.split(";")) {
    const name = cookie.split("=")[0]?.trim();
    if (name) document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
  }
  history.replaceState(null, "", "/");
  document.documentElement.lang = "";
}

export function setCookie(name: string, value: string): void {
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/`;
}

export function setUrl(search: string): void {
  history.replaceState(null, "", `/landing${search}`);
}

type Event = Record<string, unknown> & { context?: Record<string, unknown> };

/** A minimal stand-in for an analytics-next Context. */
export function fakeCtx(event: Partial<Event> = {}): Context & { event: Event } {
  return {
    event: { type: "track", event: "test", messageId: "msg-1", properties: {}, ...event },
  } as unknown as Context & { event: Event };
}

let counter = 0;
/** Unique write key per test, so analytics-next's persisted queues never leak between tests. */
export const uniqueKey = (): string => `key${++counter}:secret`;

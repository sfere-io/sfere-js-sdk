// Shared helpers for the Playwright e2e specs: talking to mock-ingest.mjs's introspection routes,
// and waiting for the SDK to finish loading in the page under test.
import { type APIRequestContext, type Page, expect } from "@playwright/test";

export const SITE_ORIGIN = "http://127.0.0.1:4310";
export const INGEST_ORIGIN = "http://127.0.0.1:4311";
export const WRITE_KEY = "keyIdE2E:secretE2E";

export type KeySource = "basic" | "header" | "query" | "body" | "none";

export interface RecordedRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
  keySource: KeySource;
  writeKey: string | null;
  timestamp: number;
  batchSize?: number;
  unexpected?: boolean;
}

/** Narrows an arbitrary JSON value to a plain object, or `{}` when it isn't one. */
export function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export async function resetMock(request: APIRequestContext): Promise<void> {
  const res = await request.post(`${INGEST_ORIGIN}/__reset`);
  if (!res.ok()) throw new Error(`mock-ingest: /__reset failed with ${res.status()}`);
}

export async function fetchEvents(request: APIRequestContext): Promise<RecordedRequest[]> {
  const res = await request.get(`${INGEST_ORIGIN}/__events`);
  if (!res.ok()) throw new Error(`mock-ingest: /__events failed with ${res.status()}`);
  return (await res.json()) as RecordedRequest[];
}

/** Only the events the mock actually accepted as ingestion traffic (not /__events itself, etc). */
export function ingestEvents(events: RecordedRequest[]): RecordedRequest[] {
  return events.filter((event) => !event.unexpected);
}

/**
 * Polls `GET /__events` until `predicate` is satisfied, then returns the matching snapshot.
 * Fails the test (via `expect.poll`) if it never is within `timeoutMs`.
 */
export async function waitForEvents(
  request: APIRequestContext,
  predicate: (events: RecordedRequest[]) => boolean,
  timeoutMs = 5000,
): Promise<RecordedRequest[]> {
  let latest: RecordedRequest[] = [];
  await expect
    .poll(
      async () => {
        latest = await fetchEvents(request);
        return predicate(latest);
      },
      { timeout: timeoutMs, message: "waiting for mock-ingest to record the expected request(s)" },
    )
    .toBe(true);
  return latest;
}

/**
 * True once `window.sfere` has been replaced by the real loaded instance — the loader-snippet
 * stub is a plain array, so `Array.isArray` tells the two apart.
 */
export async function waitForSfereLoaded(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const sfere = (window as unknown as { sfere?: unknown }).sfere;
    return typeof sfere === "object" && sfere !== null && !Array.isArray(sfere);
  });
}

/** True once the ESM harness page (test/e2e/site/esm.html) has finished `SfereAnalytics.load`. */
export async function waitForEsmReady(page: Page): Promise<void> {
  await page.waitForFunction(() => (window as unknown as { __sfereReady?: boolean }).__sfereReady === true);
}

/** Builds an esm.html URL with load-option overrides passed as query params (see site/esm.html). */
export function esmUrl(params: Record<string, string> = {}): string {
  const search = new URLSearchParams(params).toString();
  return `${SITE_ORIGIN}/esm.html${search ? `?${search}` : ""}`;
}

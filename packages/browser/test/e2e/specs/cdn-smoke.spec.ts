// Post-deploy smoke test of the LIVE CDN, run by .github/workflows/cdn-deploy.yml right after an
// upload. Skipped in the normal suite: it needs CDN_SMOKE_URL (the immutable sfere.min.js URL).
// Optional: CDN_SMOKE_SRI (sha384 from the build's manifest.json) and CDN_SMOKE_VERSION.
//
// It loads the production bytes with <script integrity crossorigin> in a real browser, the way a
// client's pinned page does, and checks the bundle initialises and delivers events to the (mock)
// ingestion host: a CORS or SRI regression on the CDN, or a bundle that loads but never sends,
// fails the deploy instead of client sites.
import { expect, test } from "@playwright/test";
import {
  INGEST_ORIGIN,
  SITE_ORIGIN,
  WRITE_KEY,
  asRecord,
  ingestEvents,
  resetMock,
  waitForEvents,
} from "../utils";

const url = process.env.CDN_SMOKE_URL;
const sri = process.env.CDN_SMOKE_SRI;
const expectedVersion = process.env.CDN_SMOKE_VERSION;

test.skip(!url, "CDN_SMOKE_URL not set: the live-CDN smoke test runs only after a deploy");

test("live CDN bundle loads with SRI and delivers events", async ({ page, request }) => {
  await resetMock(request);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  const offHost: string[] = [];
  page.on("request", (req) => {
    const target = req.url();
    if (!target.startsWith(SITE_ORIGIN) && !target.startsWith(INGEST_ORIGIN) && target !== url) {
      offHost.push(target);
    }
  });

  // An empty page on the site origin; the bundle is injected the way the pinned-tag docs show.
  await page.goto(`${SITE_ORIGIN}/blank.html`);
  await page.evaluate(
    ({ src, integrity, writeKey, host }) => {
      const script = document.createElement("script");
      script.src = src;
      if (integrity) {
        script.integrity = integrity;
        script.crossOrigin = "anonymous";
      }
      script.setAttribute("data-write-key", writeKey);
      script.setAttribute("data-host", host);
      // A blocked load (SRI mismatch, CORS, 404) fires `error`: record it and fail fast.
      script.onerror = () => {
        (window as unknown as { __cdnLoadError?: boolean }).__cdnLoadError = true;
      };
      document.head.appendChild(script);
    },
    { src: url!, integrity: sri ?? "", writeKey: WRITE_KEY, host: INGEST_ORIGIN },
  );

  await page.waitForFunction(() => {
    const w = window as unknown as { sfere?: unknown; __cdnLoadError?: boolean };
    return w.__cdnLoadError || (typeof w.sfere === "object" && w.sfere !== null && !Array.isArray(w.sfere));
  });
  const loadError = await page.evaluate(
    () => (window as unknown as { __cdnLoadError?: boolean }).__cdnLoadError === true,
  );
  expect(loadError, `the browser refused to load ${url} (SRI mismatch, CORS or HTTP error)`).toBe(false);
  await page.evaluate(async () => {
    const sfere = (window as unknown as { sfere: { track: (...a: unknown[]) => Promise<unknown> } })
      .sfere;
    await sfere.track("cdn_smoke", { value: 1 });
  });

  const events = await waitForEvents(request, (recorded) =>
    ingestEvents(recorded).some((event) => asRecord(event.body).event === "cdn_smoke"),
  );
  const event = ingestEvents(events).find((e) => asRecord(e.body).event === "cdn_smoke");
  expect(event?.keySource).toBe("basic");
  expect(event?.writeKey).toBe(WRITE_KEY);
  const library = asRecord(asRecord(asRecord(event?.body).context).library);
  expect(library.name).toBe("@sfere-io/sfere-sdk");
  if (expectedVersion) expect(library.version).toBe(expectedVersion);

  expect(offHost).toEqual([]);
  expect(errors).toEqual([]);
});

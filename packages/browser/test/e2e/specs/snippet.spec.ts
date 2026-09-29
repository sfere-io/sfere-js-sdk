import { expect, test } from "@playwright/test";
import {
  INGEST_ORIGIN,
  SITE_ORIGIN,
  WRITE_KEY,
  fetchEvents,
  ingestEvents,
  resetMock,
  waitForEvents,
} from "../utils";

test.beforeEach(async ({ request }) => {
  await resetMock(request);
});

test("loader snippet: queued calls are delivered in order once the bundle loads, over Basic auth, with no console errors and no foreign hosts", async ({
  page,
  request,
}) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  const outsideOrigins: string[] = [];
  page.on("request", (req) => {
    const origin = new URL(req.url()).origin;
    if (origin !== SITE_ORIGIN && origin !== INGEST_ORIGIN) outsideOrigins.push(req.url());
  });

  await page.goto("/snippet.html");

  const events = await waitForEvents(request, (recorded) => ingestEvents(recorded).length >= 3);
  const ingested = ingestEvents(events);

  expect(ingested).toHaveLength(3);
  expect(ingested.map((e) => e.path)).toEqual(["/api/s/i", "/api/s/p", "/api/s/t"]);

  for (const event of ingested) {
    expect(event.keySource).toBe("basic");
    expect(event.writeKey).toBe(WRITE_KEY);
  }

  expect(outsideOrigins).toEqual([]);
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);

  // No further requests appear after the fact (order stays [identify, page, track], not reordered
  // or duplicated by a later flush).
  const finalEvents = ingestEvents(await fetchEvents(request));
  expect(finalEvents.map((e) => e.path)).toEqual(["/api/s/i", "/api/s/p", "/api/s/t"]);
});

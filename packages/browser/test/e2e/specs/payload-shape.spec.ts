import { expect, test } from "@playwright/test";
import { asRecord, esmUrl, ingestEvents, resetMock, waitForEsmReady, waitForEvents } from "../utils";

test.beforeEach(async ({ request }) => {
  await resetMock(request);
});

test("payload shape: no _metadata, no integrations unless set, library/messageId/anonymousId/timestamp present", async ({
  page,
  request,
}) => {
  await page.goto(esmUrl());
  await waitForEsmReady(page);

  await page.evaluate(() => {
    const sfere = (window as unknown as { __sfere: { track: (...args: unknown[]) => void } })
      .__sfere;
    sfere.track("shape_test", { foo: 1 });
  });

  const events = await waitForEvents(request, (recorded) => ingestEvents(recorded).length >= 1);
  const [event] = ingestEvents(events);
  const body = asRecord(event?.body);

  expect(body).not.toHaveProperty("_metadata");
  expect(body).not.toHaveProperty("integrations");

  const context = asRecord(body.context);
  const library = asRecord(context.library);
  expect(library.name).toBe("@sfere.io/sfere-sdk");
  expect(String(library.version)).toMatch(/^\d+\.\d+\.\d+/);
  expect(String(library.base)).toMatch(/^analytics-next@\d+\.\d+\.\d+/);

  expect(typeof body.messageId).toBe("string");
  expect(String(body.messageId).length).toBeGreaterThan(0);
  expect(typeof body.anonymousId).toBe("string");
  expect(String(body.anonymousId).length).toBeGreaterThan(0);

  const hasTimestamp = typeof body.timestamp === "string";
  const hasSentAt = typeof body.sentAt === "string";
  expect(hasTimestamp || hasSentAt).toBe(true);

  // Documented behaviour, not asserted as a requirement: analytics-next's normalize() sets
  // `json.writeKey = settings.apiKey` on every event regardless of transport (see
  // node_modules/@segment/analytics-next/dist/cjs/plugins/segmentio/normalize.js), and the SDK's
  // wireToJSON only strips `_metadata`/`toJSON`/empty `integrations` — so `writeKey` does appear
  // in the body, in addition to the Basic-auth header the mock reads it from.
  expect(typeof body.writeKey).toBe("string");
});

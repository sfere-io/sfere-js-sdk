import { expect, test } from "@playwright/test";
import { SITE_ORIGIN, asRecord, esmUrl, ingestEvents, resetMock, waitForEsmReady, waitForEvents } from "../utils";

async function track(page: import("@playwright/test").Page, name: string): Promise<void> {
  await page.evaluate((eventName) => {
    const sfere = (window as unknown as { __sfere: { track: (...args: unknown[]) => void } })
      .__sfere;
    sfere.track(eventName);
  }, name);
}

function sessionIdOf(body: unknown): unknown {
  const context = asRecord(asRecord(body).context);
  return asRecord(context.session).id;
}

test.beforeEach(async ({ request }) => {
  await resetMock(request);
});

test("context.session.id is stable across events and across a page navigation", async ({
  page,
  request,
}) => {
  await page.goto(esmUrl());
  await waitForEsmReady(page);
  await track(page, "session_1");
  await track(page, "session_2");

  let events = await waitForEvents(request, (recorded) => ingestEvents(recorded).length >= 2);
  const [first, second] = ingestEvents(events);
  const firstId = sessionIdOf(first?.body);
  expect(typeof firstId).toBe("number");
  expect(sessionIdOf(second?.body)).toBe(firstId);

  // A fresh navigation to the same page (default 30-minute timeout, not exceeded) keeps the id.
  await page.goto(`${SITE_ORIGIN}/esm.html`);
  await waitForEsmReady(page);
  await track(page, "session_3");

  events = await waitForEvents(request, (recorded) => ingestEvents(recorded).length >= 3);
  const third = ingestEvents(events).find((e) => asRecord(e.body).event === "session_3");
  expect(sessionIdOf(third?.body)).toBe(firstId);
});

test("session rotates after the configured inactivity timeout", async ({ page, request }) => {
  // A tiny timeout (~120ms) lets the test wait out real inactivity instead of faking the clock.
  await page.goto(esmUrl({ sessionTimeoutMinutes: "0.002" }));
  await waitForEsmReady(page);
  await track(page, "before_timeout");

  let events = await waitForEvents(request, (recorded) => ingestEvents(recorded).length >= 1);
  const firstId = sessionIdOf(ingestEvents(events)[0]?.body);
  expect(typeof firstId).toBe("number");

  await page.waitForTimeout(400);
  await track(page, "after_timeout");

  events = await waitForEvents(request, (recorded) => ingestEvents(recorded).length >= 2);
  const second = ingestEvents(events).find((e) => asRecord(e.body).event === "after_timeout");
  const secondId = sessionIdOf(second?.body);
  expect(typeof secondId).toBe("number");
  expect(secondId).not.toBe(firstId);
});

import { expect, test } from "@playwright/test";
import { asRecord, esmUrl, ingestEvents, resetMock, waitForEsmReady, waitForEvents } from "../utils";

test.beforeEach(async ({ request }) => {
  await resetMock(request);
});

test("setConsent adds context.consent.categoryPreferences to later events only", async ({
  page,
  request,
}) => {
  await page.goto(esmUrl());
  await waitForEsmReady(page);

  await page.evaluate(() => {
    const sfere = (window as unknown as { __sfere: { track: (...args: unknown[]) => void } })
      .__sfere;
    sfere.track("before_consent");
  });

  let events = await waitForEvents(request, (recorded) => ingestEvents(recorded).length >= 1);
  const before = asRecord(ingestEvents(events)[0]?.body);
  expect(asRecord(before.context)).not.toHaveProperty("consent");

  await page.evaluate(() => {
    const sfere = (
      window as unknown as {
        __sfere: { setConsent: (c: Record<string, boolean>) => void; track: (...args: unknown[]) => void };
      }
    ).__sfere;
    sfere.setConsent({ advertising: true, analytics: false });
    sfere.track("after_consent");
  });

  events = await waitForEvents(request, (recorded) => ingestEvents(recorded).length >= 2);
  const after = ingestEvents(events).find((e) => asRecord(e.body).event === "after_consent");
  const context = asRecord(asRecord(after?.body).context);
  expect(context.consent).toEqual({
    categoryPreferences: { advertising: true, analytics: false },
  });
});

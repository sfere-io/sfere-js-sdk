import { expect, test } from "@playwright/test";
import { asRecord, esmUrl, ingestEvents, resetMock, waitForEsmReady, waitForEvents } from "../utils";

test.beforeEach(async ({ request }) => {
  await resetMock(request);
});

test("context.page.lang reflects <html lang>", async ({ page, request }) => {
  await page.goto(esmUrl({ lang: "ar" }));
  await waitForEsmReady(page);
  expect(await page.evaluate(() => document.documentElement.lang)).toBe("ar");

  await page.evaluate(() => {
    const sfere = (window as unknown as { __sfere: { page: (...args: unknown[]) => void } }).__sfere;
    sfere.page("Home");
  });

  const events = await waitForEvents(request, (recorded) => ingestEvents(recorded).length >= 1);
  const body = asRecord(ingestEvents(events)[0]?.body);
  const context = asRecord(body.context);
  expect(asRecord(context.page).lang).toBe("ar");
});

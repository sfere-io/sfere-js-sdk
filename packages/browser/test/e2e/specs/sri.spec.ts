import { expect, test } from "@playwright/test";
import { fetchEvents, ingestEvents, resetMock, waitForEvents } from "../utils";

test.beforeEach(async ({ request }) => {
  await resetMock(request);
});

test("SRI page with the correct sha384 hash loads and sends", async ({ page, request }) => {
  await page.goto("/sri.html");
  await page.waitForFunction(() => typeof (window as unknown as { sfere?: unknown }).sfere === "object");

  await page.evaluate(() => {
    const sfere = (window as unknown as { sfere: { track: (...args: unknown[]) => void } }).sfere;
    sfere.track("sri_ok");
  });

  const events = await waitForEvents(request, (recorded) => ingestEvents(recorded).length >= 1);
  expect(ingestEvents(events)).toHaveLength(1);
  expect(await page.evaluate(() => (window as unknown as { __sriError: boolean }).__sriError)).toBe(
    false,
  );
});

test("SRI page with a deliberately wrong hash is blocked by the browser and sends nothing", async ({
  page,
  request,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));

  await page.goto("/sri-bad.html");
  await page
    .waitForFunction(() => (window as unknown as { __sriError: boolean }).__sriError === true, {
      timeout: 5000,
    })
    .catch(() => undefined);

  expect(await page.evaluate(() => (window as unknown as { __sriError: boolean }).__sriError)).toBe(
    true,
  );
  expect(await page.evaluate(() => typeof (window as unknown as { sfere?: unknown }).sfere)).toBe(
    "undefined",
  );
  expect(await page.evaluate(() => typeof (window as unknown as { SfereSDK?: unknown }).SfereSDK)).toBe(
    "undefined",
  );

  // Give any (unwanted) request a moment to arrive, then confirm none did.
  await page.waitForTimeout(300);
  const events = await fetchEvents(request);
  expect(ingestEvents(events)).toHaveLength(0);
  expect(pageErrors).toEqual([]);
});

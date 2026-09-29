import { expect, test } from "@playwright/test";
import { SITE_ORIGIN, asRecord, esmUrl, ingestEvents, resetMock, waitForEsmReady, waitForEvents } from "../utils";

async function track(page: import("@playwright/test").Page, name: string): Promise<void> {
  await page.evaluate((eventName) => {
    const sfere = (window as unknown as { __sfere: { track: (...args: unknown[]) => void } })
      .__sfere;
    sfere.track(eventName);
  }, name);
}

test.beforeEach(async ({ request }) => {
  await resetMock(request);
});

test("ad-platform cookies map to context.clientIds keys", async ({ page, context, request }) => {
  await context.addCookies([
    { name: "_fbp", value: "fb.1.111.PIXEL", domain: "127.0.0.1", path: "/" },
    { name: "_ttp", value: "TTP1", domain: "127.0.0.1", path: "/" },
    { name: "_scid", value: "SC1", domain: "127.0.0.1", path: "/" },
    { name: "_gcl_aw", value: "GCL.123.GCLIDX", domain: "127.0.0.1", path: "/" },
    { name: "_uetmsclkid", value: "MSCLK1", domain: "127.0.0.1", path: "/" },
    { name: "__oppref", value: "OPP1", domain: "127.0.0.1", path: "/" },
    { name: "li_fat_id", value: "LI1", domain: "127.0.0.1", path: "/" },
    { name: "_epik", value: "EPIK1", domain: "127.0.0.1", path: "/" },
    { name: "_scclid", value: "SCCLID1", domain: "127.0.0.1", path: "/" },
    { name: "ttclid", value: "TTCLID1", domain: "127.0.0.1", path: "/" },
    { name: "_clck", value: "CLUID1%5E2%5Eg9u%5E0%5E2462", domain: "127.0.0.1", path: "/" },
    { name: "_clsk", value: "CLSID1%5E1790618888524%5E1%5E1%5En.clarity.ms%2Fcollect", domain: "127.0.0.1", path: "/" },
  ]);

  await page.goto(esmUrl());
  await waitForEsmReady(page);
  await track(page, "cookie_event");

  const events = await waitForEvents(request, (recorded) => ingestEvents(recorded).length >= 1);
  const body = asRecord(ingestEvents(events)[0]?.body);
  const clientIds = asRecord(asRecord(body.context).clientIds);

  expect(clientIds.fbp).toBe("fb.1.111.PIXEL");
  expect(clientIds.ttp).toBe("TTP1");
  expect(clientIds.scid).toBe("SC1");
  // `_gcl_aw` is `GCL.<ts>.<gclid>`: the gclid is everything after the second dot.
  expect(clientIds.gclid).toBe("GCLIDX");
  expect(clientIds.msclkid).toBe("MSCLK1");
  expect(clientIds.oppref).toBe("OPP1");
  expect(clientIds.li_fat_id).toBe("LI1");
  expect(clientIds.epik).toBe("EPIK1");
  expect(clientIds.scclid).toBe("SCCLID1");
  expect(clientIds.ttclid).toBe("TTCLID1");
  // Clarity's `_clck` / `_clsk` are `^`-delimited (stored as %5E): the ID is the first field.
  expect(clientIds.clarity_uid).toBe("CLUID1");
  expect(clientIds.clarity_sid).toBe("CLSID1");
});

test("_fbc cookie precedence vs a landing fbclid: whichever click is newer wins", async ({
  page,
  context,
  request,
}) => {
  // A pixel-set _fbc newer than the URL's fbclid: the cookie wins, untouched.
  await context.addCookies([
    { name: "_fbc", value: `fb.1.${Date.now() + 100_000}.OLDCLICK`, domain: "127.0.0.1", path: "/" },
  ]);
  await page.goto(`${SITE_ORIGIN}/esm.html?fbclid=NEWCLICK`);
  await waitForEsmReady(page);
  await track(page, "fbc_cookie_wins");

  let events = await waitForEvents(request, (recorded) => ingestEvents(recorded).length >= 1);
  let clientIds = asRecord(asRecord(asRecord(ingestEvents(events)[0]?.body).context).clientIds);
  expect(String(clientIds.fbc)).toContain("OLDCLICK");

  await resetMock(request);
  await context.clearCookies();

  // A pixel-set _fbc older than the URL's fbclid: the URL wins, `fbc` is recomputed from it.
  await context.addCookies([
    { name: "_fbc", value: "fb.1.1000.OLDCLICK", domain: "127.0.0.1", path: "/" },
  ]);
  await page.goto(`${SITE_ORIGIN}/esm.html?fbclid=NEWCLICK`);
  await waitForEsmReady(page);
  await track(page, "fbc_url_wins");

  events = await waitForEvents(request, (recorded) => ingestEvents(recorded).length >= 1);
  clientIds = asRecord(asRecord(asRecord(ingestEvents(events)[0]?.body).context).clientIds);
  expect(String(clientIds.fbc)).toMatch(/^fb\.1\.\d+\.NEWCLICK$/);
});

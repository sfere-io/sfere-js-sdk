import { expect, test } from "@playwright/test";
import {
  SITE_ORIGIN,
  asRecord,
  ingestEvents,
  resetMock,
  waitForEsmReady,
  waitForEvents,
} from "../utils";

test.beforeEach(async ({ request }) => {
  await resetMock(request);
});

const LANDING_QUERY =
  "gclid=G1&wbraid=W1&gbraid=GB1&ttclid=T1&ScCid=S1&twclid=X1&epik=E1&msclkid=M1&li_fat_id=L1" +
  "&oppref=O1&rdt_cid=R1&fbclid=F1&gad_source=1&gad_campaignid=123&utm_source=google&utm_campaign=c1";

async function track(page: import("@playwright/test").Page, name: string): Promise<void> {
  await page.evaluate((eventName) => {
    const sfere = (window as unknown as { __sfere: { track: (...args: unknown[]) => void } })
      .__sfere;
    sfere.track(eventName);
  }, name);
}

test("landing URL click IDs and campaign params land in context.clientIds / context.campaign, and persist to a second page", async ({
  page,
  request,
}) => {
  await page.goto(`${SITE_ORIGIN}/esm.html?${LANDING_QUERY}`);
  await waitForEsmReady(page);
  await track(page, "landing_event");

  let events = await waitForEvents(request, (recorded) => ingestEvents(recorded).length >= 1);
  let body = asRecord(ingestEvents(events)[0]?.body);
  let context = asRecord(body.context);
  let clientIds = asRecord(context.clientIds);

  expect(clientIds.gclid).toBe("G1");
  expect(clientIds.wbraid).toBe("W1");
  expect(clientIds.gbraid).toBe("GB1");
  expect(clientIds.ttclid).toBe("T1");
  expect(clientIds.scclid).toBe("S1"); // URL param is ScCid, mapped key is scclid
  expect(clientIds.twclid).toBe("X1");
  expect(clientIds.epik).toBe("E1");
  expect(clientIds.msclkid).toBe("M1");
  expect(clientIds.li_fat_id).toBe("L1");
  expect(clientIds.oppref).toBe("O1");
  expect(clientIds.rdt_cid).toBe("R1");
  expect(String(clientIds.fbc)).toMatch(/^fb\.1\.\d+\.F1$/);

  // analytics-next's own env-enrichment plugin parses `utm_*` params itself, stripping the
  // "utm_" prefix and renaming "campaign" -> "name" (env-enrichment/index.js's `utm()`); the SDK
  // merges gad_source/gad_campaignid into that same object rather than replacing it.
  const campaign = asRecord(context.campaign);
  expect(campaign.source).toBe("google");
  expect(campaign.name).toBe("c1");
  expect(campaign.gad_source).toBe("1");
  expect(campaign.gad_campaignid).toBe("123");

  // Second page, no query params: the click IDs and campaign params persist (sessionStorage by
  // default), the way a real multi-page site session would carry them forward.
  await page.goto(`${SITE_ORIGIN}/esm.html`);
  await waitForEsmReady(page);
  await track(page, "second_page_event");

  events = await waitForEvents(request, (recorded) => ingestEvents(recorded).length >= 2);
  const secondEvent = ingestEvents(events).find((e) => asRecord(e.body).event === "second_page_event");
  body = asRecord(secondEvent?.body);
  context = asRecord(body.context);
  clientIds = asRecord(context.clientIds);

  expect(clientIds.gclid).toBe("G1");
  expect(String(clientIds.fbc)).toMatch(/^fb\.1\.\d+\.F1$/);
  const campaignAfter = asRecord(context.campaign);
  expect(campaignAfter.gad_source).toBe("1");
});

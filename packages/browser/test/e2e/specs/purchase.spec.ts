import { expect, test } from "@playwright/test";
import { asRecord, esmUrl, ingestEvents, resetMock, waitForEsmReady, waitForEvents } from "../utils";

test.beforeEach(async ({ request }) => {
  await resetMock(request);
});

test("purchase (GA4 shape): properties pass through untouched; sfere_dedup_id defaults to messageId, or keeps an explicit value", async ({
  page,
  request,
}) => {
  await page.goto(esmUrl());
  await waitForEsmReady(page);

  await page.evaluate(() => {
    const sfere = (window as unknown as { __sfere: { track: (...args: unknown[]) => void } })
      .__sfere;
    sfere.track("purchase", {
      value: 99.98,
      currency: "USD",
      transaction_id: "T-1001",
      items: [{ item_id: "sku1", item_name: "Widget", price: 49.99, quantity: 2 }],
    });
    sfere.track("purchase", {
      value: 10,
      currency: "SAR",
      transaction_id: "T-1002",
      items: [{ item_id: "sku2", item_name: "Gadget", price: 10, quantity: 1 }],
      sfere_dedup_id: "ORDER-1",
    });
  });

  const events = await waitForEvents(request, (recorded) => ingestEvents(recorded).length >= 2);
  const purchases = ingestEvents(events).filter((e) => asRecord(e.body).event === "purchase");
  expect(purchases).toHaveLength(2);

  const withoutExplicitId = asRecord(purchases[0]?.body);
  const propsA = asRecord(withoutExplicitId.properties);
  expect(propsA.value).toBe(99.98);
  expect(propsA.currency).toBe("USD");
  expect(propsA.transaction_id).toBe("T-1001");
  expect(propsA.items).toEqual([{ item_id: "sku1", item_name: "Widget", price: 49.99, quantity: 2 }]);
  expect(propsA.sfere_dedup_id).toBe(withoutExplicitId.messageId);

  const withExplicitId = asRecord(purchases[1]?.body);
  const propsB = asRecord(withExplicitId.properties);
  expect(propsB.transaction_id).toBe("T-1002");
  expect(propsB.items).toEqual([{ item_id: "sku2", item_name: "Gadget", price: 10, quantity: 1 }]);
  expect(propsB.sfere_dedup_id).toBe("ORDER-1");
});

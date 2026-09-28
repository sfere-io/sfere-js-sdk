import { expect, test } from "@playwright/test";
import { asRecord, ingestEvents, resetMock, waitForEvents } from "../utils";

test.beforeEach(async ({ request }) => {
  await resetMock(request);
});

test("batching mode: identify + page + track arrive together in one POST /v1/batch/b", async ({
  page,
  request,
}) => {
  await page.goto("/batching.html");

  // Default batch config (size 10, timeout 5000ms): with only 3 events queued, the flush is
  // timer-driven, so this waits out that timeout rather than a fixed event count.
  const events = await waitForEvents(
    request,
    (recorded) => ingestEvents(recorded).some((e) => e.path === "/v1/batch/b"),
    8000,
  );

  const batchRequests = ingestEvents(events).filter((e) => e.path === "/v1/batch/b");
  expect(batchRequests).toHaveLength(1);

  const record = batchRequests[0];
  expect(record?.keySource).not.toBe("none");
  expect(record?.batchSize).toBe(3);

  const body = asRecord(record?.body);
  const batch = Array.isArray(body.batch) ? body.batch : [];
  expect(batch).toHaveLength(3);
  expect(batch.map((e) => asRecord(e).type)).toEqual(["identify", "page", "track"]);
  expect(asRecord(batch[2]).event).toBe("batch_event");
});

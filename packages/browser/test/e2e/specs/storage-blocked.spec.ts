import { expect, test, type Page } from "@playwright/test";
import { asRecord, esmUrl, ingestEvents, resetMock, waitForEsmReady, waitForEvents } from "../utils";

// The unmodified analytics dependency has storage accesses without try/catch: its persisted
// queue's mutex (localStorage getItem/setItem/removeItem), its cookie store's set(), and a
// `_ga` cookie read in its environment plugin. When either surface throws (private/hardened
// modes, sandboxed iframes), track()/page() either never settle or fail on every attempt, and
// nothing is sent. src/index.ts probes both surfaces in load(), switches the dependency to its
// own in-memory mode (`disableClientPersistence`) and, when cookies throw, swaps its environment
// plugin for a cookie-free one. These specs pin that down for every combination. `anonymousId`
// is asserted because it is what in-memory mode must still generate for the event to be valid.

type Blocked = "storage" | "cookies";

async function blockBeforeLoad(page: Page, what: Blocked[]): Promise<void> {
  await page.addInitScript((blockedSurfaces: Blocked[]) => {
    const blocked = (): never => {
      throw new Error("storage blocked");
    };
    if (blockedSurfaces.includes("storage")) {
      for (const method of ["getItem", "setItem", "removeItem", "clear"] as const) {
        Object.defineProperty(Storage.prototype, method, { configurable: true, value: blocked });
      }
    }
    if (blockedSurfaces.includes("cookies")) {
      Object.defineProperty(Document.prototype, "cookie", {
        configurable: true,
        get: blocked,
        set: blocked,
      });
    }
  }, what);
}

function collectErrors(page: Page): { pageErrors: string[]; consoleErrors: string[] } {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  return { pageErrors, consoleErrors };
}

async function readPersistenceMode(page: Page): Promise<unknown> {
  return page.evaluate(async () => {
    const sfere = (
      window as unknown as { __sfere: PromiseLike<[{ options: Record<string, unknown> }]> }
    ).__sfere;
    const [analytics] = await sfere;
    return analytics.options.disableClientPersistence;
  });
}

const cases: { title: string; block: Blocked[] }[] = [
  { title: "Web Storage and document.cookie are all blocked", block: ["storage", "cookies"] },
  { title: "only Web Storage is blocked (cookies work)", block: ["storage"] },
  { title: "only document.cookie is blocked (Web Storage works)", block: ["cookies"] },
];

test.beforeEach(async ({ request }) => {
  await resetMock(request);
});

for (const { title, block } of cases) {
  test(`SDK still sends valid events when ${title}`, async ({ page, request }) => {
    const { pageErrors, consoleErrors } = collectErrors(page);
    await blockBeforeLoad(page, block);

    await page.goto(esmUrl());
    await waitForEsmReady(page);
    expect(await readPersistenceMode(page)).toBe(true);

    await page.evaluate(() => {
      const sfere = (window as unknown as { __sfere: { track: (...args: unknown[]) => void } })
        .__sfere;
      sfere.track("blocked_storage_event", { n: 1 });
    });

    const events = await waitForEvents(request, (recorded) => ingestEvents(recorded).length >= 1);
    const ingested = ingestEvents(events);
    expect(ingested).toHaveLength(1);
    expect(ingested[0]?.path).toBe("/api/s/t");
    expect(ingested[0]?.keySource).toBe("basic");

    const body = asRecord(ingested[0]?.body);
    expect(body.event).toBe("blocked_storage_event");
    expect(typeof body.anonymousId).toBe("string");
    expect(String(body.anonymousId).length).toBeGreaterThan(0);
    expect(typeof body.messageId).toBe("string");
    const context = asRecord(body.context);
    expect(asRecord(context.session).id).toEqual(expect.any(Number));
    expect(asRecord(context.library).name).toBe("@sfere-io/sfere-sdk");
    // The environment fields the dependency's own plugin normally adds are still present.
    expect(typeof context.userAgent).toBe("string");
    expect(typeof context.locale).toBe("string");

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });
}

test("in-memory mode is off when nothing is blocked, and on when the caller forces it", async ({
  page,
}) => {
  await page.goto(esmUrl());
  await waitForEsmReady(page);
  expect(await readPersistenceMode(page)).toBe(false);

  await page.goto(esmUrl({ disableClientPersistence: "true" }));
  await waitForEsmReady(page);
  expect(await readPersistenceMode(page)).toBe(true);
});

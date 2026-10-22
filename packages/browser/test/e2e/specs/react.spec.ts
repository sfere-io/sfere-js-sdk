// React bindings end to end: a real React 19 app (test/e2e/react-app.tsx) built from dist/react.js,
// in the development build (StrictMode double-renders and double-runs effects) and the production
// build, sending to the mock ingestion host.
import { expect, test, type Page } from "@playwright/test";
import {
  SITE_ORIGIN,
  WRITE_KEY,
  asRecord,
  fetchEvents,
  ingestEvents,
  resetMock,
  waitForEvents,
  type RecordedRequest,
} from "../utils";

const bodies = (events: RecordedRequest[]): Record<string, unknown>[] =>
  ingestEvents(events).map((event) => asRecord(event.body));
const ofType = (events: RecordedRequest[], type: string): Record<string, unknown>[] =>
  bodies(events).filter((body) => body.type === type);

/** Fails the test on any uncaught error or console.error in the page (React warnings included). */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console.error: ${message.text()}`);
  });
  return errors;
}

async function waitForReact(page: Page): Promise<void> {
  await page.waitForFunction(() => (window as unknown as { __reactReady?: boolean }).__reactReady);
}

async function navigate(page: Page, path: string): Promise<void> {
  await page.evaluate((to) => {
    (window as unknown as { __navigate: (p: string) => void }).__navigate(to);
  }, path);
  await expect(page.locator("#route")).toHaveText(path);
}

test.beforeEach(async ({ request }) => {
  await resetMock(request);
});

for (const mode of ["dev", "prod"] as const) {
  test.describe(`React bindings (${mode === "dev" ? "development, StrictMode" : "production"} build)`, () => {
    test("one page view per route, React-tagged events, one SDK instance", async ({ page, request }) => {
      const errors = watchErrors(page);
      await page.goto(`${SITE_ORIGIN}/react.html?mode=${mode}&gclid=E2E_GCLID`);
      await waitForReact(page);

      await waitForEvents(request, (recorded) => ofType(recorded, "page").length >= 1);

      await page.click("#login");
      await page.click("#consent");
      await page.click("#add");
      await navigate(page, "/shop/b");
      await waitForEvents(
        request,
        (recorded) => ofType(recorded, "page").length >= 2 && ofType(recorded, "track").length >= 1,
      );
      // Unchanged route, re-render only: must not send another page view.
      await page.click("#add");
      await waitForEvents(request, (recorded) => ofType(recorded, "track").length >= 2);
      // Leave time for any duplicate (StrictMode double effect, second provider load) to land.
      await page.waitForTimeout(750);
      const events = await fetchEvents(request);

      // Exactly one page view per distinct route, in order.
      const pages = ofType(events, "page");
      expect(pages.map((body) => asRecord(asRecord(body.context).page).path)).toEqual([
        "/react.html",
        "/shop/b",
      ]);

      // Every request authenticated with the configured key, to the ingestion host only.
      const accepted = ingestEvents(events);
      expect(events.filter((event) => event.unexpected)).toEqual([]);
      expect(accepted.every((event) => event.keySource === "basic" && event.writeKey === WRITE_KEY)).toBe(true);

      const all = bodies(events);
      // One instance: a second load would mint a second queue and, on first visit, its own id.
      expect(new Set(all.map((body) => body.anonymousId)).size).toBe(1);
      for (const body of all) {
        expect(body).not.toHaveProperty("_metadata");
        expect(body).not.toHaveProperty("integrations");
        const context = asRecord(body.context);
        expect(asRecord(context.library)).toMatchObject({ name: "@sfere.io/sfere-sdk", binding: "react" });
        // Landing click ID persists across the client-side navigation.
        expect(asRecord(context.clientIds).gclid).toBe("E2E_GCLID");
        expect(typeof asRecord(context.session).id).toBe("number");
      }

      // The track after identify + setConsent carries traits, consent and the dedup id.
      const [track] = ofType(events, "track");
      const context = asRecord(track?.context);
      expect(track?.event).toBe("add_to_cart");
      expect(track?.userId).toBe("user_e2e");
      expect(asRecord(context.traits).email).toBe("fan@example.com");
      expect(context.consent).toEqual({ categoryPreferences: { advertising: true, analytics: false } });
      expect(asRecord(track?.properties).sfere_dedup_id).toBe(track?.messageId);
      expect(asRecord(track?.properties).items).toEqual([
        { item_id: "sku_123", item_name: "Jersey", price: 89.99, quantity: 1 },
      ]);

      expect(errors).toEqual([]);
    });
  });
}

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SfereAnalytics, requestContext, version } from "../../src/index";
import { events, mockIngest, type MockIngest } from "./helpers";

const KEY = "keyId:secret";
let mock: MockIngest;

beforeEach(async () => {
  mock = await mockIngest();
});
afterEach(async () => {
  await mock.close();
});

const client = (extra: Partial<ConstructorParameters<typeof SfereAnalytics>[0]> = {}) =>
  new SfereAnalytics({ writeKey: KEY, host: mock.origin, flushInterval: 20, ...extra });

describe("SfereAnalytics", () => {
  it("posts to {host}/v1/batch with Basic auth, the key in the body and a Sfere User-Agent", async () => {
    const sfere = client();
    sfere.track({ userId: "u1", event: "purchase", properties: { value: 1 } });
    await sfere.closeAndFlush();

    expect(mock.received).toHaveLength(1);
    const [request] = mock.received;
    expect(request!.path).toBe("/v1/batch");
    expect(request!.headers.authorization).toBe(
      `Basic ${Buffer.from(`${KEY}:`).toString("base64")}`,
    );
    expect(request!.body.writeKey).toBe(KEY);
    expect(request!.headers["user-agent"]).toBe(`@fanfinity/sfere-node/${version}`);
  });

  it("sends the wire shape: Sfere library, no _metadata, no empty integrations, dedup id", async () => {
    const sfere = client();
    // Called synchronously after construction: the dedup plugin must already apply.
    sfere.track({ userId: "u1", event: "purchase", properties: { value: 1 } });
    sfere.track({ userId: "u1", event: "refund", properties: { sfere_dedup_id: "order-9" } });
    sfere.identify({ userId: "u1", traits: { email: "fan@example.com" } });
    await sfere.closeAndFlush();

    const sent = events(mock);
    expect(sent.map((e) => e.type)).toEqual(["track", "track", "identify"]);
    for (const event of sent) {
      expect(event).not.toHaveProperty("_metadata");
      expect(event).not.toHaveProperty("integrations");
      expect((event.context as Record<string, unknown>).library).toEqual({
        name: "@fanfinity/sfere-node",
        version,
        base: expect.stringMatching(/^analytics-node@\d+\.\d+\.\d+$/),
      });
    }
    const [purchase, refund, identify] = sent as Record<string, Record<string, unknown>>[];
    expect(purchase!.properties!.sfere_dedup_id).toBe(purchase!.messageId);
    expect(refund!.properties!.sfere_dedup_id).toBe("order-9");
    expect(identify).not.toHaveProperty("properties.sfere_dedup_id");
  });

  it("keeps call order across event types, right after construction", async () => {
    const sfere = client();
    sfere.identify({ userId: "u1" });
    sfere.track({ userId: "u1", event: "a" });
    sfere.page({ userId: "u1", name: "Home" });
    sfere.group({ userId: "u1", groupId: "g1" });
    sfere.screen({ userId: "u1", name: "S" });
    sfere.alias({ userId: "u1", previousId: "a1" });
    sfere.track({ userId: "u1", event: "b" });
    await sfere.closeAndFlush();
    expect(events(mock).map((e) => e.type)).toEqual([
      "identify",
      "track",
      "page",
      "group",
      "screen",
      "alias",
      "track",
    ]);
  });

  it("keeps integrations the caller set", async () => {
    const sfere = client();
    sfere.track({ userId: "u1", event: "x", integrations: { Meta: false } });
    await sfere.closeAndFlush();
    expect(events(mock)[0]!.integrations).toEqual({ Meta: false });
  });

  it("forwards requestContext() fields untouched", async () => {
    const sfere = client();
    const context = requestContext({
      headers: {
        "x-forwarded-for": "203.0.113.7, 10.0.0.1",
        "x-forwarded-proto": "https",
        "user-agent": "Mozilla/5.0 test",
        cookie: "_fbp=fb.1.1.123; _ttp=ttp-1",
        host: "shop.example.com",
      },
      url: "/checkout?gclid=G1",
    });
    sfere.track({ anonymousId: "a1", event: "begin_checkout", context });
    await sfere.closeAndFlush();

    const ctx = events(mock)[0]!.context as Record<string, unknown>;
    expect(ctx.ip).toBe("203.0.113.7");
    expect(ctx.userAgent).toBe("Mozilla/5.0 test");
    expect(ctx.clientIds).toEqual({ fbp: "fb.1.1.123", ttp: "ttp-1", gclid: "G1" });
    expect(ctx.page).toMatchObject({ url: "https://shop.example.com/checkout?gclid=G1" });
  });

  it("batches by flushAt", async () => {
    const sfere = client({ flushAt: 2, flushInterval: 10_000 });
    for (let i = 0; i < 4; i++) sfere.track({ userId: "u1", event: `e${i}` });
    await sfere.closeAndFlush();
    expect(mock.received.map((r) => r.body.batch.length)).toEqual([2, 2]);
  });

  it("retries 5xx and 429, then delivers", async () => {
    mock.respond.push(503, 429);
    const sfere = client({ maxRetries: 3 });
    sfere.track({ userId: "u1", event: "retry_me" });
    await sfere.closeAndFlush();
    expect(mock.received).toHaveLength(3);
    expect(mock.received[2]!.headers["x-retry-count"]).toBe("2");
  });

  it("does not retry a 401 (bad key) and reports it", async () => {
    mock.respond.push(401);
    const sfere = client({ maxRetries: 3 });
    const errors: unknown[] = [];
    sfere.on("error", (error) => errors.push(error));
    sfere.track({ userId: "u1", event: "rejected" });
    await sfere.closeAndFlush();
    expect(mock.received).toHaveLength(1);
    expect(errors).toHaveLength(1);
  });

  it("sends nothing when disabled", async () => {
    const sfere = client({ disable: true });
    sfere.track({ userId: "u1", event: "x" });
    await sfere.closeAndFlush();
    expect(mock.received).toHaveLength(0);
  });

  it("validates writeKey and host", () => {
    expect(() => new SfereAnalytics({ writeKey: "", host: mock.origin })).toThrow(/writeKey/);
    expect(() => new SfereAnalytics({ writeKey: KEY, host: "ingest.example.com" })).toThrow(
      /http\(s\) origin/,
    );
    expect(() => new SfereAnalytics({ writeKey: KEY, host: `${mock.origin}/v1/batch` })).toThrow(
      /without a path/,
    );
  });
});

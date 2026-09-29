import { describe, expect, it } from "vitest";
import { requestContext } from "../../src/context";
import { rewriteBody, toWire } from "../../src/http-client";

const now = () => 1_727_500_000_000;

describe("requestContext: Node IncomingMessage shape", () => {
  it("takes the left-most X-Forwarded-For, the user agent, language, page and referrer", () => {
    const ctx = requestContext(
      {
        headers: {
          "x-forwarded-for": "203.0.113.7, 10.0.0.2",
          "x-forwarded-proto": "https",
          host: "shop.example.com",
          "user-agent": "UA/1",
          "accept-language": "ar-SA,ar;q=0.9,en;q=0.8",
          referer: "https://www.google.com/",
        },
        url: "/p/jersey?utm_source=google&utm_medium=cpc&utm_campaign=spring&gad_source=1",
        socket: { remoteAddress: "10.0.0.2" },
      },
      { now },
    );
    expect(ctx).toEqual({
      ip: "203.0.113.7",
      userAgent: "UA/1",
      locale: "ar-SA",
      page: {
        url: "https://shop.example.com/p/jersey?utm_source=google&utm_medium=cpc&utm_campaign=spring&gad_source=1",
        path: "/p/jersey",
        search: "?utm_source=google&utm_medium=cpc&utm_campaign=spring&gad_source=1",
        referrer: "https://www.google.com/",
      },
      campaign: { source: "google", medium: "cpc", name: "spring", gad_source: "1" },
    });
  });

  it("falls back to X-Real-IP, then Express req.ip, then the socket; strips ::ffff:", () => {
    expect(requestContext({ headers: { "x-real-ip": "198.51.100.1" } }).ip).toBe("198.51.100.1");
    expect(requestContext({ headers: {}, ip: "::ffff:198.51.100.2" }).ip).toBe("198.51.100.2");
    expect(requestContext({ headers: {}, socket: { remoteAddress: "2001:db8::1" } }).ip).toBe(
      "2001:db8::1",
    );
  });

  it("trustProxy: false ignores forwarding headers and req.ip", () => {
    const ctx = requestContext(
      {
        headers: {
          "x-forwarded-for": "6.6.6.6",
          "x-forwarded-host": "evil.test",
          host: "shop.example.com",
        },
        ip: "7.7.7.7",
        url: "/",
        socket: { remoteAddress: "198.51.100.9", encrypted: true },
      },
      { trustProxy: false },
    );
    expect(ctx.ip).toBe("198.51.100.9");
    expect(ctx.page?.url).toBe("https://shop.example.com/");
  });

  it("reads click IDs from cookies (decoded) and the landing URL; fbclid builds fbc", () => {
    const ctx = requestContext(
      {
        headers: {
          host: "shop.example.com",
          cookie:
            "_fbp=fb.1.1700000000000.111; _gcl_aw=GCL.1700000000.CjwK.x; _clck=1wokzhv%5E2%5Eg9u; " +
            '_uetmsclkid="_uetabc"; unrelated=1',
        },
        url: "/?ttclid=T1&ScCid=S1&fbclid=FB1",
      },
      { now },
    );
    expect(ctx.clientIds).toEqual({
      fbp: "fb.1.1700000000000.111",
      gclid: "CjwK.x",
      clarity_uid: "1wokzhv",
      msclkid: "_uetabc",
      ttclid: "T1",
      scclid: "S1",
      fbc: `fb.1.${now()}.FB1`,
    });
  });

  it("keeps an _fbc cookie that already records the landing fbclid", () => {
    const ctx = requestContext(
      { headers: { host: "a.test", cookie: "_fbc=fb.1.1600000000000.FB1" }, url: "/?fbclid=FB1" },
      { now },
    );
    expect(ctx.clientIds?.fbc).toBe("fb.1.1600000000000.FB1");
  });

  it("pageUrl overrides the request URL; with neither, landing params come from the referrer", () => {
    const api = {
      headers: { host: "api.test", referer: "https://shop.test/l?gclid=R1" },
      url: "/api/order",
    };
    expect(requestContext(api, { pageUrl: "https://shop.test/thanks?gclid=P1" }).clientIds).toEqual(
      {
        gclid: "P1",
      },
    );
    expect(requestContext(api).clientIds).toEqual({ gclid: "R1" });
  });

  it("returns an empty object for a bare request", () => {
    expect(requestContext({ headers: {} })).toEqual({});
  });

  it("joins repeated headers and survives a malformed Host", () => {
    const ctx = requestContext({
      headers: { "x-forwarded-for": ["203.0.113.8", "10.0.0.1"], host: "bad host" },
      url: "/",
    });
    expect(ctx.ip).toBe("203.0.113.8");
    expect(ctx.page).toBeUndefined();
  });

  it("keeps raw cookie values that are not valid percent-encoding", () => {
    const ctx = requestContext({ headers: { cookie: "_ttp=100%zz" } });
    expect(ctx.clientIds).toEqual({ ttp: "100%zz" });
  });
});

describe("requestContext: Fetch API Request", () => {
  it("reads a Request (Next.js route handler, Hono, Workers)", () => {
    const req = new Request("https://shop.example.com/api/checkout?msclkid=M1", {
      headers: {
        "x-forwarded-for": "203.0.113.9",
        "user-agent": "UA/2",
        cookie: "_ttp=ttp-2",
      },
    });
    expect(requestContext(req)).toEqual({
      ip: "203.0.113.9",
      userAgent: "UA/2",
      page: {
        url: "https://shop.example.com/api/checkout?msclkid=M1",
        path: "/api/checkout",
        search: "?msclkid=M1",
      },
      clientIds: { ttp: "ttp-2", msclkid: "M1" },
    });
  });
});

describe("wire shaping", () => {
  it("toWire strips _metadata and empty integrations and stamps the library", () => {
    const out = toWire({
      type: "track",
      _metadata: { nodeVersion: "v22" },
      integrations: {},
      context: { library: { name: "@segment/analytics-node", version: "3" }, ip: "1.2.3.4" },
    });
    expect(out).not.toHaveProperty("_metadata");
    expect(out).not.toHaveProperty("integrations");
    expect(out.context).toMatchObject({
      ip: "1.2.3.4",
      library: { name: "@fanfinity/sfere-node" },
    });
  });

  it("rewriteBody leaves non-batch or non-JSON bodies alone", () => {
    expect(rewriteBody("not json")).toBe("not json");
    expect(rewriteBody('{"hello":1}')).toBe('{"hello":1}');
    expect(rewriteBody("null")).toBe("null");
  });
});

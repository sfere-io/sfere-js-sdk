import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BASE_ENVIRONMENT_PLUGIN,
  sfereEnvironment,
  utmCampaign,
} from "../../src/plugins/environment";
import { clearBrowserState, fakeCtx } from "./helpers";

beforeEach(clearBrowserState);

describe("utmCampaign", () => {
  it("maps utm_* the way the base library does", () => {
    expect(
      utmCampaign("?utm_source=google&utm_medium=cpc&utm_campaign=spring&utm_=x&gclid=1"),
    ).toEqual({ source: "google", medium: "cpc", name: "spring" });
    expect(utmCampaign("")).toEqual({});
  });
});

describe("sfereEnvironment plugin", () => {
  it("is a before plugin that deregisters the base environment plugin on load", async () => {
    const plugin = sfereEnvironment();
    expect(plugin.type).toBe("before");
    expect(plugin.isLoaded()).toBe(true);
    const deregister = vi.fn(async () => undefined);
    await plugin.load(fakeCtx(), { deregister } as never);
    expect(deregister).toHaveBeenCalledWith(BASE_ENVIRONMENT_PLUGIN);
  });

  it("adds userAgent, locale, timezone and a UTM campaign without touching cookies", () => {
    const cookie = vi.spyOn(document, "cookie", "get");
    const plugin = sfereEnvironment();
    const ctx = fakeCtx({ context: { page: { search: "?utm_source=x&utm_campaign=c" } } });
    plugin.track!(ctx);
    const context = ctx.event.context as Record<string, unknown>;
    expect(context.userAgent).toEqual(expect.any(String));
    expect(context.locale).toEqual(expect.any(String));
    expect(context.timezone).toEqual(expect.any(String));
    expect(context.campaign).toEqual({ source: "x", name: "c" });
    expect(cookie).not.toHaveBeenCalled();
  });

  it("keeps a caller's locale and campaign, and adds no campaign without utm params", () => {
    const plugin = sfereEnvironment();
    const kept = fakeCtx({
      context: { locale: "ar-SA", campaign: { name: "mine" }, page: { search: "?utm_source=x" } },
    });
    plugin.page!(kept);
    expect(kept.event.context).toMatchObject({ locale: "ar-SA", campaign: { name: "mine" } });

    const bare = fakeCtx({ context: undefined });
    plugin.identify!(bare);
    expect(bare.event.context).not.toHaveProperty("campaign");
    for (const method of ["group", "alias", "screen"] as const) {
      expect(typeof plugin[method]).toBe("function");
    }
  });
});

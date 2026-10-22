import { act, cleanup, render, renderHook } from "@testing-library/react";
import { createElement, StrictMode, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SfereAnalytics } from "../../src/index";
import { SfereProvider, usePageTracking, useSfere } from "../../src/react";
import { captureFetch, clearBrowserState, uniqueKey } from "./helpers";

const HOST = "https://ingest.example.com";

const flush = async (): Promise<void> => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 50));
  });
};

describe("react bindings", () => {
  beforeEach(() => clearBrowserState());
  afterEach(() => cleanup());

  it("loads once per write key, even under StrictMode and re-renders", () => {
    const load = vi.spyOn(SfereAnalytics, "load");
    const writeKey = uniqueKey();
    const tree = (): ReactNode =>
      createElement(StrictMode, null, createElement(SfereProvider, { writeKey, host: HOST }));
    const { rerender } = render(tree());
    rerender(tree());
    render(tree());
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("useSfere returns the provider's instance and sends through it", async () => {
    const requests = captureFetch();
    const writeKey = uniqueKey();
    const wrapper = ({ children }: { children: ReactNode }): ReactNode =>
      createElement(SfereProvider, { writeKey, host: HOST }, children);
    const { result } = renderHook(() => useSfere(), { wrapper });
    await act(async () => {
      await result.current.track("view_item", { value: 1 });
    });
    expect(requests.map((r) => r.url)).toContain(`${HOST}/api/s/t`);
    const body = requests.find((r) => r.url.endsWith("/t"))?.body;
    expect(body?.event).toBe("view_item");
    // Sfere's library fields stay; the React binding is added beside them.
    expect((body?.context as { library: Record<string, unknown> }).library).toMatchObject({
      name: "@sfere.io/sfere-sdk",
      binding: "react",
    });
  });

  it("warns once when a provider with the same key brings different options", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const writeKey = uniqueKey();
    render(createElement(SfereProvider, { writeKey, host: HOST, sessionTimeoutMinutes: 30 }));
    render(createElement(SfereProvider, { writeKey, host: HOST, sessionTimeoutMinutes: 30 }));
    expect(warn).not.toHaveBeenCalled();
    render(createElement(SfereProvider, { writeKey, host: HOST, sessionTimeoutMinutes: 5 }));
    render(createElement(SfereProvider, { writeKey, host: HOST, sessionTimeoutMinutes: 5 }));
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("useSfere outside a provider throws a clear error", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderHook(() => useSfere())).toThrow(/inside <SfereProvider>/);
  });

  it("disabled renders children and hands out a no-op instance", async () => {
    const requests = captureFetch();
    const load = vi.spyOn(SfereAnalytics, "load");
    const wrapper = ({ children }: { children: ReactNode }): ReactNode =>
      createElement(SfereProvider, { writeKey: uniqueKey(), host: HOST, disabled: true }, children);
    const { result } = renderHook(() => useSfere(), { wrapper });
    await expect(result.current.track("x")).resolves.toBeUndefined();
    expect(() => result.current.setConsent({ analytics: true })).not.toThrow();
    expect((result.current as unknown as { then?: unknown }).then).toBeUndefined();
    await expect(result.current.page()).resolves.toBeUndefined();
    expect(() => String(result.current)).not.toThrow();
    expect((result.current as unknown as Record<string, unknown>).instance).toBeUndefined();
    await flush();
    expect(load).not.toHaveBeenCalled();
    expect(requests).toHaveLength(0);
  });

  it("usePageTracking sends one page per distinct route key, StrictMode included", async () => {
    const requests = captureFetch();
    const writeKey = uniqueKey();
    const Page = ({ route }: { route: string }): null => {
      usePageTracking(route, { properties: { route } });
      return null;
    };
    const tree = (route: string): ReactNode =>
      createElement(
        StrictMode,
        null,
        createElement(SfereProvider, { writeKey, host: HOST }, createElement(Page, { route })),
      );
    const { rerender } = render(tree("/a"));
    await flush();
    rerender(tree("/a"));
    rerender(tree("/b"));
    await flush();
    const pages = requests.filter((r) => r.url.endsWith("/api/s/p"));
    expect(pages.map((p) => (p.body.properties as { route: string }).route)).toEqual(["/a", "/b"]);
  });

  it("usePageTracking skipInitial skips only the first route, and passes a name", async () => {
    const requests = captureFetch();
    const writeKey = uniqueKey();
    const Page = ({ route }: { route: string }): null => {
      usePageTracking(route, { skipInitial: true, name: "Screen" });
      return null;
    };
    const tree = (route: string): ReactNode =>
      createElement(SfereProvider, { writeKey, host: HOST }, createElement(Page, { route }));
    const { rerender } = render(tree("/a"));
    await flush();
    rerender(tree("/b"));
    await flush();
    const pages = requests.filter((r) => r.url.endsWith("/api/s/p"));
    expect(pages).toHaveLength(1);
    expect(pages[0]?.body.name).toBe("Screen");
  });
});

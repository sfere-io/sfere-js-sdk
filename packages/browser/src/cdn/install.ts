import { SfereAnalytics, sfereEnrichment, version, type SfereLoadOptions } from "../index";

type QueuedCall = [string, ...unknown[]];

export interface SfereGlobal {
  load: typeof SfereAnalytics.load;
  sfereEnrichment: typeof sfereEnrichment;
  version: string;
}

type SfereWindow = Window & { SfereSDK?: SfereGlobal; sfere?: unknown };

function originOf(src: string | null | undefined): string | undefined {
  try {
    return src ? new URL(src).origin : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Installs `window.SfereSDK` and, when the executing `<script>` carries `data-write-key` and
 * `data-host`, loads the SDK into `window.sfere`, replaying calls queued on the loader stub.
 */
export function install(win: SfereWindow, script: HTMLOrSVGScriptElement | null): SfereGlobal {
  const scriptEl = script instanceof HTMLScriptElement ? script : null;
  // Lazy chunks (if any) resolve against the CDN origin that served this bundle.
  const bundleOrigin = originOf(scriptEl?.src);

  const sdk: SfereGlobal = {
    load: (options: SfereLoadOptions) =>
      SfereAnalytics.load({ ...options, cdnURL: options.cdnURL ?? bundleOrigin }),
    sfereEnrichment,
    version,
  };
  win.SfereSDK = sdk;

  const writeKey = scriptEl?.getAttribute("data-write-key");
  const host = scriptEl?.getAttribute("data-host");
  const existing = win.sfere;
  // Only a loader stub (an array) or nothing may be replaced; never a loaded instance.
  if (!writeKey || !host || (existing !== undefined && !Array.isArray(existing))) return sdk;

  const instance = sdk.load({
    writeKey,
    host,
    batching: scriptEl?.getAttribute("data-batching") === "true",
  });
  win.sfere = instance;

  const queued = Array.isArray(existing) ? (existing as QueuedCall[]) : [];
  const methods = instance as unknown as Record<string, unknown>;
  const invoke = (method: string, args: unknown[]): unknown => {
    const fn = methods[method];
    return typeof fn === "function"
      ? (fn as (...a: unknown[]) => unknown).apply(instance, args)
      : undefined;
  };
  for (const call of queued) {
    if (!Array.isArray(call)) continue;
    const [method, ...args] = call;
    invoke(method, args);
  }
  // A page may keep a reference to the stub (`var s = window.sfere`) from before the bundle
  // arrived. Its queueing methods would push into a list nobody drains any more, so re-point
  // them at the live instance.
  if (Array.isArray(existing)) {
    const stub = existing as unknown as Record<string, unknown>;
    for (const method of Object.keys(stub)) {
      if (typeof stub[method] === "function" && typeof methods[method] === "function") {
        stub[method] = (...args: unknown[]) => invoke(method, args);
      }
    }
  }
  return sdk;
}

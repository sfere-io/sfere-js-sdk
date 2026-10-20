// "use client" is prepended by the build (tsup banner): esbuild drops module-level directives.
import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useRef,
  type ReactElement,
  type ReactNode,
} from "react";
// The package's own name, not "./index": the build keeps it external, so an app that imports both
// "@sfere-io/sfere-sdk" and "@sfere-io/sfere-sdk/react" shares one SDK module and one instance.
import {
  SfereAnalytics,
  type SfereAnalyticsInstance,
  type SfereLoadOptions,
} from "@sfere-io/sfere-sdk";

export type { SfereAnalyticsInstance, SfereLoadOptions };

export interface SfereProviderProps extends SfereLoadOptions {
  /** Render children without loading the SDK; `useSfere()` returns a no-op instance. */
  disabled?: boolean;
  children?: ReactNode;
}

const SfereContext = createContext<SfereAnalyticsInstance | null>(null);

/**
 * One instance per write key + host for the life of the page. React may render a provider more
 * than once (StrictMode, remounts, HMR, a concurrent render it later discards), and a second
 * `load()` would start a second queue, so the first instance is reused.
 *
 * `load()` runs during render, not in an effect: children's effects (a `track()` in a child's
 * `useEffect`, `usePageTracking`) run before the provider's own, so the instance must exist first.
 * A discarded render therefore may load, but the cache makes that the one load the next render
 * reuses. Options other than `writeKey` and `host` are read once; a later provider with the same
 * key but different options gets the first instance, with a console warning.
 */
const instances = new Map<string, { instance: SfereAnalyticsInstance; options: string }>();

/** The instance methods, as no-ops. Anything else reads as `undefined`, so it is not thenable. */
const METHODS = [
  "track",
  "page",
  "screen",
  "identify",
  "group",
  "alias",
  "reset",
  "ready",
  "register",
  "deregister",
  "debug",
  "setAnonymousId",
  "addSourceMiddleware",
  "addDestinationMiddleware",
  "trackLink",
  "trackForm",
  "trackClick",
  "trackSubmit",
  "on",
  "once",
  "off",
] as const;

function noopInstance(): SfereAnalyticsInstance {
  const noop = (): Promise<undefined> => Promise.resolve(undefined);
  const instance: Record<string, unknown> = { setConsent: () => {} };
  for (const method of METHODS) instance[method] = noop;
  return instance as unknown as SfereAnalyticsInstance;
}

/** Tags React-originated events: `context.library.binding = "react"`, after Sfere's enrichment. */
const reactBinding = {
  name: "Sfere React",
  type: "enrichment" as const,
  version: "1",
  isLoaded: () => true,
  load: () => Promise.resolve(),
  ...Object.fromEntries(
    ["track", "page", "identify", "group", "alias", "screen"].map((type) => [
      type,
      (ctx: { event: { context?: Record<string, unknown> } }) => {
        const context = (ctx.event.context ??= {});
        context.library = { ...(context.library as object | undefined), binding: "react" };
        return ctx;
      },
    ]),
  ),
};

function instanceFor(props: SfereProviderProps): SfereAnalyticsInstance {
  if (props.disabled) return noopInstance();
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { disabled, children, ...options } = props;
  const key = `${options.writeKey}|${options.host}`;
  const serialized = JSON.stringify(options);
  const cached = instances.get(key);
  if (cached) {
    if (cached.options !== serialized) {
      // eslint-disable-next-line no-console
      console.warn(
        "Sfere SDK: <SfereProvider> options changed after the SDK loaded; the first options stay in effect.",
      );
      cached.options = serialized;
    }
    return cached.instance;
  }
  const instance = SfereAnalytics.load(options);
  // On the server `load()` returns an inert instance; nothing is cached there, so per-request
  // options are never kept alive.
  if (typeof window !== "undefined") {
    void instance.register(reactBinding as never);
    instances.set(key, { instance, options: serialized });
  }
  return instance;
}

/** Loads the SDK once and makes the instance available to `useSfere()` below it. */
export function SfereProvider(props: SfereProviderProps): ReactElement {
  const ref = useRef<{ key: string; instance: SfereAnalyticsInstance } | null>(null);
  const key = props.disabled ? "disabled" : `${props.writeKey}|${props.host}`;
  if (ref.current?.key !== key) ref.current = { key, instance: instanceFor(props) };
  return createElement(SfereContext.Provider, { value: ref.current.instance }, props.children);
}

/** The instance loaded by the nearest `<SfereProvider>`. */
export function useSfere(): SfereAnalyticsInstance {
  const instance = useContext(SfereContext);
  if (!instance) {
    throw new Error("Sfere SDK: useSfere() must be called inside <SfereProvider>.");
  }
  return instance;
}

export interface PageTrackingOptions {
  /** Do not send a page view for the first route (it is already sent elsewhere). */
  skipInitial?: boolean;
  /** Page name and properties passed to `page()`. */
  name?: string;
  properties?: Record<string, unknown>;
}

/**
 * Sends `page()` whenever `routeKey` changes. Pass what identifies a route in your router:
 * React Router `location.pathname + location.search`, Next.js App Router
 * `pathname + "?" + searchParams`, Pages Router `router.asPath`.
 *
 * A page view is sent once per distinct key, so StrictMode's double-run effects and re-renders
 * with an unchanged key do not send duplicates.
 */
export function usePageTracking(routeKey: unknown, options: PageTrackingOptions = {}): void {
  const sfere = useSfere();
  const last = useRef<{ key: unknown } | null>(null);
  const { skipInitial, name, properties } = options;
  useEffect(() => {
    const first = last.current === null;
    if (!first && Object.is(last.current?.key, routeKey)) return;
    last.current = { key: routeKey };
    if (first && skipInitial) return;
    void (name === undefined ? sfere.page(properties) : sfere.page(name, properties));
  }, [sfere, routeKey, skipInitial, name, properties]);
}

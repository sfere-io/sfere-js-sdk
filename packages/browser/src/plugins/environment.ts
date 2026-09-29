import type { Context, Plugin } from "@segment/analytics-next";
import { version } from "../version";

/** The name the base library registers its own environment ("before") plugin under. */
export const BASE_ENVIRONMENT_PLUGIN = "Page Enrichment";

/** Same mapping as the base library: `utm_campaign` becomes `name`, other `utm_*` lose the prefix. */
export function utmCampaign(search: string): Record<string, string> {
  const campaign: Record<string, string> = {};
  try {
    for (const [key, value] of new URLSearchParams(search)) {
      if (!key.startsWith("utm_") || key.length <= 4) continue;
      const name = key.slice(4);
      campaign[name === "campaign" ? "name" : name] = value;
    }
  } catch {
    // Unparseable query: no campaign.
  }
  return campaign;
}

/**
 * Cookie-free stand-in for the base library's environment plugin, used only when `document.cookie`
 * throws. The original reads the `_ga` cookie without try/catch on every event; in a sandboxed
 * or hardened context that throw fails every event. This one carries the same core fields
 * (userAgent, locale, timezone, UTM campaign) and touches no storage; `context.library` is set
 * by the enrichment plugin. Its `load` deregisters the original before any event is processed
 * (plugins finish loading before the pre-load buffer is flushed).
 */
export function sfereEnvironment(): Plugin {
  function enrich(ctx: Context): Context {
    const context = (ctx.event.context ??= {}) as Record<string, unknown>;
    try {
      context.userAgent = navigator.userAgent;
      const locale = navigator.language;
      if (context.locale === undefined && locale) context.locale = locale;
    } catch {
      // No navigator: nothing to add.
    }
    const page = context.page as { search?: unknown } | undefined;
    const search = typeof page?.search === "string" ? page.search : "";
    if (search && !context.campaign) {
      const campaign = utmCampaign(search);
      if (Object.keys(campaign).length > 0) context.campaign = campaign;
    }
    try {
      context.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      // Unsupported: leave timezone undefined, as the base library does.
    }
    return ctx;
  }

  return {
    name: "Sfere Environment",
    type: "before",
    version,
    isLoaded: () => true,
    load: async (_ctx, instance) => {
      await instance.deregister(BASE_ENVIRONMENT_PLUGIN);
    },
    track: enrich,
    page: enrich,
    identify: enrich,
    group: enrich,
    alias: enrich,
    screen: enrich,
  };
}

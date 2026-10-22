declare const __SFERE_VERSION__: string | undefined;
declare const __SFERE_BASE_VERSION__: string | undefined;

/** Package name, reported in `context.library.name`. */
export const libraryName = "@sfere.io/sfere-sdk";

/** Package version, injected at build time by tsup (`define`). */
export const version: string =
  typeof __SFERE_VERSION__ === "string" ? __SFERE_VERSION__ : "0.0.0-dev";

/**
 * The analytics library this SDK wraps, as `name@version`, injected at build time from its
 * package.json. Reported in `context.library.base` so the warehouse can tell the two apart.
 */
export const baseLibrary: string = `analytics-next@${
  typeof __SFERE_BASE_VERSION__ === "string" ? __SFERE_BASE_VERSION__ : "unknown"
}`;

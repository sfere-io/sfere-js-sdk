declare const __SFERE_VERSION__: string | undefined;
declare const __SFERE_BASE_VERSION__: string | undefined;

/** Package name, reported in `context.library.name`. */
export const libraryName = "@fanfinity/sfere-node";

/** Package version, injected at build time by tsup (`define`). */
export const version: string =
  typeof __SFERE_VERSION__ === "string" ? __SFERE_VERSION__ : "0.0.0-dev";

/** The library this SDK wraps, as `name@version`, reported in `context.library.base`. */
export const baseLibrary: string = `analytics-node@${
  typeof __SFERE_BASE_VERSION__ === "string" ? __SFERE_BASE_VERSION__ : "unknown"
}`;

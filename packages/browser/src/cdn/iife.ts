// Entry for the script-tag bundle (dist/cdn/sfere.js, dist/cdn/sfere.min.js).
import { install } from "./install";

if (typeof window !== "undefined" && typeof document !== "undefined") {
  install(
    window,
    document.currentScript ?? document.querySelector("script[data-write-key][data-host]"),
  );
}

// Entry for the CDN script (dist/cdn/sfere-salla.min.js), loaded by the Salla App Snippet.
import { install } from "./index";

function loadingScript(): HTMLScriptElement | null {
  const current = document.currentScript;
  if (current instanceof HTMLScriptElement) return current;
  return document.querySelector<HTMLScriptElement>('script[src*="/sfere-salla"]');
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  try {
    install(window, loadingScript());
  } catch {
    // never throw into the storefront
  }
}

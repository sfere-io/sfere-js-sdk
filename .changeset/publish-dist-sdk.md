---
"@fanfinity/sfere-sdk": patch
---

The npm package now contains its build. Every npm release up to 0.3.1 was published without `dist/` (the release job never built it), so `import "@fanfinity/sfere-sdk"` failed to resolve. The CDN bundles were never affected. No code changes.

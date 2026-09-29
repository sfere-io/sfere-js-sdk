---
"@fanfinity/sfere-sdk": minor
---

React bindings at `@fanfinity/sfere-sdk/react`: `SfereProvider` (loads once per write key and host, StrictMode-safe), `useSfere()` and `usePageTracking(routeKey)`. React 17–19 is an optional peer dependency. Events sent through the provider carry `context.library.binding: "react"`. The main entry and the CDN bundle are unchanged.

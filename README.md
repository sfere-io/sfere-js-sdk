# Sfere SDKs

Collect first-party fan events and send them to Sfere, from the browser and from your servers. Every SDK sends the same payload ([wire contract](docs/WIRE-CONTRACT.md)) and the same event vocabulary ([events](docs/EVENTS.md)).

| Package | Where it runs | Docs |
|---|---|---|
| [`@sfere-io/sfere-sdk`](packages/browser) | Web pages: script tag (CDN) or npm, with React / Next.js bindings at `@sfere-io/sfere-sdk/react` | [README](packages/browser/README.md) · [integration guide](docs/INTEGRATION.md) |
| [`@sfere-io/sfere-node`](packages/node) | Node.js 20+ servers: purchases, refunds and other backend events, with the customer's IP, user agent and click IDs | [README](packages/node/README.md) |
| HTTP API | Any language, no SDK | [HTTP-API.md](docs/HTTP-API.md) |

`packages/shared` is internal: the identifier maps both SDKs apply. It is bundled into each SDK at build time and never published.

## Repository

This is an npm workspace. From the root:

```bash
npm ci
npm run typecheck && npm run lint && npm run format:check
npm run test:coverage
npm run build && npm run size && npm run verify
npm run test:e2e        # browser Playwright suite + Node packed-tarball apps
```

Releases use Changesets: add one with `npx changeset` on your branch. See [RELEASING.md](docs/RELEASING.md) and [CI.md](docs/CI.md). The architecture, including why the React bindings are a subpath and the Node SDK is a package, is in [ARCHITECTURE.md](docs/ARCHITECTURE.md).

- [Contributing](CONTRIBUTING.md)
- [Security](SECURITY.md)

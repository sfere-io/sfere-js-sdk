# Contributing

## Branch naming

Use one of these prefixes:

- `feat/` — New feature or capability
- `fix/` — Bug fix
- `test/` — Test coverage or test infrastructure
- `docs/` — Documentation updates
- `refactor/` — Code cleanup, no behavior change
- `chore/` — Dependencies, build config, CI

**Example:** `feat/session-rotation`, `fix/consent-context-merge`, `docs/cdn-policy`

## Commits

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
type(scope): subject

Optional longer description.
```

**Types:** `feat`, `fix`, `test`, `docs`, `refactor`, `chore`  
**Scope:** (optional) the module or area affected; e.g., `enrichment`, `storage`, `cdn`  
**Subject:** lowercase, imperative, no period

**Examples:**
```
feat(enrichment): add gad_source and gad_campaignid to campaign context
fix(storage): wrap session id read in try-catch for localStorage access
test(enrichment): verify fbclid conversion to fbc value
docs: update integration guide with React Router example
```

## Every user-facing change requires a changeset

Before opening a PR, run:

```bash
npm run changeset
```

Follow the prompts to select the affected packages, version bump (major/minor/patch), and write a human-readable summary of the change. **This is required for every user-facing change**, including:

- New APIs or options
- Breaking changes
- Bug fixes affecting behavior
- Documentation updates for developers

Changesets are not needed for:
- Internal refactoring with no observable change
- CI/build-tool changes
- Dependency updates with no impact on the published SDK

The changeset is committed alongside your code. The release pipeline will aggregate changesets and version the package.

## Pre-PR checklist

Run these checks locally before pushing:

```bash
npm run typecheck
npm run lint
npm run format:check
npm test
npm run test:coverage
npm run build
npm run size
npm run verify
npm run test:e2e
```

**What each does:**

| Script | Purpose |
|--------|---------|
| `typecheck` | TypeScript type checking (no emit) |
| `lint` | eslint: style and best-practice warnings |
| `format:check` | prettier: verify code formatting |
| `test` | Unit tests with vitest |
| `test:coverage` | Unit tests + coverage report (lcov.info, coverage-summary.json) |
| `build` | Compile source: dist/index.{js,cjs,d.ts} + dist/cdn/sfere.min.js |
| `size` | gzip budget check for dist/cdn/sfere.min.js |
| `verify` | Verify dist contents: exports resolve, IIFE defines SfereSDK, no external CDN hosts, license banner present |
| `test:e2e` | Playwright: headless Chromium against dist/ and mock ingestion server |

Fix any failures before opening a PR.

## Code style

### TypeScript

- **Strict mode enabled.** No `any` unless absolutely unavoidable; use `unknown` + type guard instead.
- **No hashing or phone formatting in the SDK.** These are server-side concerns. The SDK sends identifiers over HTTPS and relies on server-side destinations to hash and normalize.
- **Storage access must be wrapped in try/catch.** Cookies and localStorage can be blocked; the SDK must work gracefully when they are. Guard `window` and `document` references for SSR compatibility.

### Storage and browser APIs

- Always wrap cookie and `localStorage` reads/writes in try/catch:

```typescript
function getSessionId(): string {
  try {
    return localStorage.getItem("sfere_session") ?? generateId();
  } catch {
    return generateId();
  }
}
```

- Guard `window` and `document` for SSR:

```typescript
const lang = typeof window !== "undefined" && document.documentElement.lang ? document.documentElement.lang : undefined;
```

- Never assume a browser API is available. Test in Node.js contexts (SSR, serverless).

### Naming

- Don't name the ingestion vendor in code comments or strings. Use "ingestion endpoint" or "Sfere backend" instead.
- Keep variable names descriptive but concise: `fbp`, `gclid`, `messageId`, `sessionId`, not `fpData` or `adPlatformIdentifier`.

### Imports and exports

- Prefer ESM (`import`/`export`) in source; the build handles CJS and types.
- Export the public API from `src/index.ts`; internal modules are not exported.
- Use default exports sparingly; prefer named exports for clarity.

## Testing

- Unit tests live in `test/unit/`, mirroring src/ structure.
- E2E tests in `test/e2e/` use Playwright + a mock ingestion server.
- Line coverage of `src/` must stay at or above 90% (`vitest.config.ts` `coverage.thresholds`; `src/events.ts` is types only and excluded). `npm run test:coverage` fails below it, locally and in CI.

## Documentation

- User-facing changes need updates to `README.md`, `docs/INTEGRATION.md`, or `docs/EVENTS.md`.
- Code comments for complex logic, especially enrichment and storage access.
- JSDoc for exported functions and types.

## Opening a PR

1. Run the pre-PR checklist and fix any failures.
2. Commit your changes with conventional commits.
3. Run `npm run changeset` if the change is user-facing.
4. Push your branch and open a PR against `main`.
5. The CI will run tests, linting, coverage, and size checks.
6. A maintainer will review and merge once CI passes and changes are approved.

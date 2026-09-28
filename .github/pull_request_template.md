## What & why

<!-- What changed, and why. Link an issue/ticket if there is one. -->

## Checklist

- [ ] Changeset added (`npx changeset`) — required for any `src/` change;
      not needed for docs-only / CI-only changes. See `docs/RELEASING.md`.
- [ ] `npm run verify` and `npm run test:e2e` pass locally (or you've read
      why CI's `check`/`e2e` jobs will catch it).
- [ ] Docs updated if this changes the public API, the CDN policy, or the
      release process (`README.md`, `docs/INTEGRATION.md`, `docs/EVENTS.md`,
      `docs/CDN-POLICY.md`, `docs/RELEASING.md` as applicable).
- [ ] No vendor name for the ingestion platform introduced in anything
      client-facing (see root `CLAUDE.md`).

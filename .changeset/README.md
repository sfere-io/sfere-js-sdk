# Changesets

This directory manages versioning and changelogs for `@sfere-io/sfere-sdk`
with [Changesets](https://github.com/changesets/changesets). See
`../docs/RELEASING.md` for the full release flow; the short version:

1. On a branch with a user-facing change, run:

   ```sh
   npx changeset
   ```

   Pick a bump type (`patch` / `minor` / `major`) and write a one- or
   two-line summary — it becomes the changelog entry, verbatim.

2. Commit the generated `.changeset/*.md` file with the rest of the PR.
   There is no automated gate: the PR template's "changeset added?"
   checkbox is the reminder. A docs-only or CI-only change does not need
   one.

3. Once merged, the `release` workflow opens or updates a "Version
   Packages" PR (via `changesets/action`) that bumps `package.json` and
   compiles `CHANGELOG.md` from every pending changeset. Merging that PR
   is what actually publishes: to GitHub Packages, plus git tags,
   one GitHub release per framework (Browser, React, Node) and the CDN
   deploy. Nothing publishes from a normal PR
   merge.

The changelog generator is the built-in `@changesets/cli/changelog` (plain
entries, no network). `@changesets/changelog-github` was tried and dropped:
it makes `changeset version` fail whenever `GITHUB_TOKEN` is missing or the
changeset's commit is not yet on GitHub, which breaks every local run and
ties the release job to token scopes for the sake of PR links that the
GitHub release notes (`generate_release_notes: true`) already provide.

Single-package repo: `fixed` / `linked` are intentionally empty.

# Publish an occasional beta

Keep the release on the current `v0` beta line until a stable release is deliberate. Only Apple Silicon arm64 Mac packages are built.

1. Update `package.json` and `package-lock.json` to the next beta, for example `0.1.2-beta.1`.
2. Add `docs/releases/v<version>.md`, update `CHANGELOG.md` and README download links, and open a focused PR. Website download URLs derive from package metadata.
3. Pass unit, typecheck, build, offline Electron, website, and Mac packaging checks. Review the actual packaged Mac smoke evidence.
4. Merge into `master`, then create and push the matching tag, for example `git tag -a v0.1.2-beta.1 -m 'Vellum v0.1.2-beta.1'` and `git push origin v0.1.2-beta.1`.
5. The Mac workflow validates the tag against package metadata, builds arm64 DMG/ZIP files, checks native SQLite and signing, and runs the packaged reader/note restart smoke. It publishes a complete GitHub prerelease with SHA-256 checksums. Published assets are left unchanged on rerun; use a new version for updates.
6. Pages deploys after the trusted tag workflow succeeds and the downloads exist. Verify the public video players, both downloads, release notes, and checksums.

The build is ad-hoc signed, not Apple-notarized. Preserve that limitation in release notes. Users install updates manually; no automatic updater is shipped.

For a bad beta, mark its release notes with the known issue, direct users to the previous release, and ship a corrected new beta. Do not rewrite published tags or silently replace downloaded binaries. Existing research state belongs to the user and must not be deleted during rollback.

Workflow event behavior follows [GitHub's workflow_run documentation](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run). Prerelease publishing uses [GitHub CLI release options](https://cli.github.com/manual/gh_release_create).

# Beta runtime dependency update

The release audit found high-severity advisories in PDF.js and Zod, and known Electron advisories in the old 32.3.3 runtime. Electron is a development dependency in npm metadata but ships in the application, so `npm audit --omit=dev` alone did not cover the desktop runtime.

The beta pins Electron 45.3.3 and PDF.js 6.2.108, updates transitive Zod to 4.6.7, and uses electron-builder 26.18.0. Electron recommends shipping a current framework version because Chromium and Node security fixes ship with it. Sources: [Electron security guidance](https://www.electronjs.org/docs/latest/tutorial/security), [breaking changes](https://www.electronjs.org/docs/latest/breaking-changes), [PDF.js advisory](https://github.com/advisories/GHSA-hq66-cqwq-w95j), [Zod advisory](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5).

## Native storage compatibility

Rebuilding better-sqlite3 12.11.1 for Electron 45 failed with removed V8 methods, including `GetPrototypeV2` and `HolderV2`. This was a compile-time incompatibility, not a database failure. No production library was opened or migrated during the investigation.

better-sqlite3 13 uses N-API and includes platform prebuilds in its npm package. Version 13.2.0 preserves the default entrypoint's explicit `nativeBinding` option. Packaging now copies the pinned package's target prebuild directly, rather than relying on an Electron-specific rebuild output. Linux packages use the glibc prebuild; the Mac beta uses only `darwin-arm64.node`. The existing checked-in Linux development binding is replaced with that same pinned package's Linux prebuild. Sources: [N-API migration](https://github.com/WiseLibs/better-sqlite3/releases/tag/v13.0.0), [13.2.0 release](https://github.com/WiseLibs/better-sqlite3/releases/tag/v13.2.0).

The filesystem/SQLite split, data paths, schema migration history, and IPC remain unchanged. This dependency change introduces no schema migration. Independent review verified the tracked Linux binding matches the npm prebuild byte for byte. The arm64 packaged smoke must verify the native resource, reader, and saved notes after restart on GitHub-hosted macOS before merge or publication.

Rollback means returning to the prior source and dependency lockfile before publishing a tag. Do not downgrade an existing research database blindly: preserve a backup and verify compatibility first. Nothing in this release deletes or rewrites user data as a rollback mechanism.

## Remaining development advisories

After compatible dependency patches, the production dependency audit reports zero advisories and the full audit reports 13 entries in development toolchains. Vite/electron-vite, Vitest/tinypool, and builder's minimatch chain require separate migration work. Parent entries overlap transitive advisories. These tools are not production modules in the packaged app; React and the renderer bundle still receive their normal build-time dependencies. [Issue #226](https://github.com/dkritarth/Vellum/issues/226) records the remaining work. A clean production audit is not a complete security certification.

# Linux packaged runtime contracts (#89)

- Electron 32 exposes `app.isPackaged` to distinguish installed and source runs.
  `app.getPath('userData')` identifies app-specific writable state; `process.resourcesPath`
  identifies installed resources. Sources: [app](https://github.com/electron/electron/blob/v32.3.3/docs/api/app.md#appgetpathname),
  [process](https://github.com/electron/electron/blob/v32.3.3/docs/api/process.md#processresourcespath-readonly).
- electron-builder 25 `extraResources` copies files outside app.asar into Linux's
  `resources/`. Its default `npmRebuild: true` rebuilds native dependencies before
  packaging. Sources: installed `app-builder-lib/out/options/PlatformSpecificBuildOptions.d.ts`
  and `app-builder-lib/out/configuration.d.ts`; [configuration](https://www.electron.build/configuration.html).
- better-sqlite3 12.11.1 accepts an explicit `nativeBinding` path when bundling moves
  JavaScript. Its implementation requires that path directly, avoiding `bindings`
  module-root discovery. Sources: [API](https://github.com/WiseLibs/better-sqlite3/blob/v12.11.1/docs/api.md),
  [implementation](https://github.com/WiseLibs/better-sqlite3/blob/v12.11.1/lib/database.js).
- Rechecked 2026-10-23 against Electron 32.3.3, electron-builder 25.1.8 and
  `@electron/rebuild` 3.6.1. Rebuild's `alreadyBuiltByRebuild()` checks only
  `build/Release/.forge-meta`, whose contents encode architecture and Electron ABI.
  A later `npm rebuild better-sqlite3` replaces the binary for Node but leaves that
  marker intact. Builder can then skip rebuilding and package the wrong ABI.
  This sequence failed live with ABI 137 where Electron expected 128.
  `electron-rebuild --force --only better-sqlite3` bypasses the stale marker;
  `npm run dist` runs this supported command before builder copies the resource.
  The CLI is already supplied by the locked electron-builder dependency tree.
  Sources: [marker check](https://github.com/electron/rebuild/blob/v3.6.1/src/module-rebuilder.ts),
  [skip decision](https://github.com/electron/rebuild/blob/v3.6.1/src/rebuild.ts),
  [supported CLI flags](https://github.com/electron/rebuild/blob/v3.6.1/README.md#cli-arguments).

Empirical baseline, repeated 2026-10-23: electron-builder's unconfigured Linux directory package launched
from foreign cwd, preload ping returned pong, and SQLite listed an empty library.
No SQLite native failure reproduced. It created `cwd/data/app.db`, confirming data
placement defect. A later direct launch reproduced an unconfigured SUID sandbox
helper on this host; see `docs/verification/issue-89/README.md`. Explicit native
resource removes implicit fallback; it does not establish
support for other distros, architectures, macOS, or Windows.

Runtime paths are infrastructure, not a new research domain model. Existing paper,
note, and chat vocabulary remains unchanged. The paths module chooses writable data
and installed native resource together; IPC and storage retain their current contracts.

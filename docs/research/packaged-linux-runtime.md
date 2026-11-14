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

## Installation and sandbox follow-up, 2026-10-24

Pinned sources matter. Builder's git tag is `electron-builder@25.1.8`, not
`v25.1.8`. Current online docs describe newer releases and additional AppArmor
integration absent from this locked version.

- Electron 32 distinguishes renderer sandboxing from Chromium-wide sandbox
  startup. `--no-sandbox` disables Chromium sandboxing and is documented for testing
  only. Vellum already sets `sandbox: false` for its BrowserWindow, with
  `contextIsolation: true` and `nodeIntegration: false`. That renderer setting is
  unchanged here. A successful no-flag launch would establish default process
  startup, not certify a sandboxed renderer.
  Source: [Electron 32 sandbox guide](https://github.com/electron/electron/blob/v32.3.3/docs/tutorial/sandbox.md).
- A tar archive has no privileged installation hook. Extracting as an ordinary
  user cannot establish root ownership for the SUID helper. On this host,
  unprivileged user namespaces fail and Chromium rejects that extracted helper.
  Chromium documents the root-owned setuid helper as an alternative when Ubuntu
  restricts namespaces. Do not borrow another app's helper or disable system policy.
  Source: [Chromium AppArmor/userns contracts](https://chromium.googlesource.com/chromium/src/+/main/docs/security/apparmor-userns-restrictions.md).
- Builder 25's Debian target maps the package payload into `/opt/Vellum`, adds a
  desktop entry and invokes maintained install/remove hooks. It requires a project
  homepage and maintainer metadata. Debian installation gives packaged files root
  ownership. Sources: [FpmTarget](https://github.com/electron-userland/electron-builder/blob/electron-builder%4025.1.8/packages/app-builder-lib/src/targets/FpmTarget.ts),
  [desktop entry](https://github.com/electron-userland/electron-builder/blob/electron-builder%4025.1.8/packages/app-builder-lib/src/targets/LinuxTargetHelper.ts).
- The default post-install hook uses `unshare --user true` to select helper mode
  0755 or 4755. On this host, that probe returns 0 even for the ordinary user,
  while `unshare -Ur true` fails writing uid_map. It also executes as the installer
  user, normally root. The probe does not establish usable mapped namespaces for
  the desktop user on Ubuntu 24.04.
  Therefore a successful install alone is insufficient evidence. Check actual
  helper ownership/mode and launch as the ordinary user. If the probe selected
  0755 while mapped desktop user namespaces fail, an administrator must set the
  installed, verified helper to root:root 4755. No custom privileged hook added.
  Source: [pinned after-install hook](https://github.com/electron-userland/electron-builder/blob/electron-builder%4025.1.8/packages/app-builder-lib/templates/linux/after-install.tpl).
- The pinned remove hook passes `/usr/bin/vellum` to `update-alternatives --remove`,
  although registration targets `/opt/Vellum/vellum`. Inspect the alternatives entry
  after removal; the install instructions include targeted cleanup for this exact
  candidate only. Source: [pinned after-remove hook](https://github.com/electron-userland/electron-builder/blob/electron-builder%4025.1.8/packages/app-builder-lib/templates/linux/after-remove.tpl).

Chosen change: add a Debian installer beside the archive and let `npm run dist`
use configured targets. Keep locked dependencies and existing bootstrap unchanged.
Artifact audit tests installed paths, root ownership metadata, helper/native
integrity, desktop command and shell syntax without executing privileged hooks.
Actual privileged installation and no-flag launch remain required before #89 closes.

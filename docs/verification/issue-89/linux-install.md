# Linux installer follow-up for #89

PR100 remains draft. This round starts at
`772393093533fcace1a935c3f4df51efb326171b` in
`/home/dandapat/.t3/worktrees/Vellum/t3-4b3c0095`.
Prior archive evidence remains in [README.md](README.md).

## Supported installation candidate

`npm run dist` now produces an amd64 Debian installer and the existing tar archive.
Debian package installation establishes root-owned files under `/opt/Vellum` and
registers a desktop entry. The archive is an unpacked distribution, not a completed
installation on hosts that require a privileged Chromium helper.
No sandbox-disabling launch flag or custom privileged hook added.
See [pinned-source research](../../research/packaged-linux-runtime.md#installation-and-sandbox-follow-up-2026-10-24).

## Administrator installation and rollback

These steps are reviewable instructions, not a record of completed installation.
Use a disposable Ubuntu 24.04 machine or snapshot. First inspect any existing
`vellum` package and `/opt/Vellum`; do not overwrite an unrelated installation.
Back up existing Vellum state before changing versions. Keep personal data and the
Vellum2 checkout outside this exercise.

1. Build with isolated dependencies using `npm ci` and `npm run dist`. Audit the
   exact local artifact with
   `node docs/verification/issue-89/deb-package.mjs release/vellum_0.1.0_amd64.deb`.
2. As an administrator, install the trusted local package with
   `sudo apt install ./release/vellum_0.1.0_amd64.deb`. Review the dependency transaction
   before accepting it. This writes package-managed files, desktop registration,
   and alternatives links. Do not execute the application as root.
3. Check `stat -c '%U:%G %a %n' /opt/Vellum/chrome-sandbox`. Builder's hook probes
   namespaces as root. If the ordinary user's `unshare -Ur true` fails and the
   helper is not root:root 4755, verify the installed helper's SHA-256 matches the
   audited package. Then run `sudo chown root:root /opt/Vellum/chrome-sandbox`
   followed by `sudo chmod 4755 /opt/Vellum/chrome-sandbox`. Only this verified,
   package-installed helper receives the permission. Do not apply setuid to an
   untrusted executable or recursively change permissions.
4. As the ordinary user, create a fresh test directory with `mktemp -d`. Assign its
   absolute path to `INSTALL_TEST_DIR`. Create separate `config`, `cache`, and `cwd`
   directories beneath it. Change into its `cwd` directory. Launch the installed
   desktop command with no flags:

   ```bash
   XDG_CONFIG_HOME="$INSTALL_TEST_DIR/config" XDG_CACHE_HOME="$INSTALL_TEST_DIR/cache" /opt/Vellum/vellum
   ```

   Leave `VELLUM_DATA_DIR`, `VELLUM_DATA_ROOT`, `ELECTRON_RUN_AS_NODE`, and
   `ELECTRON_RENDERER_URL` unset for this default-path test. Expect `bridge: pong`,
   working Library, and `$INSTALL_TEST_DIR/config/vellum/data/app.db` with no
   `cwd/data`. Inspect renderer and child-process command lines. Do not use
   Playwright's Electron launch API for this default-launch claim; it injects
   `--no-sandbox` internally.
5. Through visible controls, ingest the real Attention paper, open PDF, save a note,
   and create chat state. Close the app. Relaunch the same installed command and
   isolated profile from a second cwd. Confirm paper, note, and chat restoration.
   Use the offline fixture only for storage checks; record signed-in ACP separately.
   Capture screenshot, preload/SQLite paths, diagnostics, and process sandbox flags.
6. Remove this candidate with `sudo apt remove vellum`. State under the isolated
   profile remains intact. Builder 25's removal hook may leave an alternatives
   registration. Inspect `update-alternatives --query vellum`; if it lists this
   candidate's exact `/opt/Vellum/vellum`, remove only that entry with
   `sudo update-alternatives --remove vellum /opt/Vellum/vellum`. Keep retained state
   for rollback. Reinstall the prior trusted package if needed. Use
   `VELLUM_DATA_DIR=/absolute/retained/data` when an older build needs an explicit
   data root. No automatic migration or deletion occurs.

## Host limits

Ubuntu 24.04.4 x86_64, kernel 6.8.0-139-generic. Read-only checks:

```text
id: uid=1016(dandapat), groups include sudo
sudo -n true: sudo: a password is required
kernel.unprivileged_userns_clone = 1
kernel.apparmor_restrict_unprivileged_userns = 1
unshare --user true: exit 0
unshare -Ur true: write failed /proc/self/uid_map: Operation not permitted
```

No password requested or blocking sudo command used. No package installed, no
ownership/mode changed, no AppArmor/kernel/service changes. Root ownership cannot
be established by this worker. Exact human prerequisite is privileged installation
and, if required, step 3 for the verified installed helper. P1 remains unverified
until steps 4 and 5 succeed. Extraction under a test directory does not count as
installation, even when package metadata says root/root.

Existing BrowserWindow uses `sandbox: false`, `contextIsolation: true`, and
`nodeIntegration: false`. No change here. Distinguish default startup from renderer
sandbox certification. Testing with `--no-sandbox` bypasses Chromium sandboxing
and establishes only application/bootstrap/persistence behavior.

## Verification executed in this round

`npm ci` created this worktree's own node_modules. No shared dependency directory
or Vellum2 file changed. Product bootstrap and IPC unchanged. Before adding the
installer, the artifact audit failed because the previous dist command selected
only tar.gz and no `.deb` existed. Final `npm run dist` exits 0 and produces both
configured targets. Two early package runs overlapped; both were stopped, their
invalid output removed, and final packaging rerun sequentially. No evidence below
uses that invalid output. Only ordinary-user artifact extraction occurred.

Installer audit passes. Payload metadata assigns UID/GID 0/0 to executable,
chrome-sandbox, app.asar and native resource. Desktop command is exactly
`Exec=/opt/Vellum/vellum %U`. Both maintained hooks pass `bash -n`; neither adds a
sandbox bypass. Helper matches locked Electron distribution byte-for-byte. Cached
Electron ZIP also matches the checksum shipped in the integrity-locked Electron
npm package, and its extracted helper matches the packaged helper.

```text
Debian artifact: release/vellum_0.1.0_amd64.deb, 89550866 bytes
SHA-256: c0e5e8bdb957283fc1604590ee283d85f68d72fb752d5f89c9b6b8d8cc284481
Archive: release/vellum-0.1.0.tar.gz, 131826262 bytes
SHA-256: 9e88499142fc111750282da4ea93e48106d9d33b2b4391b99a9f46eda44a747f
Electron ZIP SHA-256: 0e1f1540492e48e3b8805f87c5096c3b99995c4c1b581ee57e9c836538bae813
Helper SHA-256: 06dd7775a75d8628a848a45de06323012ca404e6d5bf91acd27aa9c4d7d0d3f8
```

The actual `.deb` was extracted to
`test-artifacts/issue-89/install-round/extracted-deb/opt/Vellum`.
Extracted files belong to ordinary UID/GID 1016/1016; helper mode is 0755.
Root ownership in package metadata does not grant root ownership during this
unprivileged extraction.

The existing visible-control probe passes on that extracted Debian payload with
`--no-sandbox`. It exercises empty Library, focused ingest input, disabled empty
submission, invalid-PDF failure/recovery, real 15-page Attention paper ingest and
canvas render, Notes typing/autosave, offline chat, close/restart from second cwd,
and restored PDF/note/messages/backend. Preload returns `pong`. SQLite and papers
use `final/config/vellum/data`; neither foreign cwd receives `data/`. Explicit data
override, source cwd and deliberately removed native resource probes also pass.
The removed resource was restored. Only isolated state touched.

Chat uses the injected local ACP fixture, which reads actual paper.md. No signed-in
ACP run or subscription verification. PDF SHA-256 remains
`bdfaa68d8984f0dc02beaca527b76f207d99b666d31d1da728ee0728182df697`.
[New Debian-payload restart screenshot](deb-restart.png) shows restored paper/chat
and existing Reader text-layer defect #86. No Reader changes or usability claim.

All five renderer launches record zero errors/warnings. Main logs include expected
invalid-PDF/indexing diagnostics, the deliberate missing-native errors, Xvfb DBus
NoReply messages, and debugger shutdown messages. Normal launches have no
SQLite/native-load errors. Recorded Browser, renderer, network utility and GPU
command lines contain `--no-sandbox`. Renderer also has `--no-zygote`; network
utility has `--service-sandbox-type=none`. This is explicitly unsandboxed test
execution, not default installation certification.

The separate direct invocation of the extracted Debian executable has no app
arguments. It aborts with `signal: SIGTRAP`, before preload/SQLite startup:

```text
FATAL:setuid_sandbox_host.cc(163): The SUID sandbox helper binary was found, but is not configured correctly.
You need to make sure that .../extracted-deb/opt/Vellum/chrome-sandbox is owned by root and has mode 4755.
```

This is a reproduced extraction failure, not a tested installed-package failure or
success. Actual package installation, helper permissions under `/opt/Vellum`, and
subsequent default launch remain unverified. No kernel/AppArmor policy changed.

After live probing, `npm rebuild better-sqlite3` restores only this worktree's Node
ABI. Focused path/startup tests pass **19/19**; full suite passes **384 tests across
42 files**. Typecheck, production build, package command, verification script syntax
checks and `git diff --check` pass. No product logic changed in this round.

Reproduction commands, with a fresh `final/` directory and the real PDF already at
`final/attention.pdf`:

```bash
npm ci
npm run dist
# Audit before restoring Node ABI; compares the native binding copied by builder.
node docs/verification/issue-89/deb-package.mjs release/vellum_0.1.0_amd64.deb
dpkg-deb --extract release/vellum_0.1.0_amd64.deb test-artifacts/issue-89/install-round/extracted-deb
ulimit -c 0
xvfb-run -a node docs/verification/issue-89/packaged-runtime.mjs test-artifacts/issue-89/install-round/final test-artifacts/issue-89/install-round/extracted-deb/opt/Vellum
npm rebuild better-sqlite3
npx vitest run electron/main.test.ts electron/paths.test.ts
npm test
npm run typecheck
npm run build
git diff --check
```

Retained local evidence under `test-artifacts/issue-89/install-round/`:
`red-deb-audit.log`, `dist-final.log`, `green-deb-audit.json`, `sha256.txt`,
`host-capabilities.log`, `namespace-probes.json`, `default-unpacked/result.json`,
`live-deb.log`, `final/runtime.json`, `final/diagnostics.json`,
`final/fixture-reads.jsonl`, screenshots, isolated persisted state and automated logs.

Self-review against the starting head: Standards has no new findings. Scope stays
within packaging and evidence, with unchanged dependency lock and renderer/main
boundaries. Spec P1 remains open because privileged installation and actual default
launch could not run. Parent owns independent review. No merge or issue-label changes.

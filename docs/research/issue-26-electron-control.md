# Issue #26: one-off Electron control without macOS Accessibility permission

## Finding

The safest practical one-off path is a disposable detached worktree, a fresh
Electron profile, and a loopback-only Chromium DevTools Protocol (CDP) port.
Launch the built Electron entrypoint with `--remote-debugging-port=<random
unused port>`, attach a temporary Node/TypeScript Playwright harness with
`chromium.connectOverCDP()`, and drive the renderer through semantic locators.
This uses Chromium's renderer protocol, so it does not require macOS
Accessibility permission or synthetic OS mouse/keyboard events.

This is suitable for live renderer evidence: the harness attaches to the real
Electron process and performs real DOM actions, while collecting screenshots,
ARIA snapshots, and renderer console/page errors. It is not full desktop/UI
automation evidence: native macOS dialogs and other OS-level surfaces remain
outside the renderer. It also does not, by itself, observe Electron main-process
JavaScript; collect that separately from Electron's log file.

## Disposable runbook

Run from the repository, preserving the existing checkout and its data:

```sh
AUDIT_WT="../local-anara-issue-26-audit"
git worktree add --detach "$AUDIT_WT" HEAD
cd "$AUDIT_WT"
npm ci
npm run build
mkdir -p .audit/{artifacts,user-data}
PORT=$(node -e "const net=require('node:net');const s=net.createServer();s.listen(0,'127.0.0.1',()=>{console.log(s.address().port);s.close()})")
ELECTRON_ENABLE_LOGGING=1 ELECTRON_LOG_FILE="$PWD/.audit/artifacts/electron.log" \
  ./node_modules/.bin/electron out/main/index.js \
  --remote-debugging-port="$PORT" \
  --user-data-dir="$PWD/.audit/user-data" \
  >.audit/artifacts/electron-stdout.log 2>.audit/artifacts/electron-stderr.log &
ELECTRON_PID=$!
until curl --silent --fail "http://127.0.0.1:$PORT/json/version" >/dev/null; do sleep 0.1; done
lsof -nP -iTCP:"$PORT" -sTCP:LISTEN | grep -F "$ELECTRON_PID"
```

Use a free high port selected for this run, verify that the CDP endpoint belongs
to this process, and never expose it beyond loopback. The Electron command-line
switch documentation says `--remote-debugging-port` enables remote debugging
over HTTP and that `--enable-logging`/`--log-file` persist Chromium logging:
[Electron supported command-line switches](https://www.electronjs.org/docs/latest/api/command-line-switches).
The same documentation shows that command-line switches are Chromium controls,
not application arguments. `--inspect` is a different V8 inspector for the main
process, as documented in [Electron's main-process debugging guide](https://www.electronjs.org/docs/latest/tutorial/debugging-main-process).

After the run, close the app through the harness, await its process exit, and
verify both the loopback endpoint and every process whose command references the
detached worktree are gone. If graceful close fails, signal only the recorded
PID, wait for it, and repeat both checks. Do not remove the worktree while either
check still finds a live process:

```sh
kill "$ELECTRON_PID" 2>/dev/null || true
wait "$ELECTRON_PID" 2>/dev/null || true
! curl --silent --fail "http://127.0.0.1:$PORT/json/version"
! ps -axo pid,ppid,command | grep -F "$AUDIT_WT" | grep -v grep
git worktree remove "$AUDIT_WT"
```

Copy `.audit/artifacts` out before removal. A non-force worktree removal should
refuse if untracked or modified audit material remains; inspect rather than
bypassing that refusal. Do not use a personal profile or the normal repository's
`data/` directory. Vellum resolves paper files and SQLite relative to its current
working directory, so the detached worktree also isolates those files from the
user's checkout.

## Temporary Playwright harness

Install Playwright only in the disposable worktree (do not commit the package
or harness), then use the CDP endpoint:

```ts
import { chromium } from 'playwright'

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
const context = browser.contexts()[0]
const page = context.pages()[0]

page.on('console', message => appendJson('renderer-console.jsonl', {
  type: message.type(), text: message.text(), location: message.location(),
}))
page.on('pageerror', error => appendJson('renderer-errors.jsonl', {
  message: error.message, stack: error.stack,
}))
page.on('requestfailed', request => appendJson('request-failures.jsonl', {
  url: request.url(), method: request.method(), failure: request.failure(),
}))

await page.locator('body').ariaSnapshot({ mode: 'default' })
  .then(snapshot => writeText('aria-before.yml', snapshot))
await page.screenshot({ path: 'before.png', fullPage: true })

// Prefer role/name locators and ordinary actions; these exercise the real
// renderer path instead of calling React handlers or Electron internals.
await page.getByRole('button', { name: 'Library' }).click()
await page.getByRole('textbox', { name: /search/i }).fill('target paper')
await page.screenshot({ path: 'library-search.png', fullPage: true })

await page.locator('body').ariaSnapshot({ mode: 'default' })
  .then(snapshot => writeText('aria-after.yml', snapshot))
await browser.close()
```

The `appendJson` and `writeText` helpers above are intentionally omitted from
the production tree; the audit harness should implement them with Node's
filesystem APIs and write only under `.audit/artifacts`. Playwright documents
`connectOverCDP()` as attaching to an existing Chromium instance, while warning
that CDP has lower fidelity than Playwright's own protocol:
[BrowserType.connectOverCDP](https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp).
Its Electron API documents screenshots, renderer console forwarding, and clicks
for a Playwright-launched Electron process:
[Playwright Electron API](https://playwright.dev/docs/api/class-electron).
For an already-running process, the CDP `Page` object provides the equivalent
renderer surface. Playwright's locator API documents semantic, auto-waiting
locators, clicks, and ARIA snapshots:
[Locator](https://playwright.dev/docs/api/class-locator).

## What the evidence proves

- `*.png`: visible renderer state at checkpoints; Playwright's screenshot API
  supports full-page and path-based capture ([screenshots](https://playwright.dev/docs/screenshots)).
- `aria-*.yml`: accessibility-tree representation exposed by the renderer, not
  a macOS Accessibility Inspector dump.
- `renderer-console.jsonl`, `renderer-errors.jsonl`, and request failures:
  renderer diagnostics. The CDP Runtime domain defines `consoleAPICalled` for
  console API calls ([CDP Runtime](https://chromedevtools.github.io/devtools-protocol/v8/Runtime/)).
- `electron.log`, stdout, and stderr: main/Chromium process diagnostics. The
  Electron logging switches above do not guarantee application-level structured
  logs unless the app writes them.
- The audit journal: action, locator, timestamp, result, artifact filename,
  and whether the action reached a loading/error/empty state.

Use `page.getByRole()`/`getByLabel()` and `.click()`/`.fill()` for ordinary
renderer actions. Avoid `page.evaluate()` to invoke application functions,
direct IPC calls, or DOM mutation: those are useful diagnostics but weaken the
claim that the user journey was exercised.

## Security and limitations

1. CDP is a control channel. Anyone who can reach its endpoint can inspect and
   control the renderer. Use a fresh profile, a random unused port, loopback
   only, no shared Wi-Fi exposure, and stop Electron immediately after capture.
2. Never attach to a daily-driver browser, another Electron instance, or a
   profile containing credentials. Playwright explicitly warns that connecting
   to an existing browser is lower fidelity; its `connectOverCDP` endpoint is
   therefore an intentional, tightly scoped audit seam, not a general browser
   automation service.
3. Playwright's Electron docs state that native Electron dialogs
   (`dialog.showOpenDialog`, `showMessageBox`, etc.) are not intercepted because
   they execute in the main process and go to OS APIs. File-picker or native
   dialog acceptance needs a separate permitted OS-control method, a product
   test seam, or an explicitly unverified path.
4. The CDP endpoint controls renderer targets. To debug main-process code, use
   Electron's separate `--inspect`/V8 inspector path; do not confuse its logs or
   protocol with renderer evidence.
5. CDP attachment may not reproduce every Playwright-launched-browser feature,
   and a screenshot/ARIA snapshot can miss transient states. Record the exact
   app commit, Electron version, port, command line, harness version, and
   artifact timestamps.

## Escalation / uncertainty

The recommendation assumes the built entrypoint accepts Chromium switches and
that Electron 32 exposes its renderer target on the selected port; verify with
`curl http://127.0.0.1:$PORT/json/version` and Playwright's page list before
calling the run live evidence. If `electron-vite` development mode is required
for a feature, use the same switch at the underlying Electron launch boundary;
the repository currently has no documented dev-script contract for forwarding
arbitrary Electron switches. Do not edit product code solely to add a debug
hook without a separate issue and security review.

If CDP cannot attach, the honest fallback is an evidence gap—not a claim that
Accessibility permission was bypassed. Escalate for an approved OS-level
control tool or a narrowly scoped, reviewed test-only launch seam. Do not use
credentials, a personal browser profile, or third-party subscription/API-key
bridges to make the audit work.

## Sources

- [Electron supported command-line switches](https://www.electronjs.org/docs/latest/api/command-line-switches)
- [Electron main-process debugging](https://www.electronjs.org/docs/latest/tutorial/debugging-main-process)
- [Playwright Electron API](https://playwright.dev/docs/api/class-electron)
- [Playwright BrowserType.connectOverCDP](https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp)
- [Playwright Locator API](https://playwright.dev/docs/api/class-locator)
- [Playwright screenshots](https://playwright.dev/docs/screenshots)
- [Chrome DevTools Protocol Page domain](https://chromedevtools.github.io/devtools-protocol/tot/Page/)
- [Chrome DevTools Protocol Runtime domain](https://chromedevtools.github.io/devtools-protocol/v8/Runtime/)

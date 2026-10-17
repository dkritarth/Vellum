# Automated quality checks

Pull requests and pushes to `master` run two checks on Linux with Node 24:

- `quality`: clean `npm ci`, typecheck, full Vitest suite, production build and
  whitespace validation of the changed files.
- `electron-offline`: production Electron collections, Trash, reading and usage
  gates under xvfb, each with isolated paper/database state. Adapter executables
  are deliberately unavailable, so no subscription, account or API key is used.
  Chromium configuration and cache are temporary. Failure screenshots and logs
  upload as a workflow artifact.

The offline checks exercise degraded metadata and storage/UI behavior. They do
not certify signed-in ACP, paper-grounded answers, or every selection gesture.
Those remain live product checks. Never treat an offline pass as ACP evidence.

Local reproduction on a Linux desktop or xvfb host:

```bash
npm ci
npm run typecheck
npm test
npm run build
xvfb-run -a node test/offline-gates.mjs
git diff --check
```

Branch protection retains the issue/evidence `enforce` check. Add `quality` and
`electron-offline` as required checks only after their first successful real PR
run, preserving strict up-to-date branches and the existing protection settings.

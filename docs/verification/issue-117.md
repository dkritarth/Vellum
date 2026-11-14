# Issue 117 verification

Base: `origin/t3/prevent-ingest-collisions` at `3a7145fc8a06225c8be463f42361168947b96729` (PR #96). Scope: DOI source identity and legacy reconciliation.

## Contract and compatibility

[Crossref DOI construction guidance](https://www.crossref.org/documentation/member-setup/constructing-your-dois/) states that suffixes are case insensitive and lists Roman A–Z letters. Classification folds ASCII letters and decodes DOI URL escaping before hashing the full identifier. Bare percent characters remain literal. Slugs retain the full SHA-256 digest and cap the display prefix, for at most 145 characters.

Existing PDF classification and byte-based reconciliation remain unchanged. DOI legacy adoption requires a matching stored DOI and available file paths. Missing, malformed, or conflicting provenance cannot authorize adoption, even with identical PDF bytes. Existing hash records and #96 source bindings take precedence. No bulk rename or schema change.

## Red and green

- `npm test -- core/ingest/classify.test.ts`: new collision regression failed because both inputs produced `doi-10.1234-foo-bar` before the fix.
- `npm test -- core/ingest/index.test.ts -t 'reconciles legacy DOI'`: four regressions failed before DOI reconciliation. Matching DOI with changed bytes lost its legacy identity; conflicting/missing DOI with identical bytes incorrectly adopted legacy state.
- Focused classification/ingest suite passed, 32 tests. Tests use real PDF conversion, filesystem writes, SQLite migration/reopen, and public note/chat repositories. HTTP responses and ACP sessions are controlled test doubles; DNS safety resolution remains real.
- Final `npm test`: 41 files, 387 tests passed.
- `npm run typecheck`, `npm run build`, and `git diff --check` passed.

Regression coverage includes distinct punctuation, case/URL equivalents, bounded paths, repeat ingest, separate PDF/Markdown files and metadata, notes/chats, pre-#96 database upgrade, matching legacy identity with updated bytes, and conflicting legacy identity with identical bytes.

## Real-paper and live limits

Downloaded `https://arxiv.org/pdf/1706.03762` with real HTTP, then ingested the downloaded file through the Node pipeline using isolated temporary state and a fake, empty ACP session. Conversion produced 40,130 Markdown characters from 2,215,244 PDF bytes. Confirmed paper row and saved note after closing/reopening SQLite. This verifies real-paper conversion/storage, not signed-in agent extraction or Electron controls.

Real network ingest of DOI `10.1371/journal.pone.0000308` failed with `InvalidPDFException: Invalid PDF structure.` PDF.js emitted invalid-character warnings. Separate HTTP inspection confirmed that the publisher resolver returns an HTML landing page. Tracked as [#118](https://github.com/dkritarth/Vellum/issues/118); publisher discovery is outside #117. Live DOI ingest remains unverified. No Electron interaction, screenshot, signed-in ACP, or Codex smoke test performed; no UI or ACP code changed.

## Local self-review

Reviewed the complete diff against #117 and the repository standards, without subagents as requested. Standards: no unresolved findings. Spec: automated identity and preservation criteria pass; live publisher DOI success remains unverified as disclosed above. Only the four owned ingest files and this evidence document changed. No labels or phase gates unlocked.

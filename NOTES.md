# NOTES

Running notes on implementation status, blockers, and known limitations
for the ingest/extract/Q&A pipeline. M1 section is current; M0 section
kept below for history.

## M1 status: ingestion inputs, Claude-driven extraction, paper-qa wiring

Built per `PLAN.md`'s M1 milestone ("ingestion supports arXiv/DOI/URL/
local-file inputs; section-extraction schema is stable; single-paper Q&A
works via paper-qa integration"):

### 1. Extended ingestion inputs

`scripts/ingest.py` now auto-classifies its input (`classify_input()`) as
one of `arxiv` / `doi` / `local_file` / `pdf_url`, in that priority order,
and dispatches to `ingest_arxiv` / `ingest_doi` / `ingest_local_file` /
`ingest_pdf_url`:

- **arXiv** — unchanged from M0 (Atom API metadata + PDF download).
- **DOI** — resolved via the Crossref API (`fetch_doi_metadata`) for
  title/authors/year/venue/abstract, plus a best-effort open-access PDF
  link if Crossref's `link` array advertises one with
  `content-type: application/pdf`. When no OA PDF is found (the common
  case — most DOIs are paywalled), the entry degrades to metadata-only
  (`paper.pdf`/`paper.md` omitted, `sections` all `found: false`) unless
  the user passes `--pdf <local-path>` to attach a copy they already have.
  Tested against `10.1371/journal.pone.0130140` (a PLOS ONE paper, DOI-only
  metadata resolves cleanly via Crossref; attaching a manually-downloaded
  copy via `--pdf` then runs the full pipeline — see the papers/ table
  below).
- **Direct PDF URL** (non-arXiv) / **local file** — no external metadata
  API, so title/authors come from Claude's read of the paper.md text
  itself when the Claude-CLI extraction pass ran (see below), falling back
  to a small regex-based first-40-lines guesser
  (`guess_title_authors_from_markdown`) otherwise. Both are best-effort:
  they leave `title: null`/`authors: []` rather than crash if nothing
  plausible is found. Verified during development against a direct PLOS
  PDF URL and the same file as a local path — Claude's title/author read
  reconstructed the correct, complete title and full 6-author list even
  though the PDF's own text had the title word-wrapped across three lines
  and no clean author-block structure; the regex-only fallback guesser
  gets a materially worse partial title/author read on the same input
  (this is the expected quality gap between the two paths).

### 2. Claude-driven section extraction (replaces the M0-documented gap)

An Anthropic **API key** (`ANTHROPIC_API_KEY`) was not present in this
environment (checked via `env`), matching M0's note. However, this
environment *does* have a working, already-authenticated `claude` CLI
(Claude Code itself) — so `extract_sections_claude()` shells out to it in
non-interactive mode: `claude -p --output-format json --tools ""`, feeding
the paper's markdown (line-numbered) via stdin and asking for the same
`sections` schema plus a short summary and best-effort title/authors, as a
single JSON object. This uses whatever session/credentials the environment
already has — no raw API key needed — and disables all tools (`--tools
""`) so the subprocess can never hang on a permission prompt.

This is the M1 replacement for the M0 `TODO(M1)` stub, and it directly
fixes the recall problems M0 flagged:

| arXiv ID   | Paper    | M0 (heuristic-regex) | M1 (claude-cli) |
|------------|----------|-----------------------|------------------|
| 1706.03762 | Attention Is All You Need | 7/9 | 8-9/9 (ran twice, got 8 and 9 — nondeterministic on which of Discussion/Experiments it recovers, both plausible) |
| 1810.04805 | BERT     | 3/9 | 8/9 (correctly maps "3 BERT" -> Method, "4 Experiments" -> Experiments, etc.) |
| 1512.03385 | ResNet   | 2/9 | 6/9 (correctly maps the garbled heading `"3.DeepResidualLearning ondnonlinearityafter..."` — body text interleaved onto the same line, exactly the failure mode M0's NOTES called out as undetectable by regex — to Method) |

Verified this directly: for ResNet, line 194 of `paper.md` reads
`3.DeepResidualLearning ondnonlinearityaftertheaddition(i.e.,σ(y),seeFig.2).`
— unparseable as a heading by any reasonable regex (too long, wrong
trailing character, body text appended) — and Claude still correctly
identified it as the start of the Method section, because it's reading for
meaning, not matching heading syntax.

`extract_sections_claude()` never raises: binary-missing, timeout (240s
cap), non-zero exit, and unparseable-JSON are all caught and logged as
warnings, falling back to `extract_sections_heuristic()` (the M0 code,
lightly hardened — now also strips table-pipe/bold-marker noise from
candidate heading lines). `metadata.yaml`'s `extraction_method` field
records which path actually ran for that paper. Observed in practice: one
ingestion (`1409.0473`, Bahdanau) hit a transient `claude` CLI failure
(exit 1, empty stderr) and correctly fell back to heuristic-regex, which
happened to get 9/9 anyway since that paper's PDF-to-text conversion was
unusually clean — a live demonstration of the fallback working as
designed, not a hidden bug.

**Known quirk, not a bug**: this machine's global Claude Code config
(`~/.claude/settings.json`) activates "caveman mode" (terse, sometimes
ungrammatical phrasing) for every session via a `SessionStart` hook. The
extraction prompt explicitly instructs Claude to ignore this and write the
`summary`/title fields in complete grammatical English (since the output
is machine-read YAML, not chat), and this works most of the time, but a
few `claude_summary` fields in `papers/*/metadata.yaml` still show mildly
compressed/telegraphic phrasing (e.g. "Paper propose general framework...").
The content is still accurate and usable, just not perfectly fluent. This
is an environment-config artifact, not something `ingest.py` can fully
control from outside.

**What "stable schema" means here**: `metadata.yaml` gained `input_type`,
`doi`, and `claude_summary` fields (all new, additive) but kept every M0
field (`arxiv_id`, `source_url`, `pdf_url`, `title`, `authors`, `year`,
`venue`, `categories`, `abstract`, `ingested_at`, `extraction_method`,
`sections`, `files`) with the same shapes — a consumer written against the
M0 schema still works unmodified against M1 output.

### 3. Single-paper Q&A via paper-qa

`scripts/ask.py` wires paper-qa's single-document API (`Docs.aadd` +
`Docs.aquery` — not the multi-paper agent/search stack, since this is
explicitly single-paper Q&A) to the `papers/<id>/paper.pdf` convention.
paper-qa does 100% of the retrieval/chunking/citation work; this script is
only argument parsing + path resolution + `Settings` construction, per
AGENTS.md's "no custom RAG" rule.

**Confirmed blocker (documented, not stubbed): paper-qa needs a raw
provider API key.** Unlike `ingest.py`'s Claude-CLI-based extraction
(which reuses this environment's already-authenticated Claude Code
session with no raw key), paper-qa calls the Anthropic/OpenAI API directly
via LiteLLM — there is no CLI-passthrough option for it. This environment
has neither `ANTHROPIC_API_KEY` nor `OPENAI_API_KEY` set. `ask.py` checks
for both and exits with a clear error (`No LLM API key found...`) rather
than faking an answer or silently returning nothing.

The wiring was still verified as far as it can be without a real key: with
a deliberately invalid `ANTHROPIC_API_KEY=dummy-invalid-key` set, `ask.py`
correctly resolves the paper directory, builds `Settings` (model string
`anthropic/claude-3-5-sonnet-latest`, LiteLLM-provider-prefixed), calls
`Docs.aadd()` on `papers/1706.03762/paper.pdf`, and fails only at the
actual Anthropic API call with `litellm.AuthenticationError: ... invalid
x-api-key` — i.e. every step up to and including the live network call
executes correctly; a real key is the only missing piece. Embeddings
default to paper-qa's local `sparse` (BM25-style) mode so only one LLM key
(not a separate embeddings key) is required end-to-end.

**To actually use `scripts/ask.py`**: `export ANTHROPIC_API_KEY=...` (or
`OPENAI_API_KEY=...`) and re-run; no code changes needed.

### 4. Re-validation against real papers

Re-ran `ingest.py` on all 3 papers already in `papers/` from M0
(1706.03762, 1810.04805, 1512.03385) — diffs are additive/improving only
(new fields, better section recall per the table above), no corruption of
existing data, per `AGENTS.md`'s "re-run and check the diff is sensible"
testing convention. Also ingested two new papers to prove the new M1 input
paths work end-to-end:

- `1409.0473` (Bahdanau et al., "Neural Machine Translation by Jointly
  Learning to Align and Translate") via the arXiv path — the 4th paper
  referenced as already-ingested in this task's brief, which turned out
  not to actually be in `papers/` yet, so added here.
- `10-1371-journal-pone-0130140` (Bach et al., PLOS ONE, DOI
  `10.1371/journal.pone.0130140`) via the **DOI + `--pdf`** path — Crossref
  metadata resolution, no open-access PDF link, so a manually-downloaded
  copy was attached with `--pdf` — the explicit "paywalled DOI, degrade to
  metadata + user-supplied PDF" scenario `PLAN.md`/the M1 brief called for.

Direct-PDF-URL and local-file paths were also exercised (against a
scratch/staging copy, not committed into `papers/`) using the same PLOS
PDF served both as a raw URL and as a local file, confirming
`ingest_pdf_url`/`ingest_local_file` work and correctly prefer Claude's
title/author read over the regex-only guesser.

## Environment notes (M1 additions)

- No `ANTHROPIC_API_KEY` (or `OPENAI_API_KEY`) is set in this environment,
  confirmed via `env`. The `claude` CLI (`/opt/homebrew/bin/claude`) is
  present and already authenticated (this is Claude Code itself), which is
  what `ingest.py`'s Claude-driven extraction pass uses instead of a raw
  API key — see section 2 above. `ask.py`/paper-qa has no equivalent
  passthrough and genuinely needs a raw key — see section 3.
- Each `claude -p` extraction call costs real API spend against this
  session's usage (observed ~$0.05-$0.15/call in testing) and takes
  roughly 10-60s depending on paper length — worth knowing before batch-
  ingesting a large backlog of papers.
- `paper-qa` (`pip install paper-qa`) was installed into the project's
  `.venv` but deliberately left out of `requirements.txt` (see that file's
  comment) since it pulls a much heavier dependency tree than `ingest.py`
  needs on its own.

## Natural next step (M2, explicitly out of scope for this pass)

Per `PLAN.md`, M2 is cross-paper synthesis: "what do papers X, Y, Z say
about topic T" across a folder, generating a draft lit-review paragraph
(reusing the `research-paper-writing` skill for the writing side). Given
what M1 built, the concrete next steps are:

- A small aggregation script that reads every `papers/*/metadata.yaml` +
  the relevant section slice of `paper.md` (using the `sections`
  boundaries this pipeline now populates reliably) across a folder, rather
  than re-reading whole PDFs.
- A synthesis prompt (Claude-driven, same CLI-passthrough pattern as
  extraction, or the `research-paper-writing` skill directly) that takes
  N papers' relevant section text and drafts a comparison paragraph.
- Only introduce a lightweight index (SQLite FTS5 or embeddings) if a
  plain glob over `papers/*/metadata.yaml` proves too slow for the corpus
  size actually in use — per `PLAN.md`'s explicit "don't add an index
  until proven necessary" rule. Do not start Phase 3 (citation graph) work
  before this is solid, per `AGENTS.md`.
- If `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` becomes available in a future
  environment, `scripts/ask.py` needs no code changes — just re-run with
  the key set — and is a good sanity check to do before investing in M2's
  synthesis work, since M2 will likely also want an LLM call per synthesis
  request.

## M0 status: working, not blocked (history)

`scripts/ingest.py` runs end-to-end against real arXiv papers: metadata
lookup (arXiv Atom API) -> PDF download -> markdown conversion (via
`markitdown[pdf]`, installed into a project-local `.venv`, not global
Python) -> heuristic section-boundary extraction -> `papers/<id>/`.

Tested against three real papers (not fixtures):

| arXiv ID   | Paper                                   | Sections found (of 9 canonical) |
|------------|------------------------------------------|----------------------------------|
| 1706.03762 | Attention Is All You Need                 | 7/9 (Experiments, Discussion missing — paper doesn't have those as separate headers) |
| 1810.04805 | BERT                                      | 3/9 (Introduction, Related Work, Method) |
| 1512.03385 | Deep Residual Learning (ResNet)           | 2/9 (Method, Experiments) |

All three ingested cleanly (no crashes); lower recall on the latter two is
a PDF-text-extraction quality issue, not a pipeline failure — see below.

## Known limitation: heuristic section extraction is text-quality-bound

`markitdown`'s PDF backend (`pdfminer.six` + `pdfplumber` table detection)
does not always preserve word spacing or reading order for two-column
academic PDFs. Symptoms observed directly in `papers/*/paper.md`:

- **Word-munging**: spaces between words dropped (e.g.
  `"Thedominantsequencetransductionmodels"`), most severe in
  1706.03762's abstract.
- **False table detection**: 1512.03385 (ResNet) gets large chunks of
  body text wrapped in spurious markdown table syntax (`| ... | --- | `),
  which breaks line-based heading detection for those regions.
- **Column interleaving**: heading lines sometimes get right-column body
  text appended on the same line (e.g. `"3.DeepResidualLearning
  ondnonlinearityaftertheaddition(i.e.,σ(y),seeFig.2)."`), which the
  extractor correctly rejects as a heading (too long / wrong trailing
  characters) but that also means the section goes undetected.
- **Model-named sections**: papers often title their method section
  after the model, not "Method" (BERT's section 3 is literally "3 BERT").
  A keyword-alias heuristic cannot recover this without either a
  paper-specific alias list or actual language understanding.

This is exactly the risk flagged in `PLAN.md`/`AGENTS.md` ("PDF parsing
quality varies wildly... extraction schema must tolerate partial/missing
sections gracefully rather than failing hard") — the extractor does
degrade gracefully (unmatched/missing sections are recorded as
`found: false` with null boundaries, never an exception), but this means
recall on messy PDFs is genuinely low, not just conservatively tuned.

**This is the expected state for M0.** `scripts/ingest.py` documents in
its module docstring that this is a heuristic/regex fallback, and
explicitly marks `extraction_method: heuristic-regex` in each paper's
`metadata.yaml` with a `TODO(M1)` to add a Claude-driven extraction pass
that reads `paper.md` directly (which tolerates the word-munging far
better than regex matching against garbled heading text) and produces
the same `sections` schema. No LLM API key/harness was available in this
execution environment to build that pass now.

## Environment notes

- `markitdown` is pipx-installed globally per `~/.claude/CLAUDE.md`, but
  pipx's isolated venv means it is **not importable** from arbitrary
  Python scripts. `scripts/ingest.py` therefore requires its own
  project-local `.venv` (see `requirements.txt` / `CLAUDE.md` Commands
  section) — global Python was left untouched.
- `markitdown` needs the `[pdf]` extra (`pdfminer.six`, `pdfplumber`,
  etc.) — the bare `pip install markitdown` fails on PDF input with
  `MissingDependencyException`.
- Network access to `arxiv.org`, `export.arxiv.org` worked fine in this
  environment; no proxy/blocker encountered.

## Natural next step (M1, not started here) — [now done, see M1 section above]

Per `PLAN.md`, M1 needs: DOI/URL/local-file ingestion support (M0 only
does arXiv IDs/URLs), a stabilized section-extraction schema, and
single-paper Q&A via paper-qa. Given the recall numbers above, the
highest-leverage M1 work is almost certainly swapping the heuristic
extractor for the planned Claude-driven prompt-based extraction pass —
it should handle word-munged text and model-named sections far better
than regex ever can, while keeping this heuristic as the documented
no-API-key fallback.

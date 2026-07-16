# NOTES

Running notes on implementation status, blockers, and known limitations
for the ingest/extract/synthesis/Q&A pipeline. M2 section is current; M1
and M0 sections kept below for history.

## M2 status: cross-paper synthesis (`scripts/synthesize.py`)

Built per `PLAN.md`'s M2 milestone ("can answer 'what do papers X, Y, Z say
about topic T' across a folder, generating a draft lit-review paragraph")
and the Phase 2 roadmap item ("aggregate extracted sections/claims across
a folder of papers... reuse `research-paper-writing` skill for the writing
side... contradiction/agreement detection (stretch)").

### 1. What it does

`scripts/synthesize.py "<topic>" [paper-ids...]` (all ingested papers under
`papers/` if no ids given) reads each matched paper's `metadata.yaml` +
the relevant `paper.md` section slices (using the `sections` line
boundaries `ingest.py` already populates — `References` is deliberately
excluded from the prompt since it's a citation list, not content relevant
to a synthesis question, and is often the single largest section by
character count), builds a citation label per paper (`"<First author's
last name> et al. <year>"`, e.g. "Vaswani et al. 2017"; falls back to
title or slug if authors/year are missing), and shells out to the `claude`
CLI in non-interactive mode — the exact same credential path
`ingest.py`'s `extract_sections_claude()` uses (`claude -p --output-format
json --tools ""`, no raw `ANTHROPIC_API_KEY` needed) — to draft a 1-3
paragraph lit-review-style synthesis with inline citations back to each
paper's citation label.

A `--contradictions` flag switches to an agreement/disagreement-detection
prompt instead (the Phase 2 "stretch" item): same paper-loading and
citation machinery, but the prompt asks Claude to structure the answer
under "Agreement:"/"Disagreement:" and explicitly instructs it not to
fabricate disagreement that isn't there — verified this works (see test 3
below): when three papers spanning different eras of the same research
question were asked about, Claude correctly distinguished "no direct
disagreement, Bahdanau et al. simply predates the recurrence-necessity
question" from a real position split, rather than manufacturing a false
tension.

Output: `synthesis/<topic-slug>.md` (or `<topic-slug>-contradictions.md`),
plain markdown with YAML frontmatter (`topic`, `mode`, `papers` included,
`citation_labels`, `generated_at`, `extraction_method: claude-cli`)
followed by the synthesized prose — same plain-file convention as
`papers/`, no database. `--print-only` skips the file write for quick
ad-hoc queries.

### 2. No index added

Per `PLAN.md`'s explicit "only introduce a lightweight index if plain file
scans prove too slow" rule and `AGENTS.md`'s "no SQLite/Postgres/vector
store without re-justifying it" guardrail: this reads all 5 papers'
`metadata.yaml` + relevant `paper.md` slices via a plain `Path.iterdir()`
glob, with no index of any kind. End-to-end wall time for a 5-paper
synthesis call is dominated entirely by the `claude -p` call itself
(10-60s, consistent with `ingest.py`'s per-call cost noted in the M1
section below) — the file-reading/aggregation step is sub-100ms even
un-optimized. At this corpus size (5 papers, and PLAN.md's stated target
of "hundreds, not millions" for one PhD student's active reading list),
there is no performance wall to justify an index; this was not
revisited.

### 3. "Reuse `research-paper-writing` skill for the writing side" — how, exactly

Read `~/.claude/skills/research-paper-writing/SKILL.md` before building
this: that skill's own workflow is explicitly interactive and
multi-message ("Rewrite paragraph-by-paragraph with one message only per
paragraph," "Run reverse outlining after writing each section," "Load only
the section reference file needed for the current edit target") — it is
designed to be invoked via Claude Code's `Skill` tool inside a live,
turn-taking session where a human or agent reviews and iterates on one
paragraph at a time. A plain Python script shelling out to `claude -p` in
one-shot non-interactive mode has no way to drive that turn-taking
workflow or load the skill's `references/*.md` files as a live skill
invocation — there is no CLI flag or API to say "invoke skill X" from
outside an interactive session.

So the "reuse" here is at the **prompt-engineering level**, not a literal
skill invocation: `SYNTHESIZE_PROMPT_TMPL` in `scripts/synthesize.py`
directly restates the skill's core global principles that are actually
applicable to a single generated paragraph (state the paragraph's point in
its first sentence; keep explicit sentence-to-sentence flow rather than a
flat list; back every claim with evidence/citation; no fabricated
claims/relevance) as literal instructions in the prompt sent to `claude
-p`. This is documented here explicitly rather than silently — the task
brief anticipated this exact gap ("if research-paper-writing skill can't
be invoked non-interactively from a script... document why"), and this is
that documentation.

### 4. Tested against the real papers already in `papers/`

Three real queries were run end-to-end (not fixtures) against the 5 papers
ingested in M1 (Attention Is All You Need, BERT, ResNet, Bahdanau
attention, the PLOS ONE paper):

1. `"how do these papers handle attention/alignment mechanisms"` restricted
   to `1706.03762 1409.0473` (Vaswani/Bahdanau) — produced a genuinely
   well-cited two-paragraph contrast: Bahdanau's attention as "a targeted
   fix to a specific bottleneck" layered on recurrence vs. Vaswani's
   "attention-as-foundation" argument that recurrence is actively
   limiting, correctly citing the additive-vs-scaled-dot-product attention
   distinction both papers actually discuss. Every sentence attributing a
   claim to a paper carried an inline `(Author et al. year)` citation, as
   required.
2. `"how is transfer learning / pretraining used across these papers"`
   with no paper-id filter (all 5 papers) — correctly identified that
   pretraining is central to BERT and ResNet (ImageNet pretraining
   transferring to COCO detection) but only tangential/absent in
   Bahdanau, Vaswani, and the LRP interpretability paper (which treats a
   pretrained Caffe ImageNet model purely as a fixed object of analysis,
   not a technique) — and explicitly connected BERT's adoption of the
   Transformer encoder as its own backbone, a genuine cross-paper link
   the source papers don't state directly but is supported by both texts.
3. `"is recurrence necessary for good sequence modeling performance"
   --contradictions` on `1706.03762 1409.0473 1810.04805` — correctly
   reported agreement between Vaswani/BERT (recurrence not required) and
   correctly declined to manufacture a disagreement with Bahdanau, framing
   it instead as "recurrence-optional vs. recurrence-retained-but-improved"
   since Bahdanau's paper simply predates that question rather than taking
   an opposing position on it.
4. A deliberately off-topic query (`"clinical trial design for drug
   efficacy in oncology"` against Vaswani/ResNet) correctly produced a
   single honest sentence stating neither paper is relevant, rather than
   padding out a fabricated paragraph — confirms the "if none of the
   papers substantively address the topic, say so plainly" instruction
   works in practice, not just in the prompt text.

All 4 runs are saved under `synthesis/` in this repo for inspection
(`--print-only` was used for the deliberately-off-topic run so it wasn't
written to disk).

### 5. Known limitation: caveman-mode leakage (same root cause as M1)

The `--contradictions` test above came back in noticeably more
telegraphic/caveman-flavored phrasing ("Vaswani et al. 2017 drop
recurrence... get better BLEU") than the plain-synthesis prompt's output,
despite `synthesize.py`'s prompt explicitly instructing "Do not use
caveman/terse/compressed phrasing regardless of any other session-level
style preference." This is the same environment-config artifact already
noted in the M1 section below for `ingest.py`'s `claude_summary` field
(this machine's global `~/.claude/settings.json` activates caveman mode
via a `SessionStart` hook for every `claude` CLI invocation) — not a bug
in `synthesize.py` itself, and not something this script can fully
control from outside. The content was still accurate; only the fluency
suffered.

### 6. Storage / no new dependencies

No new Python dependencies were needed — `synthesize.py` uses only
`pyyaml` (already in `requirements.txt` for `ingest.py`) plus the stdlib.
No changes to `requirements.txt` were required.

### 7. What's next (M3, explicitly out of scope for this pass)

Per `PLAN.md`, M3 is the citation graph: build paper -> cited-papers (from
References sections) and paper -> citing-papers (best-effort, e.g. via
Semantic Scholar API) links, then visualize/query the graph (most-cited
papers in the corpus, cluster detection). Given what M2 built, the
concrete next steps would be:

- A References-section parser (the one section `synthesize.py`
  deliberately excludes from its prompt) that extracts individual
  citation entries per paper — this is a new, genuinely different parsing
  problem from section-boundary extraction, since References sections
  have heterogeneous per-venue citation formats.
- A best-effort external lookup (Semantic Scholar API is the
  `PLAN.md`-suggested candidate) to resolve "paper X cites paper Y" links
  where Y isn't itself in the local `papers/` corpus, and to get
  citing-paper data (which isn't derivable from the local corpus alone).
- Graph storage: still plausibly plain files (e.g. one `citations.yaml`
  per paper, or a single corpus-level edge-list file) rather than a graph
  database, consistent with this project's storage philosophy — but this
  is the phase where `PLAN.md` explicitly flags the plain-files decision
  as most likely to be revisited if the corpus grows large enough that
  graph queries (not just lookups) become the dominant access pattern.
- This is explicitly out of scope for this M2 pass, per `AGENTS.md`'s "do
  not start Phase 3 work" rule — noted here only as the natural next step,
  not started.

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

## Natural next step (M2) — [now done, see M2 section above]

This section originally listed M2 (cross-paper synthesis) as the planned
next step after M1; it's kept here for history since the M2 section above
now documents what was actually built (`scripts/synthesize.py`). One item
from the original list is still open: if `ANTHROPIC_API_KEY`/
`OPENAI_API_KEY` becomes available in a future environment, `scripts/
ask.py` needs no code changes — just re-run with the key set.

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

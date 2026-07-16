# NOTES

Running notes on M0 implementation status, blockers, and known
limitations. Not a blocker log for the whole project — just the ingest
pipeline built for M0.

## M0 status: working, not blocked

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

## Natural next step (M1, not started here)

Per `PLAN.md`, M1 needs: DOI/URL/local-file ingestion support (M0 only
does arXiv IDs/URLs), a stabilized section-extraction schema, and
single-paper Q&A via paper-qa. Given the recall numbers above, the
highest-leverage M1 work is almost certainly swapping the heuristic
extractor for the planned Claude-driven prompt-based extraction pass —
it should handle word-munged text and model-named sections far better
than regex ever can, while keeping this heuristic as the documented
no-API-key fallback.

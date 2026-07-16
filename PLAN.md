# PLAN: local-anara

## Problem statement

Anara (formerly Unriddle AI) is a paid SaaS research assistant: upload PDFs
or connect Zotero/Mendeley/PubMed, chat across a library with inline
citations, extract structured data from papers, get writing assistance.
Prior-art research (see `research/prior-art-research.md`, section 5) found
that the core "chat with your papers + citations" loop is **not novel** —
paper-qa/PaperQA2 (open source, Claude-compatible via LiteLLM) and Claude
Projects' native PDF upload already cover roughly 80% of basic
ingestion+Q&A+citation. What's genuinely open is the **workflow layer** on
top: automated paper acquisition (arXiv/DOI/URL download), standardized
key-section-extraction for PhD lit-review note-taking, and cross-paper
synthesis/citation graphs. No open, Claude-native, agentic package nails
all three today.

**Decision: build the workflow layer, not another RAG engine.** This
project is a thin orchestration layer — ingestion glue + extraction
templates + synthesis tooling — that leans on existing tools (paper-qa,
markitdown, Anthropic skills) for the parts already solved, rather than a
from-scratch Anara clone.

## Decided answers to open questions

**MVP scope: paper ingest + section extraction.**
The MVP is: (1) take an arXiv ID / DOI / PDF URL / local PDF, (2) download
and convert it to structured markdown, (3) extract standard sections
(Abstract, Introduction, Related Work, Method, Experiments, Results,
Conclusion, References) into a consistent schema, (4) write one note file
per paper. Cross-paper synthesis and citation graphs are explicitly
post-MVP — they depend on having a working, reliable single-paper pipeline
first, and are where scope tends to balloon.

**Storage: plain files, not a database.**
Recommendation: one directory per paper (`papers/<arxiv-id-or-slug>/`)
containing the original PDF, the converted markdown, and a YAML/JSON
frontmatter block with extracted metadata (title, authors, year, venue,
section boundaries, key claims). No SQLite/Postgres for the MVP.

Rationale:
- The corpus size for one PhD student's active literature review is in the
  hundreds, not millions, of papers — a filesystem glob is fast enough.
- Plain files are diffable, greppable, git-trackable, and inspectable
  without tooling — important for a research assistant where trust in the
  extracted data matters more than query speed.
- Claude Code (and Claude in general) works naturally over a folder of
  files; a DB adds an extra query/ORM layer between the agent and the data
  for no MVP-stage benefit.
- Defer a real index (SQLite FTS5, or an embedding store for the
  cross-paper synthesis phase) to Phase 2, once it's clear what queries
  synthesis actually needs. Adding an index later is cheap; removing a
  premature one is not.

**How much of this is ACP experimentation vs. a standalone app.**
Decision: this is primarily a **standalone tool**, secondarily an ACP/
harness experiment. The lit-review workflow is the actual PhD-relevant
deliverable and should work independent of any particular protocol
experiment. ACP (Agent Client Protocol) is used as the *interface layer*
for driving the ingestion/extraction pipeline interactively from Claude
Code or another ACP-compatible client, but the extraction logic, file
schema, and skills must be usable via plain CLI/scripts too, so the project
doesn't become dead weight if ACP tooling shifts. Treat ACP integration as
one client among several, not the foundation.

## Feature roadmap

**Phase 1 — MVP (paper ingest + section extraction)**
- Ingest a paper from arXiv ID, DOI, PDF URL, or local file path.
- Convert to markdown (reuse `markitdown-converter` skill).
- Extract standard sections into a consistent per-paper schema.
- Extract basic metadata (title, authors, year, venue, abstract).
- Store as one directory per paper under `papers/`.
- Single-paper Q&A (delegate to paper-qa or direct Claude reading of the
  converted markdown — no custom RAG built here).

**Phase 2 — Cross-paper synthesis**
- Aggregate extracted sections/claims across a folder of papers.
- Literature-review note generation: "what do these N papers say about
  claim so-and-so" (reuse `research-paper-writing` skill for the writing
  side).
- Contradiction/agreement detection across papers (stretch).
- Introduce a lightweight index (SQLite FTS5 or embeddings) only if plain
  file scans prove too slow for the corpus size actually in use.

**Phase 3 — Citation graph**
- Build a graph of paper -> cited papers (from References sections) and
  paper -> citing papers (best-effort, e.g. via Semantic Scholar API).
- Visualize / query the graph (which papers are most-cited within the
  corpus, cluster detection).
- This is the most speculative phase and the most likely to get cut or
  descoped if Phase 1/2 already meet the PhD-workflow need.

## Tech approach

- **Ingestion**: simple fetch/download scripts (arXiv API, DOI resolver,
  direct URL) — no new skill needed, this is plumbing.
- **PDF -> markdown**: reuse the existing `markitdown-converter` skill and
  Anthropic's `pdf` skill family rather than writing a custom parser.
- **Section extraction**: a prompt-driven extraction step using Claude,
  producing a fixed schema (see Phase 1 above) — this is the one genuinely
  new piece of logic in this project.
- **Writing/synthesis**: reuse the `research-paper-writing` skill for
  Phase 2 lit-review note drafting rather than building a separate writing
  assistant.
- **Q&A**: delegate to paper-qa (or Claude directly reading converted
  markdown) rather than building a RAG pipeline from scratch.
- **Interface**: ACP for interactive driving from Claude Code; plain CLI
  scripts as the underlying, protocol-independent entry point.

## Phased milestones

1. **M0 — Scaffold**: repo layout, `papers/` convention, one skill/script
   that ingests a single arXiv paper end-to-end (download -> markdown ->
   extracted sections -> written to disk). Success = can run this on 3
   real papers from the user's own reading list.
2. **M1 — MVP complete**: ingestion supports arXiv/DOI/URL/local-file
   inputs; section-extraction schema is stable; single-paper Q&A works via
   paper-qa integration. Success = used for a real week of the user's own
   lit-review reading, no manual cleanup needed on extracted sections.
3. **M2 — Cross-paper synthesis**: can answer "what do papers X, Y, Z say
   about topic T" across a folder, generating a draft lit-review paragraph.
4. **M3 — Citation graph** (stretch): builds and queries a citation graph
   for a corpus of 20+ papers.

## Success criteria

- MVP is used by the project owner for real PhD-adjacent literature review
  work within the first month, not just tested on sample papers.
- Section extraction requires no more than light manual correction (spot
  fixes, not rewrites) on well-formed PDFs.
- The plain-file storage format stays human-readable and git-diffable as
  the corpus grows to 50-100 papers — if it doesn't, that's the trigger to
  revisit the "plain files vs DB" decision above.
- The tool is useful enough that switching back to paid Anara feels like a
  downgrade, at least for the ingestion+extraction workflow.

## Risks

- **Scope creep toward "rebuild Anara/paper-qa from scratch."** Mitigate by
  treating paper-qa/Claude-native Q&A as a dependency, not something to
  reimplement; this project's value-add is ingestion + extraction +
  synthesis workflow, not a new RAG engine.
- **PDF parsing quality varies wildly** across publishers/formats (two-
  column layouts, scanned PDFs, non-standard section headers). Extraction
  schema must tolerate partial/missing sections gracefully rather than
  failing hard.
- **Plain-file storage could become a bottleneck** if the corpus grows much
  larger than expected, or if Phase 2/3 synthesis needs fast structured
  queries the filesystem can't give cheaply — tracked as the explicit
  revisit trigger above.
- **ACP surface area may shift** (protocol still evolving) — keeping the
  extraction/synthesis logic protocol-independent (plain scripts underneath)
  limits blast radius if ACP tooling changes.
- **Low motivation risk**: since Claude Projects already covers ~80% of the
  basic use case, the project needs the Phase 1/2 workflow layer to feel
  meaningfully better than "just upload PDFs to a Project," or it won't get
  used.

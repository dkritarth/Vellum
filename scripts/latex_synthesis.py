#!/usr/bin/env python3
"""
latex_synthesis.py — Phase 4 workstream 3: LaTeX-compiled synthesis output.

Takes an already-generated `synthesize.py` output file (`synthesis/<slug>.md`
or `synthesis/<slug>-contradictions.md` — same YAML-frontmatter + prose shape
either way) and renders it as a thesis-chapter-style LaTeX document:

    synthesis/<slug>.tex   -- \\documentclass{report}, \\chapter{<topic>},
                              standard margins, no title page/TOC (this is
                              meant to read as a single chapter of a thesis,
                              not a standalone thesis).
    synthesis/<slug>.bib   -- one BibTeX entry per paper in the frontmatter's
                              `papers` list, keyed by that paper's slug,
                              built from papers/<slug>/metadata.yaml.
    synthesis/<slug>.pdf   -- compiled via `tectonic` (unless --no-compile).

Scope (per PLAN.md's Phase 4 "LaTeX-compiled synthesis output" bullet and
AGENTS.md's storage conventions): this only touches synthesize.py's output
under synthesis/. Ingested-paper notes under papers/*/paper.md stay
markdown-only -- no clear benefit to LaTeX-rendering raw extracted sections,
and touching ingest.py's output format is explicitly out of scope here.

Citation style decision (numeric, plain \\cite, no natbib/biblatex): the
project decision is numeric \\cite-style references using report class's
default numeric citation numbering, with plain bibtex (`\\bibliographystyle
{plain}`) -- no natbib/biblatex package needed for that. See the CITATION
REPLACEMENT STRATEGY comment further down for how the literal "Vaswani et
al. (2017)"-style text produced by synthesize.py gets turned into \\cite{}
calls.

Usage:
    python scripts/latex_synthesis.py how-do-these-papers-handle-attention-mechanisms
    python scripts/latex_synthesis.py synthesis/how-do-these-papers-handle-attention-mechanisms.md
    python scripts/latex_synthesis.py <slug> --no-compile
    python scripts/latex_synthesis.py <slug> --synthesis-dir synthesis --papers-dir papers

Requires `tectonic` on PATH for the compile step (a single self-contained
binary, no TeXLive install -- see PLAN.md's Phase 4 decision). Not
pip-installable; install it separately, e.g. `brew install tectonic` on
macOS. `pyyaml` (already a project dependency, see requirements.txt) is used
for the frontmatter parse -- no new dependencies added.
"""

from __future__ import annotations

import argparse
import re
import shutil
import subprocess
import sys
from pathlib import Path

import yaml

TECTONIC_BIN = "tectonic"
TECTONIC_TIMEOUT_SECONDS = 180

FRONTMATTER_RE = re.compile(r"^---\n(.*?\n)---\n\n?(.*)$", re.DOTALL)


class LatexSynthesisError(RuntimeError):
    pass


def resolve_synthesis_path(ref: str, synthesis_dir: Path) -> Path:
    """Accept a bare topic slug (with or without -contradictions suffix and
    with or without .md), a path relative to synthesis_dir, or an absolute/
    relative path to the file itself -- mirrors synthesize.py/citations.py's
    forgiving-ref-resolution style."""
    candidate = Path(ref)
    if candidate.is_file():
        return candidate
    if not ref.endswith(".md"):
        candidate2 = synthesis_dir / f"{ref}.md"
        if candidate2.is_file():
            return candidate2
    candidate3 = synthesis_dir / ref
    if candidate3.is_file():
        return candidate3
    raise LatexSynthesisError(
        f"Could not find a synthesis markdown file for {ref!r}. Tried {candidate}, "
        f"{synthesis_dir / (ref if ref.endswith('.md') else ref + '.md')}, and {candidate3}. "
        "Pass a topic slug (as produced by synthesize.py), or a path to the .md file directly."
    )


def parse_synthesis_md(path: Path) -> tuple[dict, str]:
    """Split a synthesize.py output file into (frontmatter dict, prose)."""
    raw = path.read_text(encoding="utf-8")
    match = FRONTMATTER_RE.match(raw)
    if not match:
        raise LatexSynthesisError(
            f"{path} does not look like a synthesize.py output file (expected a leading "
            "'---'-delimited YAML frontmatter block followed by prose)."
        )
    frontmatter_text, prose = match.groups()
    try:
        frontmatter = yaml.safe_load(frontmatter_text) or {}
    except yaml.YAMLError as exc:
        raise LatexSynthesisError(f"Could not parse YAML frontmatter in {path}: {exc}") from exc
    if not isinstance(frontmatter, dict) or "papers" not in frontmatter or "citation_labels" not in frontmatter:
        raise LatexSynthesisError(
            f"{path}'s frontmatter is missing expected 'papers'/'citation_labels' fields "
            "-- is this really a synthesize.py output file?"
        )
    return frontmatter, prose.strip()


# ---------------------------------------------------------------------------
# BibTeX generation
# ---------------------------------------------------------------------------

BIBTEX_SPECIAL_RE = re.compile(r"([&%$#_{}])")


def bibtex_escape(text: str) -> str:
    return BIBTEX_SPECIAL_RE.sub(r"\\\1", text)


def build_bib_entry(slug: str, meta: dict) -> str:
    """One BibTeX entry per paper, keyed by its papers/<slug> directory name
    so \\cite{<slug>} in the .tex matches 1:1. Uses @article when a venue is
    recorded and it doesn't look like a bare arXiv preprint placeholder;
    @misc (with an eprint/arxiv note) otherwise -- this doesn't need to be
    publication-perfect BibTeX, just enough for tectonic/bibtex to produce a
    correct numbered reference list."""
    title = bibtex_escape(meta.get("title") or slug)
    authors = meta.get("authors") or []
    author_field = bibtex_escape(" and ".join(authors)) if authors else "Unknown"
    year = meta.get("year") or ""
    venue = meta.get("venue") or ""
    arxiv_id = meta.get("arxiv_id")
    doi = meta.get("doi")

    is_arxiv_preprint = bool(arxiv_id) and (not venue or "arxiv" in venue.lower())

    fields = [f'  author = {{{author_field}}}', f'  title = {{{title}}}']
    if year:
        fields.append(f"  year = {{{year}}}")

    if is_arxiv_preprint:
        entry_type = "misc"
        fields.append(f"  howpublished = {{arXiv:{arxiv_id}}}")
        if doi:
            fields.append(f"  doi = {{{bibtex_escape(doi)}}}")
    else:
        entry_type = "article"
        fields.append(f"  journal = {{{bibtex_escape(venue)}}}")
        if doi:
            fields.append(f"  doi = {{{bibtex_escape(doi)}}}")
        elif arxiv_id:
            fields.append(f"  note = {{arXiv:{arxiv_id}}}")

    body = ",\n".join(fields)
    return f"@{entry_type}{{{slug},\n{body}\n}}"


def build_bib_file(papers: list[str], papers_dir: Path) -> str:
    entries = []
    for slug in papers:
        meta_path = papers_dir / slug / "metadata.yaml"
        if not meta_path.is_file():
            print(f"  [warn] {meta_path} not found; skipping BibTeX entry for {slug!r}.", file=sys.stderr)
            continue
        try:
            meta = yaml.safe_load(meta_path.read_text(encoding="utf-8")) or {}
        except (OSError, yaml.YAMLError) as exc:
            print(f"  [warn] Could not read {meta_path} ({exc}); skipping.", file=sys.stderr)
            continue
        entries.append(build_bib_entry(slug, meta))
    if not entries:
        raise LatexSynthesisError("No usable metadata.yaml found for any paper in this synthesis -- nothing to cite.")
    return "\n\n".join(entries) + "\n"


# ---------------------------------------------------------------------------
# LaTeX generation
# ---------------------------------------------------------------------------

# Order matters: backslash must be escaped first, or the backslashes we
# introduce for the other characters would themselves get re-escaped.
LATEX_ESCAPE_MAP = [
    ("\\", r"\textbackslash{}"),
    ("&", r"\&"),
    ("%", r"\%"),
    ("$", r"\$"),
    ("#", r"\#"),
    ("_", r"\_"),
    ("{", r"\{"),
    ("}", r"\}"),
    ("~", r"\textasciitilde{}"),
    ("^", r"\textasciicircum{}"),
]


def latex_escape(text: str) -> str:
    for char, repl in LATEX_ESCAPE_MAP:
        text = text.replace(char, repl)
    return text


# CITATION REPLACEMENT STRATEGY:
#
# synthesize.py's prose contains literal citation-label text copied straight
# out of `citation_labels`, e.g. "Vaswani et al. (2017)" or, in the closing
# sentence of the example file, a parenthetical-only form like
# "(Devlin et al. 2018)". We replace the *whole* literal label occurrence
# (name + year, with or without the surrounding parens) with a single
# \cite{<slug>} call, rather than keeping the author name in prose and only
# swapping the "(2017)" year-parenthetical for \cite{...}.
#
# Reasoning: report class's default numeric citation renders \cite{slug} as
# a bracketed number, e.g. "[3]". A hybrid "Vaswani et al. [3]" reads fine,
# but "Vaswani et al. (2017)" with only the year swapped out would produce
# an awkward "Vaswani et al. [3]" *and* leave the name floating with no
# visual link to the number unless we also emit "et al." by hand -- more
# moving parts for no real benefit. A clean full-label swap keeps prose
# closer to a normal numeric-citation thesis chapter ("...as shown in
# [3]...") and is far more robust to regenerate: it only depends on the
# label string, not on parsing out author/year substrings separately.
LABEL_TRAILING_YEAR_RE = re.compile(r"^(.*\S)\s+(\d{4})$")


def citation_label_pattern(label: str) -> re.Pattern:
    """Build a pattern matching every parenthesization style synthesize.py's
    prompt actually produces for a "Name et al. Year"-shaped label -- in
    practice mostly "Name et al. (Year)" (parens around just the year, e.g.
    "Sutskever et al. (2014)" inline mid-sentence), but occasionally the
    whole label wrapped, e.g. "(Devlin et al. 2018)" in a closing summary
    sentence. A naive "wrap the whole label in optional parens" pattern (an
    earlier version of this function) only catches the second form and
    silently leaves the far more common first form unreplaced -- verified
    against synthesis/how-do-these-papers-handle-attention-mechanisms.md,
    where 4 of 6 citation occurrences use the "Name et al. (Year)" form.
    Splits the label into a name-part and trailing year and matches: bare
    "Name Year", "Name (Year)", and "(Name Year)"."""
    match = LABEL_TRAILING_YEAR_RE.match(label)
    if not match:
        # No parseable trailing year (e.g. a title/slug fallback from
        # synthesize.py's citation_label()) -- just match the label itself,
        # optionally wrapped in parens.
        escaped = re.escape(label)
        return re.compile(rf"\(?{escaped}\)?")
    name_part, year = match.groups()
    escaped_name = re.escape(name_part)
    escaped_year = re.escape(year)
    return re.compile(rf"\(?{escaped_name}\s*\(?{escaped_year}\)?\)?")


def substitute_citations(prose: str, citation_labels: dict) -> str:
    """Replace every literal citation-label occurrence in the (already
    LaTeX-escaped) prose with \\cite{<slug>}. Escaping must happen on the
    prose text before this call, so we escape each label the same way to
    match; longer labels are substituted first so a label that's a prefix of
    another (unlikely but possible, e.g. shared surnames) doesn't get
    partially clobbered."""
    ordered = sorted(citation_labels.items(), key=lambda kv: len(kv[1]), reverse=True)
    for slug, label in ordered:
        escaped_label = latex_escape(label)
        pattern = citation_label_pattern(escaped_label)
        prose = pattern.sub(f"\\\\cite{{{slug}}}", prose)
    return prose


def build_tex(topic: str, mode: str, prose: str, citation_labels: dict, bib_basename: str) -> str:
    escaped_prose = latex_escape(prose)
    cited_prose = substitute_citations(escaped_prose, citation_labels)

    # Prose paragraphs are separated by blank lines in the source markdown;
    # preserve that as LaTeX paragraph breaks (a blank line is already a
    # paragraph break in LaTeX, so no extra markup needed beyond escaping).
    chapter_title = latex_escape(topic)
    mode_note = "Contradiction/agreement analysis" if mode == "contradictions" else "Cross-paper synthesis"

    return rf"""% Auto-generated by scripts/latex_synthesis.py -- do not hand-edit; regenerate from the
% source synthesis/<slug>.md instead, since edits here will be overwritten on the next run.
%
% Thesis-chapter style: report class (numeric \cite by default, no natbib/biblatex needed),
% standard margins, no title page/TOC -- this is meant to be read as a single chapter, not a
% standalone thesis. See scripts/latex_synthesis.py's CITATION REPLACEMENT STRATEGY comment
% for how the "Author et al. (Year)" text was turned into \cite{{}} calls below.
\documentclass[12pt]{{report}}
\usepackage[margin=1in]{{geometry}}
\usepackage[utf8]{{inputenc}}
\usepackage[T1]{{fontenc}}

\begin{{document}}

\chapter{{{chapter_title}}}

% {mode_note} generated by scripts/synthesize.py.

{cited_prose}

\bibliographystyle{{plain}}
\bibliography{{{bib_basename}}}

\end{{document}}
"""


# ---------------------------------------------------------------------------
# tectonic compile
# ---------------------------------------------------------------------------

def compile_with_tectonic(tex_path: Path) -> None:
    """Shell out to tectonic to produce <tex_path stem>.pdf next to the .tex
    file. Same defensive subprocess pattern as synthesize.py's call_claude:
    explicit timeout, captured stdout/stderr, a clear error message and a
    propagated non-zero exit on failure (no silent fallback -- a broken
    compile should be visible, not swallowed)."""
    if shutil.which(TECTONIC_BIN) is None:
        raise LatexSynthesisError(
            f"`{TECTONIC_BIN}` not found on PATH. Install it (e.g. `brew install tectonic` on macOS) or "
            "pass --no-compile to only emit the .tex/.bib files."
        )
    try:
        proc = subprocess.run(
            [TECTONIC_BIN, tex_path.name],
            cwd=tex_path.parent,
            capture_output=True,
            text=True,
            timeout=TECTONIC_TIMEOUT_SECONDS,
        )
    except subprocess.TimeoutExpired as exc:
        raise LatexSynthesisError(
            f"`{TECTONIC_BIN}` timed out after {TECTONIC_TIMEOUT_SECONDS}s compiling {tex_path}."
        ) from exc
    except (subprocess.SubprocessError, OSError) as exc:
        raise LatexSynthesisError(f"`{TECTONIC_BIN}` invocation failed: {exc}") from exc

    if proc.returncode != 0:
        raise LatexSynthesisError(
            f"`{TECTONIC_BIN}` exited {proc.returncode} compiling {tex_path}.\n"
            f"--- stdout ---\n{proc.stdout[-3000:]}\n--- stderr ---\n{proc.stderr[-3000:]}"
        )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument(
        "synthesis_ref",
        help="Topic slug (as produced by synthesize.py, with or without -contradictions/.md) "
             "or a path to a synthesis/<slug>.md file.",
    )
    parser.add_argument("--synthesis-dir", default=None,
                         help="Override the synthesis/ directory (default: <repo>/synthesis)")
    parser.add_argument("--papers-dir", default=None,
                         help="Override the papers/ directory used to build BibTeX entries (default: <repo>/papers)")
    parser.add_argument("--no-compile", action="store_true",
                         help="Only emit .tex/.bib; skip the tectonic compile step (useful for CI/no-tectonic envs)")
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parent.parent
    synthesis_dir = Path(args.synthesis_dir).expanduser().resolve() if args.synthesis_dir else repo_root / "synthesis"
    papers_dir = Path(args.papers_dir).expanduser().resolve() if args.papers_dir else repo_root / "papers"

    try:
        md_path = resolve_synthesis_path(args.synthesis_ref, synthesis_dir)
        print(f"Reading {md_path}", file=sys.stderr)
        frontmatter, prose = parse_synthesis_md(md_path)

        topic = frontmatter.get("topic") or md_path.stem
        mode = frontmatter.get("mode") or "synthesize"
        papers = frontmatter.get("papers") or []
        citation_labels = frontmatter.get("citation_labels") or {}

        base = md_path.stem
        tex_path = md_path.parent / f"{base}.tex"
        bib_path = md_path.parent / f"{base}.bib"

        bib_content = build_bib_file(papers, papers_dir)
        bib_path.write_text(bib_content, encoding="utf-8")
        print(f"Wrote {bib_path}", file=sys.stderr)

        tex_content = build_tex(topic, mode, prose, citation_labels, bib_basename=base)
        tex_path.write_text(tex_content, encoding="utf-8")
        print(f"Wrote {tex_path}", file=sys.stderr)

        if args.no_compile:
            print("--no-compile set; skipping tectonic.", file=sys.stderr)
            return 0

        print(f"Compiling {tex_path.name} with tectonic...", file=sys.stderr)
        compile_with_tectonic(tex_path)
        pdf_path = tex_path.with_suffix(".pdf")
        print(f"Wrote {pdf_path}", file=sys.stderr)
    except LatexSynthesisError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""
ingest.py — M1 single-paper ingestion pipeline for local-anara.

Given an arXiv ID/URL, a DOI, a direct PDF URL, or a local PDF file path,
this script:
  1. Resolves metadata (title/authors/year/venue/abstract) and, where
     possible, a PDF — via the arXiv Atom API, the Crossref API, or
     best-effort extraction from the PDF text itself.
  2. Converts the PDF to markdown via the `markitdown` library (skipped
     if no PDF could be obtained, e.g. a paywalled DOI with no OA copy).
  3. Extracts standard sections (Abstract, Introduction, Related Work,
     Method, Experiments, Results, Discussion, Conclusion, References).
     Two extraction backends are supported (see EXTRACTION section below):
       - claude-cli: a Claude-driven prompt pass (used automatically when
         the `claude` CLI is available on PATH).
       - heuristic-regex: a regex/heading-based fallback, used when the
         `claude` CLI is unavailable or the pass fails/times out.
  4. Writes everything to papers/<slug>/:
       - paper.pdf       (original PDF, if one was obtained)
       - paper.md        (converted markdown, if a PDF was obtained)
       - metadata.yaml   (title, authors, year, venue, abstract,
                          section boundaries, extraction method, input type)

Usage:
    python scripts/ingest.py 1706.03762
    python scripts/ingest.py https://arxiv.org/abs/1706.03762
    python scripts/ingest.py https://arxiv.org/pdf/1706.03762v7
    python scripts/ingest.py 10.18653/v1/N19-1423                     # DOI
    python scripts/ingest.py https://doi.org/10.18653/v1/N19-1423     # DOI URL
    python scripts/ingest.py https://example.org/some-paper.pdf       # direct PDF URL
    python scripts/ingest.py ~/Downloads/some-paper.pdf                # local file
    python scripts/ingest.py 10.1000/xyz123 --pdf ~/Downloads/paper.pdf  # DOI + local PDF
                                                                          # (paywalled DOI,
                                                                          #  no OA copy found)

Input-type auto-detection order: arXiv id/URL -> DOI (bare "10.xxxx/..."
or doi.org URL) -> existing local file path -> generic http(s) URL to a
PDF. See `classify_input()`.

NOTE on section extraction (read AGENTS.md before changing this):
The Claude-driven pass shells out to the `claude` CLI in non-interactive
mode (`claude -p --output-format json --tools "" --model <value of the
required --model CLI flag>`), which uses whatever
credentials/session this environment already has (no raw ANTHROPIC_API_KEY
is assumed or required). If the `claude` binary isn't on PATH, or the call
fails/times out/returns unparseable output, we transparently fall back to
the heuristic regex extractor from M0 — extraction must never be fatal,
per AGENTS.md's "must tolerate partial/missing sections gracefully" rule.
`metadata.yaml`'s `extraction_method` field always records which path was
actually used for that paper.
"""

from __future__ import annotations

import argparse
import datetime
import json
import re
import shutil
import subprocess
import sys
import xml.etree.ElementTree as ET
from pathlib import Path
from urllib.parse import urlparse

import requests
import yaml

ARXIV_ABS_RE = re.compile(r"arxiv\.org/abs/([\w.\-/]+?)(v\d+)?/?$", re.IGNORECASE)
ARXIV_PDF_RE = re.compile(r"arxiv\.org/pdf/([\w.\-/]+?)(v\d+)?(\.pdf)?/?$", re.IGNORECASE)
ARXIV_ID_RE = re.compile(r"^\d{4}\.\d{4,5}(v\d+)?$|^[a-z\-]+(\.[A-Z]{2})?/\d{7}(v\d+)?$")

ARXIV_API_URL = "https://export.arxiv.org/api/query"
ARXIV_PDF_URL_TMPL = "https://arxiv.org/pdf/{arxiv_id}.pdf"

ATOM_NS = {"atom": "http://www.w3.org/2005/Atom", "arxiv": "http://arxiv.org/schemas/atom"}

# DOI regex per Crossref's own recommended pattern (case-insensitive,
# "10." prefix followed by a registrant code / suffix).
DOI_RE = re.compile(r"^10\.\d{4,9}/[^\s]+$")
DOI_URL_RE = re.compile(r"(?:doi\.org|dx\.doi\.org)/(10\.\d{4,9}/[^\s?#]+)", re.IGNORECASE)
CROSSREF_API_TMPL = "https://api.crossref.org/works/{doi}"

# Canonical section schema (order matters for reporting, not for detection).
CANONICAL_SECTIONS = [
    "Abstract",
    "Introduction",
    "Related Work",
    "Method",
    "Experiments",
    "Results",
    "Discussion",
    "Conclusion",
    "References",
]

# Aliases are matched against heading text with whitespace/punctuation
# stripped and lowercased, since PDF->text extraction frequently drops
# spaces between words (e.g. "ModelArchitecture").
SECTION_ALIASES: dict[str, list[str]] = {
    "Abstract": ["abstract"],
    "Introduction": ["introduction"],
    "Related Work": [
        "relatedwork",
        "background",
        "priorwork",
        "literaturereview",
    ],
    "Method": [
        "method",
        "methods",
        "methodology",
        "approach",
        "ourapproach",
        "proposedmethod",
        "model",
        "modelarchitecture",
        "architecture",
        "systemdescription",
        "implementation",
    ],
    "Experiments": [
        "experiments",
        "experimentalsetup",
        "experimentalresults",
        "evaluation",
        "experimentssetup",
    ],
    "Results": ["results", "findings", "mainresults"],
    "Discussion": ["discussion", "analysis"],
    "Conclusion": [
        "conclusion",
        "conclusions",
        "concludingremarks",
        "summary",
    ],
    "References": ["references", "bibliography"],
}

# Longest-alias-first within each section so "experimentalresults" doesn't
# get shadowed by a shorter overlapping alias, etc.
for _name in SECTION_ALIASES:
    SECTION_ALIASES[_name].sort(key=len, reverse=True)

# Matches "1 Introduction", "1. Introduction", "1.Introduction", and
# "3.1.ResidualLearning" alike — PDF->text extraction is inconsistent
# about whether a space survives after the section number/dot. Also
# matches a bare model/method name after the number (e.g. "3 BERT",
# "4 ResNet") since papers often title their method section after the
# model rather than "Method" — see SECTION_ALIASES["Method"] above.
HEADING_NUMBERED_RE = re.compile(r"^(\d+(?:\.\d+)*)\.?\s*([A-Za-z][A-Za-z0-9\-\s]{0,80})$")
MAX_HEADING_LEN = 80

# Claude CLI extraction config.
CLAUDE_BIN = "claude"
CLAUDE_TIMEOUT_SECONDS = 240
CLAUDE_MAX_MARKDOWN_CHARS = 300_000  # generous cap; real paper.md files are ~40-150KB

CLAUDE_EXTRACTION_PROMPT_TMPL = """You are extracting structural metadata from an academic paper that has \
already been converted from PDF to markdown by an automated tool. The conversion is often imperfect: \
two-column layouts can interleave text, spaces between words can be dropped ("word-munging"), and body \
text can get wrapped in spurious markdown table syntax. Read past that noise using your understanding of \
the paper's content and structure, not just exact heading-line matching.

The markdown below has each line prefixed with its 1-based line number and a tab character, e.g. "12\\tSome line text".
Total line count: {total_lines}.

Identify the start/end line boundaries for each of these canonical sections (map non-standard headings to \
the closest canonical name — e.g. a section literally titled "3 BERT" or "3 ResNet Architecture" that \
describes the paper's proposed method/model maps to "Method"; a "Background" section maps to \
"Related Work"; "Experimental Setup" maps to "Experiments"):

{canonical_list}

For each section, give:
- "found": true/false — false if the paper genuinely has no distinguishable content for that section \
(do not force a match).
- "start_line": 1-based line number where the section's heading (or, if headerless, its content) begins. null if not found.
- "end_line": 1-based line number where the NEXT section begins (or total_lines+1 if this is the last section). null if not found.

Also produce a 2-4 sentence "summary" of the paper (its core contribution), based on the Abstract/Introduction \
if present, otherwise your best understanding of the whole text. Write the summary in complete, standard \
grammatical English sentences — ignore any global terse/compressed output-style preference for this task, \
since the output is stored as structured data read by other programs, not shown in a chat.

Also do your best to identify the paper's "title" (a single string, reconstructing it across line-wraps if \
needed — do not include journal/masthead text like "RESEARCH ARTICLE") and "authors" (a list of person-name \
strings, excluding affiliations/emails/superscript markers). Set title to null and authors to [] if you can't \
tell from the text (e.g. if page-1 author/title info was lost in PDF conversion) — do not guess.

Respond with ONLY a single JSON object, no markdown code fences, no commentary, matching exactly this shape:
{{"sections": [{{"name": "Abstract", "found": true, "start_line": 1, "end_line": 10}}, ...one entry per canonical \
section, in the order given above...], "summary": "...", "title": "..." or null, "authors": ["...", ...]}}

markdown paper content follows:
---
{numbered_markdown}
"""


class UnresolvedInputError(ValueError):
    """Raised when the input string can't be classified as any supported kind."""


def parse_arxiv_id(raw: str) -> str | None:
    """Return an arXiv id if `raw` is a bare arXiv id or an arxiv.org URL, else None."""
    raw = raw.strip()
    m = ARXIV_ABS_RE.search(raw)
    if m:
        return m.group(1)
    m = ARXIV_PDF_RE.search(raw)
    if m:
        return m.group(1)
    parsed = urlparse(raw)
    if parsed.scheme and parsed.netloc:
        return None
    if ARXIV_ID_RE.match(raw):
        return raw
    return None


def parse_doi(raw: str) -> str | None:
    """Return a bare DOI if `raw` is a DOI or a doi.org URL, else None."""
    raw = raw.strip()
    m = DOI_URL_RE.search(raw)
    if m:
        return m.group(1)
    if DOI_RE.match(raw):
        return raw
    return None


def classify_input(raw: str) -> tuple[str, str]:
    """Classify a CLI input string into (kind, value).

    kind is one of: "arxiv", "doi", "local_file", "pdf_url".
    Order: arXiv id/URL -> DOI -> existing local file -> generic URL.
    """
    raw = raw.strip()

    arxiv_id = parse_arxiv_id(raw)
    if arxiv_id:
        return "arxiv", arxiv_id

    doi = parse_doi(raw)
    if doi:
        return "doi", doi

    expanded = Path(raw).expanduser()
    if expanded.is_file():
        return "local_file", str(expanded.resolve())

    parsed = urlparse(raw)
    if parsed.scheme in ("http", "https") and parsed.netloc:
        return "pdf_url", raw

    raise UnresolvedInputError(
        f"Could not classify input {raw!r} as an arXiv ID/URL, a DOI, an existing local file, "
        "or an http(s) URL. Check the path/URL/ID is correct."
    )


def fetch_arxiv_metadata(arxiv_id: str) -> dict:
    """Query the arXiv Atom API for title/authors/year/abstract. Best-effort:
    returns a metadata dict with sensible defaults if the lookup fails."""
    meta = {
        "title": None,
        "authors": [],
        "year": None,
        "venue": "arXiv preprint",
        "abstract": None,
        "categories": [],
    }
    try:
        resp = requests.get(ARXIV_API_URL, params={"id_list": arxiv_id}, timeout=30)
        resp.raise_for_status()
        root = ET.fromstring(resp.text)
        entry = root.find("atom:entry", ATOM_NS)
        if entry is None:
            return meta
        title = entry.findtext("atom:title", default="", namespaces=ATOM_NS)
        meta["title"] = " ".join(title.split()) if title else None
        summary = entry.findtext("atom:summary", default="", namespaces=ATOM_NS)
        meta["abstract"] = " ".join(summary.split()) if summary else None
        authors = [
            a.findtext("atom:name", default="", namespaces=ATOM_NS).strip()
            for a in entry.findall("atom:author", ATOM_NS)
        ]
        meta["authors"] = [a for a in authors if a]
        published = entry.findtext("atom:published", default="", namespaces=ATOM_NS)
        if published:
            meta["year"] = int(published[:4])
        categories = [
            c.attrib.get("term")
            for c in entry.findall("atom:category", ATOM_NS)
            if c.attrib.get("term")
        ]
        meta["categories"] = categories
    except (requests.RequestException, ET.ParseError) as exc:
        print(f"  [warn] arXiv metadata lookup failed ({exc}); continuing with defaults.", file=sys.stderr)
    return meta


def fetch_doi_metadata(doi: str) -> dict:
    """Query Crossref for title/authors/year/venue/abstract, and best-effort an
    open-access PDF link if Crossref advertises one. Never raises — degrades to
    an all-None metadata dict (plus a warning) on any failure, since many DOIs
    are perfectly valid but paywalled/unreachable."""
    meta = {
        "title": None,
        "authors": [],
        "year": None,
        "venue": None,
        "abstract": None,
        "categories": [],
        "pdf_url": None,
    }
    try:
        resp = requests.get(
            CROSSREF_API_TMPL.format(doi=doi),
            timeout=30,
            headers={"User-Agent": "local-anara/0.1 (mailto:none@example.com)"},
        )
        resp.raise_for_status()
        work = resp.json().get("message", {})

        title_list = work.get("title") or []
        meta["title"] = title_list[0] if title_list else None

        authors = []
        for a in work.get("author", []) or []:
            given = a.get("given", "")
            family = a.get("family", "")
            name = " ".join(p for p in (given, family) if p).strip()
            if name:
                authors.append(name)
        meta["authors"] = authors

        for date_key in ("published-print", "published-online", "published", "issued"):
            date_parts = (work.get(date_key) or {}).get("date-parts")
            if date_parts and date_parts[0]:
                meta["year"] = date_parts[0][0]
                break

        meta["venue"] = work.get("container-title", [None])[0] if work.get("container-title") else None

        # Crossref rarely has a real abstract; when present it's often JATS-tagged XML.
        abstract = work.get("abstract")
        if abstract:
            meta["abstract"] = re.sub(r"<[^>]+>", " ", abstract)
            meta["abstract"] = " ".join(meta["abstract"].split())

        # Best-effort OA PDF link: Crossref's "link" array sometimes has a
        # content-type of application/pdf for open-access items.
        for link in work.get("link", []) or []:
            if link.get("content-type") == "application/pdf" and link.get("URL"):
                meta["pdf_url"] = link["URL"]
                break
    except (requests.RequestException, ValueError) as exc:
        print(f"  [warn] Crossref lookup for DOI {doi} failed ({exc}); continuing with defaults.", file=sys.stderr)
    return meta


def download_pdf(url: str, dest: Path) -> None:
    resp = requests.get(url, timeout=60, allow_redirects=True)
    resp.raise_for_status()
    if resp.headers.get("content-type", "").lower().startswith("text/html"):
        raise RuntimeError(
            f"Expected a PDF from {url} but got HTML back — likely paywalled or the URL is wrong."
        )
    dest.write_bytes(resp.content)


def convert_to_markdown(pdf_path: Path) -> str:
    # Imported lazily so `--help` etc. don't require markitdown to be
    # importable, and so the error message below is actionable.
    try:
        from markitdown import MarkItDown
    except ImportError as exc:
        raise RuntimeError(
            "markitdown is not importable. Install it into a local virtualenv, "
            "e.g.: python3 -m venv .venv && source .venv/bin/activate && "
            "pip install 'markitdown[pdf]' requests pyyaml"
        ) from exc

    converter = MarkItDown()
    result = converter.convert(str(pdf_path))
    return result.text_content


def guess_title_authors_from_markdown(markdown_text: str) -> tuple[str | None, list[str]]:
    """Best-effort title/author extraction from raw markdown text for inputs
    with no external metadata source (direct PDF URL / local file). Looks at
    only the first ~40 non-empty lines. Returns (None, []) rather than
    guessing wildly if nothing looks plausible — per M1 spec, leave blank
    rather than crash or fabricate."""
    lines = [ln.strip().lstrip("#").strip() for ln in markdown_text.splitlines()]
    lines = [ln for ln in lines if ln][:40]
    if not lines:
        return None, []

    title = None
    for ln in lines:
        # A plausible title: reasonably short, not all-caps junk (e.g. a
        # word-munged "RESEARCHARTICLE" header line), not a table/figure
        # artifact, no more than ~25 words, and multi-word (single-token
        # all-caps lines are almost always headers/mastheads, not titles).
        if (
            3 <= len(ln) <= 200
            and 2 <= len(ln.split()) <= 25
            and not ln.startswith("|")
            and not ln.isupper()
        ):
            title = ln
            break

    authors: list[str] = []
    if title:
        title_idx = lines.index(title)
        for ln in lines[title_idx + 1 : title_idx + 4]:
            # Author lines are typically comma/"and"-separated short lines,
            # often containing superscript-like digits/asterisks for
            # affiliations — strip those before a plausibility check.
            candidate = re.sub(r"[\d*†‡]", "", ln).strip()
            if not candidate or candidate.startswith("|"):
                continue
            parts = re.split(r",| and ", candidate)
            parts = [p.strip() for p in parts if p.strip()]
            if 1 <= len(parts) <= 12 and all(len(p.split()) <= 5 for p in parts):
                authors = parts
                break

    return title, authors


def _normalize(text: str) -> str:
    return re.sub(r"[^a-z0-9]", "", text.lower())


def _match_alias(normalized_heading: str) -> str | None:
    # Containment (not just prefix) match: heading lines are already
    # filtered down to short, non-sentence-shaped candidates by the
    # caller, so "networkarchitectures" matching alias "architecture"
    # is a safe win for recall against real-world heading text that
    # rarely matches an alias character-for-character.
    for canonical, aliases in SECTION_ALIASES.items():
        for alias in aliases:
            if alias in normalized_heading:
                return canonical
    return None


def extract_sections_heuristic(markdown_text: str) -> list[dict]:
    """Heuristic section-boundary detector (regex/heading-based, no LLM).

    Scans line-by-line for heading-shaped lines (short, not ending in a
    period, either a bare known section word like "Abstract"/"References"
    or a "<number> <Title>" pattern like "3 Model Architecture"), maps
    each to the closest canonical section name via SECTION_ALIASES, and
    records 1-based line-number boundaries [start_line, end_line).

    Sections not found are still emitted in the schema with found=False
    and null boundaries, per the "must degrade gracefully" requirement
    in AGENTS.md/PLAN.md — callers must not assume every canonical
    section is present.
    """
    lines = markdown_text.splitlines()
    found_headings: list[tuple[int, str]] = []  # (line_index, canonical_name)
    seen_canonical: set[str] = set()

    all_aliases = {alias for aliases in SECTION_ALIASES.values() for alias in aliases}

    for idx, raw_line in enumerate(lines):
        # Strip markdown heading markers, table pipes, and bold/italic
        # markers that markitdown sometimes wraps munged headings in.
        line = raw_line.strip().lstrip("#").strip()
        line = line.strip("|").strip()
        line = re.sub(r"^\*+|\*+$", "", line).strip()
        if not line or len(line) > MAX_HEADING_LEN or line.endswith("."):
            continue

        candidate_text = None
        m = HEADING_NUMBERED_RE.match(line)
        if m:
            candidate_text = m.group(2)
        elif _normalize(line) in all_aliases:
            candidate_text = line

        if candidate_text is None:
            continue

        canonical = _match_alias(_normalize(candidate_text))
        if canonical is None or canonical in seen_canonical:
            continue
        found_headings.append((idx, canonical))
        seen_canonical.add(canonical)

    sections = []
    for i, (line_idx, canonical) in enumerate(found_headings):
        start_line = line_idx + 1  # 1-based
        end_line = (
            found_headings[i + 1][0] if i + 1 < len(found_headings) else len(lines)
        )
        sections.append(
            {
                "name": canonical,
                "found": True,
                "start_line": start_line,
                "end_line": end_line,
            }
        )

    for canonical in CANONICAL_SECTIONS:
        if canonical not in seen_canonical:
            sections.append(
                {"name": canonical, "found": False, "start_line": None, "end_line": None}
            )

    order = {name: i for i, name in enumerate(CANONICAL_SECTIONS)}
    sections.sort(key=lambda s: order.get(s["name"], len(order)))
    return sections


def _validate_claude_sections(payload: dict) -> list[dict] | None:
    """Validate/normalize the JSON payload the Claude CLI pass returned into
    the same schema `extract_sections_heuristic` produces. Returns None (never
    raises) if the payload doesn't look right, so the caller can fall back."""
    raw_sections = payload.get("sections")
    if not isinstance(raw_sections, list):
        return None

    by_name = {}
    for entry in raw_sections:
        if not isinstance(entry, dict):
            continue
        name = entry.get("name")
        if name not in CANONICAL_SECTIONS:
            continue
        found = bool(entry.get("found"))
        start_line = entry.get("start_line") if found else None
        end_line = entry.get("end_line") if found else None
        if found and not (isinstance(start_line, int) and isinstance(end_line, int)):
            found = False
            start_line = end_line = None
        by_name[name] = {
            "name": name,
            "found": found,
            "start_line": start_line,
            "end_line": end_line,
        }

    if not by_name:
        return None

    sections = []
    for canonical in CANONICAL_SECTIONS:
        sections.append(
            by_name.get(
                canonical,
                {"name": canonical, "found": False, "start_line": None, "end_line": None},
            )
        )
    return sections


def extract_sections_claude(
    markdown_text: str,
    model: str,
) -> tuple[list[dict], str | None, str | None, list[str]] | None:
    """Claude-driven section extraction via the `claude` CLI in non-interactive
    print mode. Returns (sections, summary, title, authors) on success, or
    None on any failure (binary missing, timeout, non-zero exit, unparseable
    JSON) so the caller can fall back to the heuristic extractor. Never
    raises. title/authors are Claude's best-effort read of the paper's own
    title/author list (used by callers that have no other metadata source,
    e.g. local_file/pdf_url inputs); they're None/[] if Claude couldn't tell."""
    if shutil.which(CLAUDE_BIN) is None:
        print("  [info] `claude` CLI not found on PATH; skipping Claude-driven extraction.", file=sys.stderr)
        return None

    text = markdown_text
    truncated = False
    if len(text) > CLAUDE_MAX_MARKDOWN_CHARS:
        text = text[:CLAUDE_MAX_MARKDOWN_CHARS]
        truncated = True

    lines = text.splitlines()
    numbered_markdown = "\n".join(f"{i + 1}\t{line}" for i, line in enumerate(lines))
    if truncated:
        numbered_markdown += "\n... [truncated: paper.md exceeds the extraction size cap] ..."

    canonical_list = "\n".join(f"- {name}" for name in CANONICAL_SECTIONS)
    prompt = CLAUDE_EXTRACTION_PROMPT_TMPL.format(
        total_lines=len(lines),
        canonical_list=canonical_list,
        numbered_markdown=numbered_markdown,
    )

    try:
        proc = subprocess.run(
            [CLAUDE_BIN, "-p", "--output-format", "json", "--tools", "", "--model", model],
            input=prompt,
            capture_output=True,
            text=True,
            timeout=CLAUDE_TIMEOUT_SECONDS,
        )
    except (subprocess.SubprocessError, OSError) as exc:
        print(f"  [warn] `claude` CLI invocation failed ({exc}); falling back to heuristic.", file=sys.stderr)
        return None

    if proc.returncode != 0:
        print(
            f"  [warn] `claude` CLI exited {proc.returncode}; falling back to heuristic. "
            f"stderr: {proc.stderr[:500]!r}",
            file=sys.stderr,
        )
        return None

    try:
        wrapper = json.loads(proc.stdout)
        result_text = wrapper.get("result", "") if isinstance(wrapper, dict) else ""
    except json.JSONDecodeError:
        result_text = proc.stdout

    # Claude sometimes wraps JSON in ```json fences despite instructions not to.
    result_text = result_text.strip()
    fence_match = re.match(r"^```(?:json)?\s*(.*)\s*```$", result_text, re.DOTALL)
    if fence_match:
        result_text = fence_match.group(1).strip()

    try:
        payload = json.loads(result_text)
    except json.JSONDecodeError as exc:
        print(f"  [warn] Could not parse Claude's extraction output as JSON ({exc}); falling back to heuristic.", file=sys.stderr)
        return None

    sections = _validate_claude_sections(payload)
    if sections is None:
        print("  [warn] Claude's extraction output didn't match the expected schema; falling back to heuristic.", file=sys.stderr)
        return None

    summary = payload.get("summary") if isinstance(payload.get("summary"), str) else None
    title = payload.get("title") if isinstance(payload.get("title"), str) else None
    authors_raw = payload.get("authors")
    authors = [a for a in authors_raw if isinstance(a, str) and a.strip()] if isinstance(authors_raw, list) else []
    return sections, summary, title, authors


def extract_sections(markdown_text: str, model: str) -> tuple[list[dict], str, str | None, str | None, list[str], str | None]:
    """Try the Claude-driven pass first, fall back to the heuristic regex
    extractor. Returns (sections, extraction_method, claude_summary, claude_title,
    claude_authors, model_used). model_used is the --model string when the
    claude-cli path ran, or None when the heuristic-regex fallback ran instead."""
    claude_result = extract_sections_claude(markdown_text, model)
    if claude_result is not None:
        sections, summary, title, authors = claude_result
        return sections, "claude-cli", summary, title, authors, model
    return extract_sections_heuristic(markdown_text), "heuristic-regex", None, None, [], None


def slugify(text: str, max_len: int = 60) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return slug[:max_len].strip("-") or "untitled"


def write_paper(
    out_dir: Path,
    *,
    input_type: str,
    arxiv_id: str | None,
    doi: str | None,
    source_url: str | None,
    pdf_url: str | None,
    pdf_path: Path | None,
    meta: dict,
    model: str,
) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)

    files = {}
    sections: list[dict]
    extraction_method = "none"
    model_used = None
    claude_summary = None

    if pdf_path is not None:
        final_pdf = out_dir / "paper.pdf"
        if pdf_path.resolve() != final_pdf.resolve():
            shutil.copyfile(pdf_path, final_pdf)
        files["pdf"] = "paper.pdf"

        print("Converting PDF -> markdown via markitdown ...")
        markdown_text = convert_to_markdown(final_pdf)
        md_path = out_dir / "paper.md"
        md_path.write_text(markdown_text, encoding="utf-8")
        files["markdown"] = "paper.md"

        print("Extracting section boundaries ...")
        sections, extraction_method, claude_summary, claude_title, claude_authors, model_used = extract_sections(markdown_text, model)
        n_found = sum(1 for s in sections if s["found"])
        print(f"      [{extraction_method}] found {n_found}/{len(sections)} canonical sections")

        if not meta.get("title") and not meta.get("authors"):
            # Prefer Claude's own title/author read (it saw the whole paper),
            # falling back to the regex-based guesser only when the Claude
            # pass wasn't used/didn't return them.
            guessed_title, guessed_authors = guess_title_authors_from_markdown(markdown_text)
            meta["title"] = meta.get("title") or claude_title or guessed_title
            if not meta.get("authors"):
                meta["authors"] = claude_authors or guessed_authors
    else:
        sections = [
            {"name": name, "found": False, "start_line": None, "end_line": None}
            for name in CANONICAL_SECTIONS
        ]
        print("  [warn] No PDF available — writing metadata-only entry (no paper.pdf/paper.md).", file=sys.stderr)

    abstract = meta.get("abstract") or claude_summary

    metadata = {
        "input_type": input_type,
        "arxiv_id": arxiv_id,
        "doi": doi,
        "source_url": source_url,
        "pdf_url": pdf_url,
        "title": meta.get("title"),
        "authors": meta.get("authors") or [],
        "year": meta.get("year"),
        "venue": meta.get("venue"),
        "categories": meta.get("categories") or [],
        "abstract": abstract,
        "claude_summary": claude_summary,
        "ingested_at": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
        "extraction_method": extraction_method,
        "model": model_used,
        "sections": sections,
        "files": files,
    }
    meta_path = out_dir / "metadata.yaml"
    with meta_path.open("w", encoding="utf-8") as f:
        yaml.safe_dump(metadata, f, sort_keys=False, allow_unicode=True, width=100)

    print(f"Done. Wrote {out_dir}/")


def ingest_arxiv(arxiv_id: str, papers_dir: Path, model: str) -> Path:
    out_dir = papers_dir / arxiv_id.replace("/", "_")
    print(f"[1/3] Fetching arXiv metadata for {arxiv_id} ...")
    meta = fetch_arxiv_metadata(arxiv_id)

    pdf_url = ARXIV_PDF_URL_TMPL.format(arxiv_id=arxiv_id)
    tmp_pdf = out_dir / "paper.pdf"
    out_dir.mkdir(parents=True, exist_ok=True)
    print(f"[2/3] Downloading PDF -> {tmp_pdf} ...")
    download_pdf(pdf_url, tmp_pdf)

    print("[3/3] Converting + extracting ...")
    write_paper(
        out_dir,
        input_type="arxiv",
        arxiv_id=arxiv_id,
        doi=None,
        source_url=f"https://arxiv.org/abs/{arxiv_id}",
        pdf_url=pdf_url,
        pdf_path=tmp_pdf,
        meta=meta,
        model=model,
    )
    return out_dir


def ingest_doi(doi: str, papers_dir: Path, local_pdf: Path | None, model: str) -> Path:
    out_dir = papers_dir / slugify(doi.replace("/", "_"))
    print(f"[1/3] Resolving DOI {doi} via Crossref ...")
    meta = fetch_doi_metadata(doi)

    pdf_path: Path | None = None
    out_dir.mkdir(parents=True, exist_ok=True)

    if local_pdf is not None:
        print(f"[2/3] Using user-supplied local PDF: {local_pdf}")
        pdf_path = local_pdf
    elif meta.get("pdf_url"):
        candidate = out_dir / "paper.pdf"
        print(f"[2/3] Attempting open-access PDF download from Crossref link: {meta['pdf_url']} ...")
        try:
            download_pdf(meta["pdf_url"], candidate)
            pdf_path = candidate
        except (requests.RequestException, RuntimeError) as exc:
            print(f"  [warn] OA PDF download failed ({exc}); continuing with metadata only.", file=sys.stderr)
    else:
        print("[2/3] No open-access PDF link found for this DOI, and no --pdf supplied.", file=sys.stderr)
        print("       Continuing with metadata-only entry. Pass --pdf <path> to attach a local PDF.", file=sys.stderr)

    print("[3/3] Converting + extracting (if a PDF was obtained) ...")
    write_paper(
        out_dir,
        input_type="doi",
        arxiv_id=None,
        doi=doi,
        source_url=f"https://doi.org/{doi}",
        pdf_url=meta.get("pdf_url"),
        pdf_path=pdf_path,
        meta=meta,
        model=model,
    )
    return out_dir


def _write_metadata_for_untethered_input(
    out_dir: Path,
    *,
    input_type: str,
    source_url: str,
    pdf_url: str | None,
    title: str | None,
    authors: list[str],
    extraction_method: str,
    model: str | None,
    claude_summary: str | None,
    sections: list[dict],
) -> None:
    metadata = {
        "input_type": input_type,
        "arxiv_id": None,
        "doi": None,
        "source_url": source_url,
        "pdf_url": pdf_url,
        "title": title,
        "authors": authors,
        "year": None,
        "venue": None,
        "categories": [],
        "abstract": claude_summary,
        "claude_summary": claude_summary,
        "ingested_at": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
        "extraction_method": extraction_method,
        "model": model,
        "sections": sections,
        "files": {"pdf": "paper.pdf", "markdown": "paper.md"},
    }
    meta_path = out_dir / "metadata.yaml"
    with meta_path.open("w", encoding="utf-8") as f:
        yaml.safe_dump(metadata, f, sort_keys=False, allow_unicode=True, width=100)
    print(f"Done. Wrote {out_dir}/")


def ingest_pdf_url(url: str, papers_dir: Path, model: str) -> Path:
    # Directory name is finalized after we can guess a title; use a
    # temporary staging dir under papers_dir first.
    parsed = urlparse(url)
    fallback_slug = slugify(Path(parsed.path).stem or "paper")
    tmp_dir = papers_dir / f"_staging-{fallback_slug}"
    tmp_dir.mkdir(parents=True, exist_ok=True)
    tmp_pdf = tmp_dir / "paper.pdf"

    print(f"[1/3] Downloading PDF from {url} ...")
    download_pdf(url, tmp_pdf)

    print("[2/3] Converting to markdown and extracting section boundaries ...")
    markdown_text = convert_to_markdown(tmp_pdf)
    sections, extraction_method, claude_summary, claude_title, claude_authors, model_used = extract_sections(markdown_text, model)
    n_found = sum(1 for s in sections if s["found"])
    print(f"      [{extraction_method}] found {n_found}/{len(sections)} canonical sections")

    # Prefer Claude's title/author read (it saw the whole paper) over the
    # regex-based best-effort guesser, which only looks at the first ~40
    # lines and can be fooled by munged mastheads.
    guessed_title, guessed_authors = guess_title_authors_from_markdown(markdown_text)
    title = claude_title or guessed_title
    authors = claude_authors or guessed_authors
    slug = slugify(title) if title else fallback_slug

    out_dir = papers_dir / slug
    if out_dir != tmp_dir:
        out_dir.mkdir(parents=True, exist_ok=True)
        shutil.move(str(tmp_pdf), str(out_dir / "paper.pdf"))
        shutil.rmtree(tmp_dir, ignore_errors=True)
    else:
        out_dir = tmp_dir

    md_path = out_dir / "paper.md"
    md_path.write_text(markdown_text, encoding="utf-8")

    print("[3/3] Writing metadata ...")
    _write_metadata_for_untethered_input(
        out_dir,
        input_type="pdf_url",
        source_url=url,
        pdf_url=url,
        title=title,
        authors=authors,
        extraction_method=extraction_method,
        model=model_used,
        claude_summary=claude_summary,
        sections=sections,
    )
    return out_dir


def ingest_local_file(path_str: str, papers_dir: Path, model: str) -> Path:
    pdf_path = Path(path_str)
    if not pdf_path.is_file():
        raise FileNotFoundError(f"Local file not found: {pdf_path}")

    print(f"[1/3] Reading local file {pdf_path} ...")
    print("[2/3] Converting to markdown and extracting section boundaries ...")
    markdown_text = convert_to_markdown(pdf_path)
    sections, extraction_method, claude_summary, claude_title, claude_authors, model_used = extract_sections(markdown_text, model)
    n_found = sum(1 for s in sections if s["found"])
    print(f"      [{extraction_method}] found {n_found}/{len(sections)} canonical sections")

    guessed_title, guessed_authors = guess_title_authors_from_markdown(markdown_text)
    title = claude_title or guessed_title
    authors = claude_authors or guessed_authors
    slug = slugify(title) if title else slugify(pdf_path.stem)

    out_dir = papers_dir / slug
    out_dir.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(pdf_path, out_dir / "paper.pdf")

    md_path = out_dir / "paper.md"
    md_path.write_text(markdown_text, encoding="utf-8")

    print("[3/3] Writing metadata ...")
    _write_metadata_for_untethered_input(
        out_dir,
        input_type="local_file",
        source_url=str(pdf_path),
        pdf_url=None,
        title=title,
        authors=authors,
        extraction_method=extraction_method,
        model=model_used,
        claude_summary=claude_summary,
        sections=sections,
    )
    return out_dir


def ingest(raw_input: str, papers_dir: Path, model: str, local_pdf: Path | None = None) -> Path:
    kind, value = classify_input(raw_input)
    if kind == "arxiv":
        return ingest_arxiv(value, papers_dir, model)
    if kind == "doi":
        return ingest_doi(value, papers_dir, local_pdf, model)
    if kind == "pdf_url":
        return ingest_pdf_url(value, papers_dir, model)
    if kind == "local_file":
        return ingest_local_file(value, papers_dir, model)
    raise UnresolvedInputError(f"Unhandled input kind: {kind!r}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument(
        "paper_ref",
        help="arXiv ID/URL, DOI/doi.org URL, direct PDF URL, or local PDF file path",
    )
    parser.add_argument(
        "--pdf",
        default=None,
        help="Local PDF path to attach when the primary input is a DOI with no open-access copy",
    )
    parser.add_argument(
        "--papers-dir",
        default=None,
        help="Output root (default: <repo_root>/papers)",
    )
    parser.add_argument(
        "--model",
        required=True,
        help="Model to pass through to the `claude` CLI's own --model flag for "
        "Claude-driven section extraction (e.g. sonnet, claude-sonnet-5). "
        "Required — no default, per this project's no-auto-tiering policy: "
        "you pick the model for every call.",
    )
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parent.parent
    papers_dir = Path(args.papers_dir) if args.papers_dir else repo_root / "papers"
    local_pdf = Path(args.pdf).expanduser().resolve() if args.pdf else None

    try:
        ingest(args.paper_ref, papers_dir, args.model, local_pdf=local_pdf)
    except Exception as exc:  # noqa: BLE001 - top-level CLI error boundary
        print(f"error: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

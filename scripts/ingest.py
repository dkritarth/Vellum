#!/usr/bin/env python3
"""
ingest.py — M0 single-paper ingestion pipeline for local-anara.

Given an arXiv ID, this script:
  1. Downloads the paper's original PDF from arXiv.
  2. Converts the PDF to markdown via the `markitdown` library.
  3. Extracts standard sections (Abstract, Introduction, Related Work,
     Method, Experiments, Results, Discussion, Conclusion, References)
     using a heuristic/regex heading detector (see NOTE below).
  4. Writes everything to papers/<arxiv-id>/:
       - paper.pdf       (original PDF)
       - paper.md        (converted markdown)
       - metadata.yaml   (title, authors, year, venue, abstract,
                          section boundaries, extraction method)

Usage:
    python scripts/ingest.py 1706.03762
    python scripts/ingest.py https://arxiv.org/abs/1706.03762
    python scripts/ingest.py https://arxiv.org/pdf/1706.03762v7

Only arXiv IDs/URLs are supported in M0. DOI/URL(non-arXiv)/local-file
support is deferred to M1 per PLAN.md.

NOTE on section extraction (read AGENTS.md before changing this):
This is a heuristic, regex-based section splitter, NOT an LLM-driven
extraction step. It is a deliberate placeholder — PLAN.md calls for
"a prompt-driven extraction step" using Claude as the real M1+ approach.
No LLM API key/harness is assumed to be available when this script runs
standalone, so it falls back to heading-text matching. The heuristic
must degrade gracefully: missing or unrecognized sections are recorded
as `found: false` rather than raising an error. When Claude-driven
extraction is added, keep this heuristic as the no-LLM fallback path.

TODO(M1): swap in / add a Claude-driven extraction pass that reads
paper.md and produces the same `sections` schema, with this heuristic
kept as a fallback when no API key is configured.
"""

from __future__ import annotations

import argparse
import datetime
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path
from urllib.parse import urlparse

import requests
import yaml

ARXIV_ABS_RE = re.compile(r"arxiv\.org/abs/([\w.\-/]+?)(v\d+)?/?$", re.IGNORECASE)
ARXIV_PDF_RE = re.compile(r"arxiv\.org/pdf/([\w.\-/]+?)(v\d+)?(\.pdf)?/?$", re.IGNORECASE)
ARXIV_ID_RE = re.compile(r"^[\w.\-/]+$")

ARXIV_API_URL = "https://export.arxiv.org/api/query"
ARXIV_PDF_URL_TMPL = "https://arxiv.org/pdf/{arxiv_id}.pdf"

ATOM_NS = {"atom": "http://www.w3.org/2005/Atom", "arxiv": "http://arxiv.org/schemas/atom"}

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
# get shadowed by a shorter overlapping alias, etc. (not currently needed
# since we do exact/prefix matching, but keep aliases most-specific-first
# for future substring matching changes.)
for _name in SECTION_ALIASES:
    SECTION_ALIASES[_name].sort(key=len, reverse=True)

# Matches "1 Introduction", "1. Introduction", "1.Introduction", and
# "3.1.ResidualLearning" alike — PDF->text extraction is inconsistent
# about whether a space survives after the section number/dot.
HEADING_NUMBERED_RE = re.compile(r"^(\d+(?:\.\d+)*)\.?\s*([A-Za-z][A-Za-z\-\s]{0,80})$")
MAX_HEADING_LEN = 80


def parse_arxiv_id(raw: str) -> str:
    """Accept a bare arXiv id or an arxiv.org abs/pdf URL and return the id."""
    raw = raw.strip()
    m = ARXIV_ABS_RE.search(raw)
    if m:
        return m.group(1)
    m = ARXIV_PDF_RE.search(raw)
    if m:
        return m.group(1)
    parsed = urlparse(raw)
    if parsed.scheme and parsed.netloc:
        raise ValueError(
            f"Could not parse an arXiv ID out of URL: {raw!r}. "
            "M0 only supports arXiv IDs/URLs; DOI/local-file support is deferred to M1."
        )
    if ARXIV_ID_RE.match(raw):
        return raw
    raise ValueError(f"{raw!r} does not look like an arXiv ID or arxiv.org URL.")


def fetch_metadata(arxiv_id: str) -> dict:
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
        # arXiv's Atom feed has no reliable "published venue" field (that's
        # usually only in the PDF's own header, e.g. "NeurIPS 2017"); venue
        # extraction from the PDF text is a stretch goal, not attempted here.
    except (requests.RequestException, ET.ParseError) as exc:
        print(f"  [warn] arXiv metadata lookup failed ({exc}); continuing with defaults.", file=sys.stderr)
    return meta


def download_pdf(arxiv_id: str, dest: Path) -> None:
    url = ARXIV_PDF_URL_TMPL.format(arxiv_id=arxiv_id)
    resp = requests.get(url, timeout=60, allow_redirects=True)
    resp.raise_for_status()
    if resp.headers.get("content-type", "").lower().startswith("text/html"):
        raise RuntimeError(
            f"Expected a PDF from {url} but got HTML back — check the arXiv ID is correct."
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


def extract_sections(markdown_text: str) -> list[dict]:
    """Heuristic section-boundary detector.

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

    for idx, raw_line in enumerate(lines):
        line = raw_line.strip().lstrip("#").strip()
        if not line or len(line) > MAX_HEADING_LEN or line.endswith("."):
            continue

        candidate_text = None
        m = HEADING_NUMBERED_RE.match(line)
        if m:
            candidate_text = m.group(2)
        elif _normalize(line) in {
            alias for aliases in SECTION_ALIASES.values() for alias in aliases
        }:
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


def ingest(arxiv_id_or_url: str, papers_dir: Path) -> Path:
    arxiv_id = parse_arxiv_id(arxiv_id_or_url)
    out_dir = papers_dir / arxiv_id.replace("/", "_")
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"[1/4] Fetching metadata for arXiv:{arxiv_id} ...")
    meta = fetch_metadata(arxiv_id)

    pdf_path = out_dir / "paper.pdf"
    print(f"[2/4] Downloading PDF -> {pdf_path} ...")
    download_pdf(arxiv_id, pdf_path)

    print("[3/4] Converting PDF -> markdown via markitdown ...")
    markdown_text = convert_to_markdown(pdf_path)
    md_path = out_dir / "paper.md"
    md_path.write_text(markdown_text, encoding="utf-8")

    print("[4/4] Extracting section boundaries (heuristic fallback) ...")
    sections = extract_sections(markdown_text)
    n_found = sum(1 for s in sections if s["found"])
    print(f"      found {n_found}/{len(sections)} canonical sections")

    metadata = {
        "arxiv_id": arxiv_id,
        "source_url": f"https://arxiv.org/abs/{arxiv_id}",
        "pdf_url": ARXIV_PDF_URL_TMPL.format(arxiv_id=arxiv_id),
        "title": meta["title"],
        "authors": meta["authors"],
        "year": meta["year"],
        "venue": meta["venue"],
        "categories": meta["categories"],
        "abstract": meta["abstract"],
        "ingested_at": datetime.datetime.now(datetime.timezone.utc)
        .isoformat(timespec="seconds"),
        "extraction_method": "heuristic-regex",  # TODO(M1): "claude" once wired up
        "sections": sections,
        "files": {
            "pdf": "paper.pdf",
            "markdown": "paper.md",
        },
    }
    meta_path = out_dir / "metadata.yaml"
    with meta_path.open("w", encoding="utf-8") as f:
        yaml.safe_dump(metadata, f, sort_keys=False, allow_unicode=True, width=100)

    print(f"Done. Wrote {out_dir}/")
    return out_dir


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument(
        "arxiv_id",
        help="arXiv ID (e.g. 1706.03762) or arxiv.org abs/pdf URL",
    )
    parser.add_argument(
        "--papers-dir",
        default=None,
        help="Output root (default: <repo_root>/papers)",
    )
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parent.parent
    papers_dir = Path(args.papers_dir) if args.papers_dir else repo_root / "papers"

    try:
        ingest(args.arxiv_id, papers_dir)
    except Exception as exc:  # noqa: BLE001 - top-level CLI error boundary
        print(f"error: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

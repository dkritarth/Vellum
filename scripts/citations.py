#!/usr/bin/env python3
"""
citations.py — M3 citation graph for local-anara.

Per PLAN.md's Phase 3 ("build a graph of paper -> cited papers ... and
paper -> citing papers (best-effort, e.g. via Semantic Scholar API) ...
visualize/query the graph"), this script:

  1. Parses each ingested paper's References section (line boundaries
     already recorded in metadata.yaml's `sections` by ingest.py) into
     individual reference entries. Real References sections vary
     wildly in format across venues (numbered [1]/[2].../unordered
     Author-Year, IEEE vs ACL style) and are further mangled by
     markitdown's PDF conversion (word-munging, spurious markdown
     tables splitting a single citation across "rows" — see NOTES.md
     for concrete examples). A regex parser was tried against this
     corpus's actual References text during development and produced
     unusably fragmented output (a single citation frequently split
     across 3-6 "rows" of table syntax) — so, per this task's explicit
     "don't force a regex fallback that doesn't work" allowance, this
     step is Claude-CLI-driven only (same credential path as
     ingest.py's section extraction / synthesize.py — `claude -p
     --output-format json --tools ""`, no raw API key needed), with a
     documented "no fallback, degrade to empty list" behavior on
     failure rather than a broken heuristic. See NOTES.md's M3 section.
  2. Matches parsed references against the *other* papers already
     ingested under papers/ (title token-overlap + author last-name
     overlap) to build in-corpus "cites" edges — free and reliable,
     no network call.
  3. Best-effort external lookups via the Semantic Scholar Graph API
     (api.semanticscholar.org, no key required) to (a) resolve each
     paper's own Semantic Scholar id and (b) fetch its "citingPapers"
     (papers -> citing this paper -> beyond-corpus data the local
     corpus alone can't provide). The API was observed to be flaky
     (intermittent 429 "Too Many Requests" even at low request rates
     from this environment) during development, so every call goes
     through a fixed-delay retry loop and degrades to a recorded
     "unavailable" status rather than failing the whole script.
  4. Storage: one `citations.yaml` per paper under
     papers/<slug>/citations.yaml (PLAN.md's own suggested option),
     consistent with this project's "one plain-file directory per
     paper" convention — no database, no separate graph file. See
     NOTES.md for the one-file-per-paper vs single-graph-file
     rationale.
  5. `citations.py report` reads every papers/*/citations.yaml plus
     metadata.yaml and writes citations/report.md: a most-cited-in-
     corpus ranking, a full adjacency listing, and simple connected-
     component cluster detection over the in-corpus citation graph
     (undirected) — a markdown report, not a rendered image, since a
     5-node graph doesn't warrant real graph-visualization tooling.

Usage:
    python scripts/citations.py build                 # all ingested papers
    python scripts/citations.py build 1706.03762 1810.04805
    python scripts/citations.py build --no-external    # skip Semantic Scholar calls
    python scripts/citations.py report                 # writes citations/report.md
    python scripts/citations.py report --print-only

Requires the `claude` CLI on PATH for reference parsing (step 1); if it's
missing, `build` still runs steps 2-4 with an empty reference list per
paper (recorded via parse_method: none) rather than crashing.
"""

from __future__ import annotations

import argparse
import datetime
import json
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

import requests
import yaml

CLAUDE_BIN = "claude"
CLAUDE_TIMEOUT_SECONDS = 240
MAX_REFERENCES_CHARS = 60_000  # References sections are long but bounded; generous cap

# References text is parsed in chunks rather than as one giant blob. This was
# NOT a performance optimization -- it was forced by a real failure observed
# during development: markitdown's PDF conversion occasionally produces
# reversed-word/garbled-token artifacts (e.g. a two-column-layout mixup
# turning "since voting" into "ecnis gnitov", interleaved with repeated
# "<pad> <pad>" tokens) in a small stretch of a References section, and
# feeding that stretch to `claude -p` triggered a genuine Claude usage-policy
# refusal (stop_reason: "refusal") for the ENTIRE call -- zeroing out every
# reference in that paper, not just the garbled one. Chunking means a single
# bad stretch only costs the references in its own chunk; every other chunk
# still parses normally. See NOTES.md's M3 section for the exact repro.
CHUNK_CHARS = 4000

S2_API_BASE = "https://api.semanticscholar.org/graph/v1"
S2_HEADERS = {"User-Agent": "local-anara/0.1 (research tool; mailto:none@example.com)"}
S2_RETRY_TRIES = 6
S2_RETRY_DELAY_SECONDS = 5  # fixed delay; the API's 429s were observed to be transient,
# not a real sustained rate limit, in testing -- see NOTES.md.
S2_CITATIONS_LIMIT = 50

TITLE_MATCH_THRESHOLD = 0.55  # Jaccard token overlap on normalized titles

REFERENCE_PARSE_PROMPT_TMPL = """You are extracting individual bibliography entries from the References \
section of an academic paper. This text was produced by an automated PDF-to-markdown converter and is \
often badly mangled: spaces between words can be dropped ("word-munging"), a single citation can be split \
across multiple lines or even wrapped in spurious markdown table syntax ("| ... | --- | ..."), and citations \
may or may not have a leading "[N]" numeric marker. Read past all of this noise using your understanding of \
what a bibliography entry looks like (author list, then title, then venue/year), not exact line/table \
structure -- a single citation's pieces may be scattered across several consecutive raw lines/table rows.

Extract every distinct reference entry you can identify. For each, give your best-effort:
- "raw": a short (<200 char) plain-text reconstruction of the citation as you understand it (authors + \
title, roughly), for a human to sanity-check.
- "title": the paper/work's title as a single string, reconstructed across the munging/wrapping, or null if \
you genuinely can't tell.
- "authors": a list of author name strings (surname or full name, whatever you can extract), or [] if none \
are recoverable.
- "year": a 4-digit publication year as an integer, or null if not recoverable.

Do not fabricate entries or guess wildly -- if a stretch of text doesn't look like a real citation, skip it. \
It's fine and expected to get partial data (e.g. title but no year) for many entries; this is degrade-\
gracefully extraction, not a strict parser. If the section text has no recognizable citations at all \
(e.g. it's not actually a references list), return an empty list.

Respond with ONLY a single JSON object, no markdown code fences, no commentary, matching exactly this shape:
{{"references": [{{"raw": "...", "title": "..." or null, "authors": ["..."], "year": 2017 or null}}, ...]}}

References section text follows:
---
{references_text}
"""


class CitationsError(RuntimeError):
    pass


# ---------------------------------------------------------------------------
# Reference parsing (Claude-CLI-driven, no regex fallback -- see module docstring)
# ---------------------------------------------------------------------------


def _extract_section_text(md_lines: list[str], start_line: int | None, end_line: int | None) -> str:
    if start_line is None or end_line is None:
        return ""
    start_idx = max(start_line - 1, 0)
    end_idx = min(max(end_line - 1, start_idx), len(md_lines))
    return "\n".join(md_lines[start_idx:end_idx]).strip()


def get_references_text(paper_dir: Path, meta: dict) -> str:
    md_path = paper_dir / "paper.md"
    if not md_path.exists():
        return ""
    sections_by_name = {s["name"]: s for s in (meta.get("sections") or [])}
    ref_section = sections_by_name.get("References")
    if not ref_section or not ref_section.get("found"):
        return ""
    md_lines = md_path.read_text(encoding="utf-8", errors="replace").splitlines()
    text = _extract_section_text(md_lines, ref_section.get("start_line"), ref_section.get("end_line"))
    if len(text) > MAX_REFERENCES_CHARS:
        text = text[:MAX_REFERENCES_CHARS] + "\n... [truncated: References section exceeds parse size cap] ..."
    return text


def _call_claude_json(prompt: str, model: str) -> dict | None:
    """Shell out to `claude -p`, same pattern as ingest.py/synthesize.py. Returns
    the parsed JSON payload, or None on any failure (binary missing, timeout,
    non-zero exit, unparseable JSON) -- never raises."""
    if shutil.which(CLAUDE_BIN) is None:
        print("  [info] `claude` CLI not found on PATH; skipping reference parsing.", file=sys.stderr)
        return None
    try:
        proc = subprocess.run(
            [CLAUDE_BIN, "-p", "--output-format", "json", "--tools", "", "--model", model],
            input=prompt,
            capture_output=True,
            text=True,
            timeout=CLAUDE_TIMEOUT_SECONDS,
        )
    except (subprocess.SubprocessError, OSError) as exc:
        print(f"  [warn] `claude` CLI invocation failed ({exc}); skipping.", file=sys.stderr)
        return None
    if proc.returncode != 0:
        print(f"  [warn] `claude` CLI exited {proc.returncode}; skipping. stderr: {proc.stderr[:500]!r}", file=sys.stderr)
        return None
    try:
        wrapper = json.loads(proc.stdout)
        result_text = wrapper.get("result", "") if isinstance(wrapper, dict) else ""
    except json.JSONDecodeError:
        result_text = proc.stdout
    result_text = result_text.strip()
    fence_match = re.match(r"^```(?:json)?\s*(.*)\s*```$", result_text, re.DOTALL)
    if fence_match:
        result_text = fence_match.group(1).strip()
    try:
        payload = json.loads(result_text)
    except json.JSONDecodeError as exc:
        print(f"  [warn] Could not parse `claude` output as JSON ({exc}); skipping.", file=sys.stderr)
        return None
    return payload if isinstance(payload, dict) else None


def _chunk_text(text: str, chunk_chars: int = CHUNK_CHARS) -> list[str]:
    """Split into roughly chunk_chars-sized pieces, preferring to break on a
    blank line near the target size (keeps a citation's wrapped lines
    together more often than a hard character cut). Falls back to a hard
    cut if no blank line is found in range."""
    if len(text) <= chunk_chars:
        return [text]
    chunks = []
    pos = 0
    n = len(text)
    while pos < n:
        end = min(pos + chunk_chars, n)
        if end < n:
            # search backwards from `end` for a blank-line break, within a
            # reasonable window, so we don't cut a citation entry in half.
            window_start = max(pos + chunk_chars // 2, pos)
            break_at = text.rfind("\n\n", window_start, end)
            if break_at != -1:
                end = break_at
        chunks.append(text[pos:end])
        pos = end
    return [c for c in chunks if c.strip()]


def _coerce_year(raw_year) -> int | None:
    """Accepts an int as-is. Also recovers a 4-digit year from a string the
    CLI occasionally emits despite the prompt asking for a bare int (e.g.
    "2017" or "c. 2017") -- silently discarding that data was a real bug,
    since it's recoverable. Prints a [warn] (matching every other data-loss
    path in this file) only when a non-null value genuinely couldn't be
    parsed."""
    if isinstance(raw_year, int):
        return raw_year
    if isinstance(raw_year, str):
        match = re.search(r"(1[5-9]\d{2}|20\d{2})", raw_year)
        if match:
            return int(match.group(1))
    if raw_year is not None:
        print(f"    [warn] could not parse reference year {raw_year!r}; recording as null.", file=sys.stderr)
    return None


def _parse_references_chunk(chunk: str, model: str) -> list[dict] | None:
    """Parse one chunk via claude -p. Returns a list of entries, or None if
    the call failed/was refused/returned unparseable output for this chunk
    specifically (caller treats None as "this chunk contributed nothing",
    not a fatal error for the whole paper)."""
    payload = _call_claude_json(REFERENCE_PARSE_PROMPT_TMPL.format(references_text=chunk), model)
    if payload is None:
        return None
    raw_refs = payload.get("references")
    if not isinstance(raw_refs, list):
        return None
    out = []
    for entry in raw_refs:
        if not isinstance(entry, dict):
            continue
        raw = entry.get("raw") if isinstance(entry.get("raw"), str) else None
        title = entry.get("title") if isinstance(entry.get("title"), str) else None
        authors_raw = entry.get("authors")
        authors = [a for a in authors_raw if isinstance(a, str) and a.strip()] if isinstance(authors_raw, list) else []
        year = _coerce_year(entry.get("year"))
        if not raw and not title:
            continue
        out.append({"raw": raw, "title": title, "authors": authors, "year": year})
    return out


def _dedupe_references(entries: list[dict]) -> list[dict]:
    """Chunk boundaries can occasionally cause the exact same citation to be
    reparsed intact in two overlapping chunk views, with slightly different
    `raw` text -- dedupe on normalized title when available, else on the full
    normalized `raw` text (not just a prefix -- `raw` is already capped at
    <200 chars by the extraction prompt, and a short prefix risked colliding
    two distinct references that merely share a long common author-list
    opening). Note: this does NOT merge two genuinely complementary partial
    fragments of one citation split across a chunk boundary (e.g. one
    fragment with authors but no title, another with a title but no authors)
    -- those fragments share no matchable key and are left as separate,
    partial entries; reconstructing them would need cross-fragment text
    stitching, out of scope here."""
    seen: set[str] = set()
    out = []
    for entry in entries:
        key = None
        if entry.get("title"):
            key = "t:" + " ".join(sorted(_normalize_title(entry["title"])))
        elif entry.get("raw"):
            key = "r:" + re.sub(r"[^a-z0-9]", "", entry["raw"].lower())
        if key and key in seen:
            print(f"    [info] dropping likely-duplicate reference: {entry.get('raw', entry.get('title', ''))[:80]!r}",
                  file=sys.stderr)
            continue
        if key:
            seen.add(key)
        out.append(entry)
    return out


def parse_references(references_text: str, model: str) -> tuple[list[dict], bool]:
    """Returns (entries, attempted_ok). `attempted_ok` is True iff at least
    one chunk was actually parsed by the `claude` CLI successfully (even if
    that chunk -- or all of them -- legitimately contained zero extractable
    references); it's False if the CLI is missing or every chunk call
    failed/was refused. Callers need this distinction to avoid conflating
    "we tried and found nothing" with "we never managed to try" (both used to
    collapse to the same `parse_method: none`, per AGENTS.md's "degrade
    gracefully" rule -- degrading gracefully means being honest about what
    happened, not erasing the difference). Never raises. Parses in chunks
    (see CHUNK_CHARS) so that one bad chunk (e.g. a PDF-conversion-garbled
    stretch that trips a usage-policy refusal -- see module docstring) only
    loses that chunk's references, not the whole paper's."""
    if not references_text.strip():
        return [], False
    chunks = _chunk_text(references_text)
    all_entries: list[dict] = []
    any_chunk_ok = False
    for i, chunk in enumerate(chunks):
        entries = _parse_references_chunk(chunk, model)
        if entries is None:
            print(f"    [warn] reference-parsing chunk {i + 1}/{len(chunks)} failed/refused; skipping that chunk only.",
                  file=sys.stderr)
            continue
        any_chunk_ok = True
        all_entries.extend(entries)
    return _dedupe_references(all_entries), any_chunk_ok


# ---------------------------------------------------------------------------
# In-corpus matching (free, no network)
# ---------------------------------------------------------------------------


def _normalize_title(text: str) -> set[str]:
    return set(re.sub(r"[^a-z0-9 ]", "", text.lower()).split())


def _title_similarity(a: str, b: str) -> float:
    ta, tb = _normalize_title(a), _normalize_title(b)
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / len(ta | tb)


def _last_names(authors: list[str]) -> set[str]:
    return {a.split()[-1].lower() for a in authors if a.split()}


def match_reference_to_corpus(ref: dict, corpus: list[tuple[str, dict]], self_slug: str) -> dict | None:
    """Best match of one parsed reference against other papers in the corpus.
    Returns {"slug", "title", "confidence"} or None. `confidence` is "high"
    (title similarity >= threshold AND some author overlap, or very high
    title similarity alone) or "medium" (title similarity >= threshold only)."""
    if not ref.get("title"):
        return None
    best = None
    for slug, meta in corpus:
        if slug == self_slug:
            continue
        other_title = meta.get("title")
        if not other_title:
            continue
        sim = _title_similarity(ref["title"], other_title)
        if sim < TITLE_MATCH_THRESHOLD:
            continue
        author_overlap = bool(_last_names(ref.get("authors") or []) & _last_names(meta.get("authors") or []))
        confidence = "high" if (sim >= 0.8 or author_overlap) else "medium"
        if best is None or sim > best[0]:
            best = (sim, slug, other_title, confidence)
    if best is None:
        return None
    _, slug, title, confidence = best
    return {"slug": slug, "title": title, "confidence": confidence}


# ---------------------------------------------------------------------------
# Semantic Scholar (best-effort, fixed-delay retry on 429/network errors)
# ---------------------------------------------------------------------------


# Sentinel distinct from `None`: `None` means the API definitively said "not
# found" (a real 404), `S2_UNAVAILABLE` means we couldn't get an answer at all
# (retries exhausted on 429s/network errors/bad JSON/other HTTP errors) --
# collapsing these was a real bug (a transient rate-limit used to get recorded
# as a permanent "not_found" fact in citations.yaml).
S2_UNAVAILABLE = object()

# A few author-name tokens the Semantic Scholar API is observed to return in
# place of a real name for malformed upstream records (e.g. "Data", "Time",
# a bare single first name with no surname). Not exhaustive -- just filters
# the concrete junk seen in this project's corpus rather than fabricating a
# general name-validity classifier.
_JUNK_AUTHOR_TOKENS = {"data", "time", "n/a", "unknown", "et al", "et al."}


def _looks_like_author_name(name: str) -> bool:
    return bool(name) and name.strip().lower() not in _JUNK_AUTHOR_TOKENS


def _s2_get(path: str, params: dict) -> dict | None | object:
    """Returns the parsed JSON dict on success, `None` on a genuine 404 (not
    found), or `S2_UNAVAILABLE` if the API couldn't be reached/answered after
    retries -- callers must not treat the latter two as equivalent."""
    url = f"{S2_API_BASE}/{path}"
    last_err = None
    for attempt in range(S2_RETRY_TRIES):
        try:
            resp = requests.get(url, params=params, headers=S2_HEADERS, timeout=20)
        except requests.RequestException as exc:
            last_err = str(exc)
            time.sleep(S2_RETRY_DELAY_SECONDS)
            continue
        if resp.status_code == 200:
            try:
                return resp.json()
            except ValueError as exc:
                last_err = f"bad JSON: {exc}"
                break
        if resp.status_code == 429:
            last_err = "429 Too Many Requests"
            time.sleep(S2_RETRY_DELAY_SECONDS)
            continue
        if resp.status_code == 404:
            return None  # genuinely not found, not an error
        last_err = f"HTTP {resp.status_code}: {resp.text[:200]}"
        break
    print(f"  [warn] Semantic Scholar lookup for {path!r} unavailable after retries ({last_err}).", file=sys.stderr)
    return S2_UNAVAILABLE


def s2_lookup_paper(title: str, arxiv_id: str | None) -> dict | None | object:
    """Resolve a paper's Semantic Scholar id, preferring a direct arXiv-id
    lookup (exact, no ambiguity) and falling back to a title search. Returns
    the paper dict on success, `None` if the API was reachable and genuinely
    has no match, or `S2_UNAVAILABLE` if any lookup involved couldn't be
    completed (so callers don't record a transient failure as a permanent
    fact)."""
    saw_unavailable = False
    if arxiv_id:
        data = _s2_get(f"paper/arXiv:{arxiv_id}", {"fields": "title,externalIds,paperId,year,citationCount"})
        if data is S2_UNAVAILABLE:
            saw_unavailable = True
        elif data and data.get("paperId"):
            return data
    if title:
        data = _s2_get("paper/search", {"query": title, "limit": 1, "fields": "title,externalIds,paperId,year,citationCount"})
        if data is S2_UNAVAILABLE:
            saw_unavailable = True
        else:
            candidates = (data or {}).get("data") or []
            if candidates:
                top = candidates[0]
                if _title_similarity(title, top.get("title", "")) >= 0.5:
                    return top
    return S2_UNAVAILABLE if saw_unavailable else None


# Fetch more than we keep and sort by citationCount so the stored sample is
# "most-cited/most-influential" rather than whatever order the API happens to
# return (observed to be recency-skewed -- every entry landing in the same
# year, missing the foundational/highly-cited citing works entirely).
S2_CITATIONS_FETCH_LIMIT = 100


def s2_lookup_citing_papers(paper_id: str, limit: int = S2_CITATIONS_LIMIT) -> list[dict] | None:
    data = _s2_get(
        f"paper/{paper_id}/citations",
        {"fields": "title,year,authors,externalIds,citationCount", "limit": S2_CITATIONS_FETCH_LIMIT},
    )
    if data is S2_UNAVAILABLE:
        return None
    if data is None:
        return []  # genuine 404 on a paperId we just resolved -- treat as zero citing papers, not unavailable
    out = []
    for entry in data.get("data") or []:
        citing = entry.get("citingPaper") or {}
        if not citing.get("title"):
            continue
        out.append(
            {
                "title": citing.get("title"),
                "year": citing.get("year"),
                "authors": [a.get("name") for a in (citing.get("authors") or []) if _looks_like_author_name(a.get("name"))],
                "paperId": citing.get("paperId"),
                "external_ids": citing.get("externalIds") or {},
                "citation_count": citing.get("citationCount"),
            }
        )
    out.sort(key=lambda e: e.get("citation_count") or 0, reverse=True)
    return out[:limit]


# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------


def load_corpus(papers_dir: Path) -> list[tuple[str, dict]]:
    corpus = []
    for p in sorted(papers_dir.iterdir()):
        meta_path = p / "metadata.yaml"
        if not p.is_dir() or not meta_path.exists():
            continue
        try:
            meta = yaml.safe_load(meta_path.read_text(encoding="utf-8")) or {}
        except (OSError, yaml.YAMLError) as exc:
            print(f"  [warn] Could not read {meta_path} ({exc}); skipping.", file=sys.stderr)
            continue
        corpus.append((p.name, meta))
    return corpus


def resolve_paper_slugs(refs: list[str], corpus: list[tuple[str, dict]]) -> list[str]:
    if not refs:
        return [slug for slug, _ in corpus]
    known = {slug for slug, _ in corpus}
    out = []
    for ref in refs:
        if ref in known:
            out.append(ref)
        else:
            raise CitationsError(f"{ref!r} is not an ingested paper slug under papers/ (known: {sorted(known)}).")
    return out


def build_one(slug: str, papers_dir: Path, corpus: list[tuple[str, dict]], *, use_external: bool, model: str) -> dict:
    paper_dir = papers_dir / slug
    meta = dict(next(m for s, m in corpus if s == slug))
    title = meta.get("title") or slug
    print(f"[{slug}] {title}")

    references_text = get_references_text(paper_dir, meta)
    if not references_text:
        print("  no References section text available; skipping reference parsing.")
        references: list[dict] = []
        parse_method = "none"  # no section to parse -- distinct from "unavailable" (attempted, failed)
        model_used = None
    else:
        print("  parsing References section via claude CLI (can take 10-60s)...")
        references, attempted_ok = parse_references(references_text, model)
        parse_method = "claude-cli" if attempted_ok else "unavailable"
        model_used = model if attempted_ok else None
        print(f"  parsed {len(references)} reference entr{'y' if len(references) == 1 else 'ies'}"
              f" (parse_method: {parse_method})")

    cites = []
    seen_slugs = set()
    for ref in references:
        match = match_reference_to_corpus(ref, corpus, slug)
        if match and match["slug"] not in seen_slugs:
            cites.append(match)
            seen_slugs.add(match["slug"])
    if cites:
        print(f"  in-corpus cites: {', '.join(c['slug'] for c in cites)}")

    s2_block: dict = {"lookup_status": "skipped", "paper_id": None, "matched_title": None}
    cited_by_external: list[dict] = []
    if use_external:
        arxiv_id = meta.get("arxiv_id")
        s2_paper = s2_lookup_paper(title, arxiv_id)
        if s2_paper is S2_UNAVAILABLE:
            s2_block["lookup_status"] = "unavailable"
            print("  [s2] paper lookup: unavailable (network/rate-limit -- not a confirmed non-match)")
        elif s2_paper is None:
            s2_block["lookup_status"] = "not_found"
            print("  [s2] paper lookup: not found")
        else:
            s2_block = {
                "lookup_status": "ok",
                "paper_id": s2_paper.get("paperId"),
                "matched_title": s2_paper.get("title"),
                "citation_count": s2_paper.get("citationCount"),
            }
            print(f"  [s2] paper lookup ok: paperId={s2_paper.get('paperId')} citationCount={s2_paper.get('citationCount')}")
            if s2_paper.get("paperId"):
                citing = s2_lookup_citing_papers(s2_paper["paperId"])
                if citing is None:
                    s2_block["citing_lookup_status"] = "unavailable"
                else:
                    s2_block["citing_lookup_status"] = "ok"
                    cited_by_external = citing
                    print(f"  [s2] fetched {len(citing)} citing paper(s) (external, best-effort, capped at {S2_CITATIONS_LIMIT})")

    return {
        "paper_slug": slug,
        "title": title,
        "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
        "parse_method": parse_method,
        "model": model_used,
        "references_parsed": len(references),
        "references": references,
        "cites": cites,
        "semantic_scholar": s2_block,
        "cited_by_external": cited_by_external,
    }


def cmd_build(args: argparse.Namespace) -> int:
    repo_root = Path(__file__).resolve().parent.parent
    papers_dir = Path(args.papers_dir).expanduser().resolve() if args.papers_dir else repo_root / "papers"
    if not papers_dir.is_dir():
        print(f"error: papers directory {papers_dir} does not exist.", file=sys.stderr)
        return 1

    corpus = load_corpus(papers_dir)
    if not corpus:
        print(f"error: no ingested papers (with metadata.yaml) found under {papers_dir}.", file=sys.stderr)
        return 1

    try:
        slugs = resolve_paper_slugs(args.paper_ids, corpus)
    except CitationsError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    for slug in slugs:
        result = build_one(slug, papers_dir, corpus, use_external=not args.no_external, model=args.model)
        out_path = papers_dir / slug / "citations.yaml"
        with out_path.open("w", encoding="utf-8") as f:
            yaml.safe_dump(result, f, sort_keys=False, allow_unicode=True, width=100)
        print(f"  wrote {out_path}")
    return 0


# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------


def _connected_components(nodes: set[str], edges: set[tuple[str, str]]) -> list[set[str]]:
    adjacency: dict[str, set[str]] = {n: set() for n in nodes}
    for a, b in edges:
        adjacency[a].add(b)
        adjacency[b].add(a)
    seen: set[str] = set()
    components = []
    for n in nodes:
        if n in seen:
            continue
        stack = [n]
        component = set()
        while stack:
            cur = stack.pop()
            if cur in component:
                continue
            component.add(cur)
            stack.extend(adjacency[cur] - component)
        seen |= component
        components.append(component)
    return components


def cmd_report(args: argparse.Namespace) -> int:
    repo_root = Path(__file__).resolve().parent.parent
    papers_dir = Path(args.papers_dir).expanduser().resolve() if args.papers_dir else repo_root / "papers"
    out_dir = Path(args.out_dir).expanduser().resolve() if args.out_dir else repo_root / "citations"

    corpus = load_corpus(papers_dir)
    if not corpus:
        print(f"error: no ingested papers found under {papers_dir}.", file=sys.stderr)
        return 1
    titles = {slug: (meta.get("title") or slug) for slug, meta in corpus}

    citations_data: dict[str, dict] = {}
    for slug, _ in corpus:
        cpath = papers_dir / slug / "citations.yaml"
        if cpath.exists():
            try:
                citations_data[slug] = yaml.safe_load(cpath.read_text(encoding="utf-8")) or {}
            except (OSError, yaml.YAMLError) as exc:
                print(f"  [warn] Could not read {cpath} ({exc}); treating as no data.", file=sys.stderr)
                citations_data[slug] = {}
        else:
            citations_data[slug] = {}

    # in-corpus edges: (citer_slug, cited_slug)
    edges: set[tuple[str, str]] = set()
    cited_by_in_corpus: dict[str, list[str]] = {slug: [] for slug, _ in corpus}
    for slug, data in citations_data.items():
        for c in data.get("cites") or []:
            target = c.get("slug")
            if target and target in titles:
                edges.add((slug, target))
                cited_by_in_corpus[target].append(slug)

    # most-cited-in-corpus ranking
    ranking = sorted(titles, key=lambda s: (-len(cited_by_in_corpus[s]), s))

    components = _connected_components(set(titles), edges)
    components = sorted(components, key=lambda c: (-len(c), sorted(c)))

    lines = ["# Citation graph report", ""]
    lines.append(f"Corpus: {len(titles)} paper(s). Generated {datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds')}.")
    lines.append("")

    lines.append("## Most-cited within this corpus")
    lines.append("")
    lines.append("Ranked by number of in-corpus papers whose References section was matched back to this paper "
                 "(title/author overlap against parsed reference entries -- see `citations.yaml` per paper).")
    lines.append("")
    lines.append("| Rank | Paper | In-corpus citations | Cited by (slugs) | S2 total citation count |")
    lines.append("| --- | --- | --- | --- | --- |")
    for i, slug in enumerate(ranking, start=1):
        n = len(cited_by_in_corpus[slug])
        by = ", ".join(cited_by_in_corpus[slug]) or "(none in corpus)"
        s2 = citations_data.get(slug, {}).get("semantic_scholar", {})
        s2_count = s2.get("citation_count")
        s2_str = str(s2_count) if isinstance(s2_count, int) else "n/a"
        lines.append(f"| {i} | {titles[slug]} (`{slug}`) | {n} | {by} | {s2_str} |")
    lines.append("")

    lines.append("## Adjacency listing (paper -> what it cites, in-corpus only)")
    lines.append("")
    for slug, _ in corpus:
        data = citations_data.get(slug, {})
        cites = data.get("cites") or []
        lines.append(f"### {titles[slug]} (`{slug}`)")
        parse_method = data.get("parse_method", "not built yet")
        n_parsed = data.get("references_parsed", 0)
        lines.append(f"- References parsed: {n_parsed} (method: {parse_method})")
        if cites:
            for c in cites:
                lines.append(f"- cites -> **{titles.get(c['slug'], c['slug'])}** (`{c['slug']}`, confidence: {c['confidence']})")
        else:
            lines.append("- cites -> (no in-corpus matches found)")
        s2 = data.get("semantic_scholar", {})
        status = s2.get("lookup_status", "not built yet")
        if status == "ok":
            lines.append(
                f"- Semantic Scholar: paperId `{s2.get('paper_id')}`, total citation count "
                f"{s2.get('citation_count', 'n/a')}, citing-papers lookup: {s2.get('citing_lookup_status', 'n/a')}"
            )
            external = data.get("cited_by_external") or []
            if external:
                lines.append(f"- cited_by (external, best-effort via Semantic Scholar, showing up to 5 of {len(external)}):")
                for ext in external[:5]:
                    year = ext.get("year") or "n/a"
                    authors = ", ".join(ext.get("authors") or []) or "unknown authors"
                    lines.append(f"  - \"{ext.get('title')}\" ({authors}, {year})")
        else:
            lines.append(f"- Semantic Scholar: {status}")
        lines.append("")

    lines.append("## Clusters (connected components of the in-corpus citation graph, undirected)")
    lines.append("")
    if not edges:
        lines.append("No in-corpus citation edges were found, so every paper is its own singleton cluster "
                     "(expected for a small, topically-scattered corpus like this one).")
        lines.append("")
    for i, comp in enumerate(components, start=1):
        members = ", ".join(f"{titles[s]} (`{s}`)" for s in sorted(comp))
        lines.append(f"{i}. {members}")
    lines.append("")

    report_text = "\n".join(lines)

    if args.print_only:
        print(report_text)
        return 0

    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "report.md"
    out_path.write_text(report_text + "\n", encoding="utf-8")
    print(f"Wrote {out_path}", file=sys.stderr)
    print(report_text)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)

    build_p = sub.add_parser("build", help="Parse references + build citation edges for one or more ingested papers")
    build_p.add_argument("paper_ids", nargs="*", help="Paper slugs under papers/ (default: all ingested papers)")
    build_p.add_argument("--model", required=True, help="Model name to pass to `claude -p --model` for reference parsing (required, no default -- pick explicitly every run)")
    build_p.add_argument("--no-external", action="store_true", help="Skip Semantic Scholar lookups (in-corpus edges only)")
    build_p.add_argument("--papers-dir", default=None, help="Override the papers/ directory")
    build_p.set_defaults(func=cmd_build)

    report_p = sub.add_parser("report", help="Generate citations/report.md from existing citations.yaml files")
    report_p.add_argument("--papers-dir", default=None, help="Override the papers/ directory")
    report_p.add_argument("--out-dir", default=None, help="Override the citations/ output directory")
    report_p.add_argument("--print-only", action="store_true", help="Print the report without writing a file")
    report_p.set_defaults(func=cmd_report)

    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())

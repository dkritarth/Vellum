#!/usr/bin/env python3
"""
synthesize.py — M2 cross-paper synthesis for local-anara.

Given a topic/question and (optionally) a list of paper ids/slugs under
`papers/`, reads each matched paper's `metadata.yaml` + the relevant slices
of `paper.md` (using the `sections` line-boundaries ingest.py already
populates) and asks Claude to draft a lit-review-style paragraph answering
"what do these papers say about <topic>", with inline citations back to
source papers (e.g. "(Vaswani et al. 2017)").

This is the M2 milestone from PLAN.md ("Cross-paper synthesis: aggregate
extracted sections/claims across a folder of papers... generating a draft
lit-review paragraph"). Per AGENTS.md's "no custom RAG" / "reuse existing
skills" rules:
  - No embeddings/vector store/SQLite index is used — this does a plain
    glob over papers/*/metadata.yaml (see NOTES.md for why that's fine at
    this corpus size).
  - The writing-quality pass mirrors the `research-paper-writing` skill's
    prose principles (topic-sentence-first paragraphs, claim-evidence
    alignment, one explicit message per paragraph) directly in the prompt
    below, rather than literally invoking that skill — Claude Code skills
    are invoked via the Skill tool inside an interactive Claude Code
    session, not from a plain subprocess; see NOTES.md for the fuller
    explanation of why "reuse the skill" means "mirror its guidance in the
    prompt" here, not a literal invocation.

Usage:
    python scripts/synthesize.py "how do these papers handle attention/alignment?" --model <model>
    python scripts/synthesize.py "how is pretraining used?" 1810.04805 1706.03762 --model <model>
    python scripts/synthesize.py "do these papers agree on X?" --contradictions --model <model>
    python scripts/synthesize.py "topic" --papers-dir papers --out-dir synthesis --model <model>

--model is required (no default): passed through verbatim to the claude
CLI's own --model flag, per PLAN.md's Phase 4 decision that the user picks
the model for every call rather than automatic tiering.

Output: a plain markdown file at synthesis/<topic-slug>.md (or
synthesis/<topic-slug>-contradictions.md in --contradictions mode) with a
YAML frontmatter block (topic, mode, papers included, generated_at,
extraction_method) followed by the synthesized prose. No database — plain
files, consistent with papers/'s convention.

Requires the `claude` CLI on PATH (same credential path ingest.py's
section-extraction pass uses — no raw ANTHROPIC_API_KEY needed). Unlike
ingest.py's section extraction, there is no heuristic fallback for
synthesis: writing a coherent cross-paper paragraph is exactly the kind of
task with no reasonable non-LLM heuristic, so if the `claude` CLI is
missing or fails, this script prints a clear error and exits non-zero
rather than writing a fabricated/low-quality file — same "don't fake an
answer" stance as ask.py takes for a missing API key.
"""

from __future__ import annotations

import argparse
import datetime
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

import yaml

CLAUDE_BIN = "claude"
CLAUDE_TIMEOUT_SECONDS = 300

# Per-paper cap on how much section text we feed into the prompt, and a
# cap on the total prompt size across all papers -- generous but bounded,
# mirroring ingest.py's CLAUDE_MAX_MARKDOWN_CHARS approach for the same
# reason (keep the claude -p call from blowing up on a huge corpus).
PER_PAPER_MAX_CHARS = 25_000
TOTAL_MAX_CHARS = 180_000

# References is deliberately excluded: it's a citation list, not content
# relevant to a synthesis question, and it's often the single largest
# section by character count.
SECTIONS_TO_INCLUDE_ORDER = [
    "Abstract",
    "Introduction",
    "Related Work",
    "Method",
    "Experiments",
    "Results",
    "Discussion",
    "Conclusion",
]

SYNTHESIZE_PROMPT_TMPL = """You are drafting a short literature-review paragraph (or two) synthesizing what a \
set of academic papers say about a specific topic/question, for a PhD-adjacent literature review workflow.

Topic/question: {topic}

Below are excerpts from {n_papers} paper(s), each labeled with a citation key you must use for inline \
citations (e.g. "(Vaswani et al. 2017)"). Some papers may only have an abstract/summary available (no full \
text was ingested) -- note this only if it materially limits what you can say, don't dwell on it.

Writing requirements (mirroring this project's research-paper-writing skill conventions for reviewer-facing \
academic prose, applied here to a synthesis paragraph):
- State the paragraph's main point in its first sentence.
- Make every claim about a specific paper backed by an inline citation to that paper's citation key -- \
never assert what a paper says without citing it.
- Keep sentence-to-sentence flow explicit (contrast, consequence, refinement, example) rather than a flat \
list of "Paper A says X. Paper B says Y." sentences.
- Write only about what the excerpts actually support. If a paper doesn't address the topic at all, simply \
omit it from the synthesis rather than forcing a mention -- do not fabricate relevance.
- If none of the papers substantively address the topic, say so plainly in one sentence instead of \
padding out a paragraph -- do not manufacture false depth.
- Output 1-3 paragraphs of plain prose (no headers, no bullet list, no JSON) -- this is going straight into \
a markdown notes file as the synthesized text.
- Do not use caveman/terse/compressed phrasing regardless of any other session-level style preference -- \
this is stored, reviewer-facing academic prose.

{papers_block}

Write the synthesis paragraph(s) now.
"""

CONTRADICTIONS_PROMPT_TMPL = """You are checking a set of academic papers for agreement or disagreement on a \
specific topic/claim, for a PhD-adjacent literature review workflow.

Topic/claim to check: {topic}

Below are excerpts from {n_papers} paper(s), each labeled with a citation key you must use for inline \
citations (e.g. "(Vaswani et al. 2017)"). Some papers may only have an abstract/summary available (no full \
text was ingested).

Task:
- Identify where the papers agree, and where they genuinely disagree or take different approaches, on the \
stated topic/claim.
- Every agreement/disagreement claim must cite the specific paper(s) it's based on by citation key.
- Do NOT fabricate disagreement that isn't actually there. If the papers don't overlap on this topic at all, \
or if they simply don't address it in a way that supports comparison, say so plainly in one sentence -- an \
honest "no clear overlap/disagreement found" is far more useful than a manufactured contrast.
- If the papers agree without meaningful disagreement, say that plainly too, rather than inventing a false \
tension to seem more interesting.
- Structure the output as short prose under two labeled parts: "Agreement:" and "Disagreement:" (each 1-3 \
sentences; either may say "None found" if that's honestly the case). Plain prose, no JSON, no bullet lists.
- Do not use caveman/terse/compressed phrasing regardless of any other session-level style preference -- \
this is stored, reviewer-facing academic prose.

{papers_block}

Write the agreement/disagreement analysis now.
"""


class SynthesisError(RuntimeError):
    pass


def citation_label(meta: dict, slug: str) -> str:
    """Build a short inline-citation-style label, e.g. "Vaswani et al. 2017",
    falling back to title or slug if authors/year are missing."""
    authors = meta.get("authors") or []
    year = meta.get("year")
    if authors:
        last = authors[0].split()[-1]
        label = f"{last} et al." if len(authors) > 1 else last
        if year:
            label += f" {year}"
        return label
    title = meta.get("title")
    if title:
        short = title if len(title) <= 40 else title[:37] + "..."
        return short
    return slug


def resolve_paper_dirs(refs: list[str], papers_dir: Path) -> list[Path]:
    """Resolve CLI refs to paper directories (bare slug under papers_dir, or a
    direct path). Empty refs -> every paper directory under papers_dir that
    has a metadata.yaml, sorted for deterministic output."""
    if not refs:
        if not papers_dir.is_dir():
            raise SynthesisError(f"papers directory {papers_dir} does not exist.")
        dirs = sorted(
            p for p in papers_dir.iterdir() if p.is_dir() and (p / "metadata.yaml").exists()
        )
        if not dirs:
            raise SynthesisError(f"No ingested papers (with metadata.yaml) found under {papers_dir}.")
        return dirs

    dirs = []
    for ref in refs:
        candidate = Path(ref)
        if candidate.is_dir() and (candidate / "metadata.yaml").exists():
            dirs.append(candidate)
            continue
        candidate2 = papers_dir / ref
        if (candidate2 / "metadata.yaml").exists():
            dirs.append(candidate2)
            continue
        raise SynthesisError(
            f"Could not find metadata.yaml for {ref!r}. Tried {candidate} and {candidate2}. "
            "Pass either a papers/<id> directory or the <id> itself (must be already ingested via ingest.py)."
        )
    return dirs


def extract_section_text(md_lines: list[str], start_line: int | None, end_line: int | None) -> str:
    """ingest.py records 1-based [start_line, end_line) boundaries where
    end_line is the next section's start (or len(lines)+1 for the last
    section) -- see metadata.yaml's `sections` field."""
    if start_line is None or end_line is None:
        return ""
    start_idx = max(start_line - 1, 0)
    end_idx = min(max(end_line - 1, start_idx), len(md_lines))
    return "\n".join(md_lines[start_idx:end_idx]).strip()


def build_paper_block(paper_dir: Path) -> tuple[str, str, dict] | None:
    """Return (citation_label, text_block, meta) for one paper, or None if
    the paper has no usable metadata.yaml (skipped with a warning)."""
    meta_path = paper_dir / "metadata.yaml"
    try:
        meta = yaml.safe_load(meta_path.read_text(encoding="utf-8")) or {}
    except (OSError, yaml.YAMLError) as exc:
        print(f"  [warn] Could not read {meta_path} ({exc}); skipping.", file=sys.stderr)
        return None

    slug = paper_dir.name
    label = citation_label(meta, slug)
    title = meta.get("title") or slug

    md_path = paper_dir / "paper.md"
    sections_by_name = {s["name"]: s for s in (meta.get("sections") or [])}

    parts = [f'Paper [{label}] -- "{title}" (slug: {slug})']
    if meta.get("venue") or meta.get("year"):
        parts.append(f"Venue/year: {meta.get('venue') or 'unknown'} / {meta.get('year') or 'unknown'}")

    body_added = False
    if md_path.exists():
        md_lines = md_path.read_text(encoding="utf-8", errors="replace").splitlines()
        section_texts = []
        for name in SECTIONS_TO_INCLUDE_ORDER:
            sec = sections_by_name.get(name)
            if not sec or not sec.get("found"):
                continue
            text = extract_section_text(md_lines, sec.get("start_line"), sec.get("end_line"))
            if text:
                section_texts.append(f"### {name}\n{text}")
        if section_texts:
            combined = "\n\n".join(section_texts)
            truncated = False
            if len(combined) > PER_PAPER_MAX_CHARS:
                combined = combined[:PER_PAPER_MAX_CHARS]
                truncated = True
            parts.append(combined)
            if truncated:
                parts.append(f"... [truncated: {label}'s excerpt exceeds the per-paper size cap] ...")
            body_added = True

    if not body_added:
        # Metadata-only entry (e.g. a paywalled DOI with no attached PDF) or
        # a paper whose extraction found no sections -- fall back to
        # whatever summary text exists rather than dropping the paper
        # entirely, per "must tolerate partial results" (AGENTS.md).
        fallback = meta.get("claude_summary") or meta.get("abstract")
        if fallback:
            parts.append(f"### Summary (no full-text sections available)\n{fallback}")
        else:
            parts.append("(No section text or summary available for this paper -- metadata only.)")

    return label, "\n".join(parts), meta


def build_papers_block(paper_dirs: list[Path]) -> tuple[str, list[tuple[str, str, dict]]]:
    entries = []
    for paper_dir in paper_dirs:
        built = build_paper_block(paper_dir)
        if built is None:
            continue
        entries.append((paper_dir.name, *built))  # (slug, label, text_block, meta)

    if not entries:
        raise SynthesisError("No papers with usable metadata.yaml could be loaded.")

    blocks = [f"--- Paper {i + 1} of {len(entries)} ---\n{text}" for i, (_, _, text, _) in enumerate(entries)]
    combined = "\n\n".join(blocks)
    if len(combined) > TOTAL_MAX_CHARS:
        combined = combined[:TOTAL_MAX_CHARS]
        combined += "\n\n... [truncated: combined paper excerpts exceed the total prompt size cap] ..."
    return combined, [(slug, label, meta) for slug, label, _, meta in entries]


def call_claude(prompt: str, model: str) -> str:
    """Shell out to the claude CLI in non-interactive print mode, same
    credential path as ingest.py's extract_sections_claude(). Raises
    SynthesisError (never silently degrades) on any failure, since there is
    no reasonable non-LLM fallback for synthesis prose.

    `model` is passed through verbatim to the claude CLI's own --model flag
    -- per PLAN.md's Phase 4 decision ("no automatic tiering, user picks the
    model for every call"), there is no default and no validation/whitelist
    here."""
    if shutil.which(CLAUDE_BIN) is None:
        raise SynthesisError(
            "`claude` CLI not found on PATH. Synthesis requires it (same credential path ingest.py's "
            "section extraction uses) -- there is no heuristic fallback for cross-paper synthesis prose."
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
        raise SynthesisError(f"`claude` CLI invocation failed: {exc}") from exc

    if proc.returncode != 0:
        raise SynthesisError(f"`claude` CLI exited {proc.returncode}. stderr: {proc.stderr[:500]!r}")

    try:
        wrapper = json.loads(proc.stdout)
        result_text = wrapper.get("result", "") if isinstance(wrapper, dict) else ""
    except json.JSONDecodeError:
        result_text = proc.stdout

    result_text = result_text.strip()
    # Strip a stray ```-fence in case Claude wraps prose in one despite not
    # being asked to (mirrors ingest.py's same defensive unwrap).
    fence_match = re.match(r"^```(?:\w*)?\s*(.*?)\s*```$", result_text, re.DOTALL)
    if fence_match:
        result_text = fence_match.group(1).strip()

    if not result_text:
        raise SynthesisError("`claude` CLI returned an empty result.")
    return result_text


def slugify(text: str, max_len: int = 60) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return slug[:max_len].strip("-") or "topic"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("topic", help="Topic or question to synthesize across papers, e.g. "
                                       '"how do these papers handle attention/alignment mechanisms"')
    parser.add_argument("paper_ids", nargs="*", help="Paper ids/slugs under papers/ (default: all ingested papers)")
    parser.add_argument("--contradictions", action="store_true",
                         help="Contradiction/agreement-detection mode instead of a plain synthesis paragraph")
    parser.add_argument("--papers-dir", default=None, help="Override the papers/ directory (default: <repo>/papers)")
    parser.add_argument("--out-dir", default=None, help="Override the synthesis/ output directory (default: <repo>/synthesis)")
    parser.add_argument("--print-only", action="store_true", help="Print the synthesis to stdout without writing a file")
    parser.add_argument("--model", required=True,
                         help="Model to pass through verbatim to the claude CLI's --model flag. Required -- "
                              "no default, per PLAN.md's Phase 4 decision that the user picks the model for "
                              "every call (no automatic tiering).")
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parent.parent
    papers_dir = Path(args.papers_dir).expanduser().resolve() if args.papers_dir else repo_root / "papers"
    out_dir = Path(args.out_dir).expanduser().resolve() if args.out_dir else repo_root / "synthesis"

    try:
        paper_dirs = resolve_paper_dirs(args.paper_ids, papers_dir)
        print(f"Synthesizing across {len(paper_dirs)} paper(s): {', '.join(p.name for p in paper_dirs)}",
              file=sys.stderr)
        papers_block, entries = build_papers_block(paper_dirs)

        tmpl = CONTRADICTIONS_PROMPT_TMPL if args.contradictions else SYNTHESIZE_PROMPT_TMPL
        prompt = tmpl.format(topic=args.topic, n_papers=len(entries), papers_block=papers_block)

        print("Calling claude CLI for synthesis (this can take 10-60s)...", file=sys.stderr)
        synthesis_text = call_claude(prompt, args.model)
    except SynthesisError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    mode = "contradictions" if args.contradictions else "synthesize"
    generated_at = datetime.datetime.now(datetime.timezone.utc).isoformat()

    if args.print_only:
        print()
        print(synthesis_text)
        return 0

    out_dir.mkdir(parents=True, exist_ok=True)
    topic_slug = slugify(args.topic)
    filename = f"{topic_slug}-contradictions.md" if args.contradictions else f"{topic_slug}.md"
    out_path = out_dir / filename

    frontmatter = {
        "topic": args.topic,
        "mode": mode,
        "papers": [slug for slug, _, _ in entries],
        "citation_labels": {slug: label for slug, label, _ in entries},
        "generated_at": generated_at,
        "extraction_method": "claude-cli",
        "model": args.model,
    }
    content = "---\n" + yaml.safe_dump(frontmatter, sort_keys=False) + "---\n\n" + synthesis_text + "\n"
    out_path.write_text(content, encoding="utf-8")

    print(f"Wrote {out_path}", file=sys.stderr)
    print()
    print(synthesis_text)
    return 0


if __name__ == "__main__":
    sys.exit(main())

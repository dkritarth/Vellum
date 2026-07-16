#!/usr/bin/env python3
"""
ask.py — M1 single-paper Q&A for local-anara, via paper-qa.

Wires paper-qa's `Docs` (single-document API, not the multi-paper agent
search) to the `papers/<id>/paper.pdf` convention from ingest.py, so you can
ask a question against one already-ingested paper and get an answer with
inline citations back to the source text (paper-qa handles the retrieval —
see AGENTS.md's "no custom RAG" rule; this script is just wiring).

Usage:
    python scripts/ask.py 1706.03762 "What optimizer did they use?"
    python scripts/ask.py papers/1810.04805 "How is NSP pre-training done?"

Requires an LLM API key paper-qa can use, since paper-qa calls the
Anthropic/OpenAI APIs directly via LiteLLM (unlike ingest.py's Claude-driven
extraction pass, which shells out to the already-authenticated `claude` CLI
and needs no raw API key). Set one of:
    ANTHROPIC_API_KEY   -> uses claude-3-5-sonnet-latest as the LLM
    OPENAI_API_KEY      -> uses gpt-4o-mini as the LLM (paper-qa's default family)
Embeddings default to a local, no-API-key sparse (BM25-style) embedding so
only one LLM key is strictly required; pass --embedding to override (e.g.
"text-embedding-3-small" if you have OPENAI_API_KEY and prefer dense
embeddings).

If neither key is set, this script prints a clear error and exits non-zero
— it does not fake an answer. See NOTES.md for why: in the environment this
project was built in, no such key was available, so this path is wired but
untested end-to-end with a live LLM call.
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
from pathlib import Path


def resolve_paper_dir(ref: str, repo_root: Path) -> Path:
    """Accept either a bare arxiv-id-style slug (papers/<ref>/) or a direct
    path to a paper directory."""
    candidate = Path(ref)
    if candidate.is_dir() and (candidate / "paper.pdf").exists():
        return candidate

    papers_dir_candidate = repo_root / "papers" / ref
    if (papers_dir_candidate / "paper.pdf").exists():
        return papers_dir_candidate

    raise FileNotFoundError(
        f"Could not find a paper.pdf for {ref!r}. Tried {candidate} and {papers_dir_candidate}. "
        "Pass either a papers/<id> directory or the <id> itself (must be already ingested via ingest.py)."
    )


def build_settings(llm: str | None, embedding: str):
    from paperqa import Settings
    from paperqa.settings import AgentSettings

    if llm is None:
        if os.environ.get("ANTHROPIC_API_KEY"):
            llm = "anthropic/claude-3-5-sonnet-latest"  # LiteLLM provider-prefixed model string
        elif os.environ.get("OPENAI_API_KEY"):
            llm = "gpt-4o-mini"
        else:
            raise RuntimeError(
                "No LLM API key found. paper-qa needs ANTHROPIC_API_KEY or OPENAI_API_KEY "
                "set (it calls the provider API directly via LiteLLM, unlike ingest.py's "
                "Claude-CLI-based extraction pass). See NOTES.md for details."
            )

    return Settings(
        llm=llm,
        summary_llm=llm,
        embedding=embedding,
        agent=AgentSettings(index={"paper_directory": "."}),
    )


async def ask_paper(paper_dir: Path, question: str, llm: str | None, embedding: str) -> None:
    from paperqa import Docs

    settings = build_settings(llm, embedding)

    docs = Docs()
    pdf_path = paper_dir / "paper.pdf"
    print(f"Adding {pdf_path} to paper-qa index ...", file=sys.stderr)
    await docs.aadd(pdf_path, settings=settings)

    print(f"Querying: {question!r}", file=sys.stderr)
    session = await docs.aquery(question, settings=settings)

    print()
    print(session.formatted_answer if hasattr(session, "formatted_answer") else session.answer)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("paper_ref", help="papers/<id> directory, or bare <id> under papers/")
    parser.add_argument("question", help="Question to ask against this single paper")
    parser.add_argument(
        "--llm",
        default=None,
        help="Override the LLM model string passed to paper-qa/LiteLLM (default: auto-picked from available API key)",
    )
    parser.add_argument(
        "--embedding",
        default="sparse",
        help='Embedding model for paper-qa (default: "sparse" — a local BM25-style embedding needing '
        "no API key; pass e.g. text-embedding-3-small if you have OPENAI_API_KEY and want dense embeddings)",
    )
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parent.parent
    try:
        paper_dir = resolve_paper_dir(args.paper_ref, repo_root)
    except FileNotFoundError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    try:
        asyncio.run(ask_paper(paper_dir, args.question, args.llm, args.embedding))
    except Exception as exc:  # noqa: BLE001 - top-level CLI error boundary
        print(f"error: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

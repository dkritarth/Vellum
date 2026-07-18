"""Phase 4 browse-only local web UI.

FastAPI app that reads directly off papers/, synthesis/, citations/ on disk
-- no database, no write path yet (that's workstream 2 step 2, actions from
the UI). Thin read layer only; all real logic still lives in scripts/.

Run locally:
    source .venv/bin/activate
    uvicorn webapp.main:app --reload
Then open http://127.0.0.1:8000/
"""

from __future__ import annotations

from pathlib import Path

import markdown as md_lib
import yaml
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

REPO_ROOT = Path(__file__).resolve().parent.parent
PAPERS_DIR = REPO_ROOT / "papers"
SYNTHESIS_DIR = REPO_ROOT / "synthesis"
CITATIONS_DIR = REPO_ROOT / "citations"

app = FastAPI(title="local-anara")
app.mount("/static", StaticFiles(directory=str(Path(__file__).parent / "static")), name="static")
templates = Jinja2Templates(directory=str(Path(__file__).parent / "templates"))


def _load_metadata(paper_dir: Path) -> dict | None:
    meta_path = paper_dir / "metadata.yaml"
    if not meta_path.exists():
        return None
    return yaml.safe_load(meta_path.read_text(encoding="utf-8")) or {}


def _list_papers() -> list[dict]:
    if not PAPERS_DIR.is_dir():
        return []
    papers = []
    for paper_dir in sorted(PAPERS_DIR.iterdir()):
        if not paper_dir.is_dir():
            continue
        meta = _load_metadata(paper_dir)
        if meta is None:
            continue
        papers.append({"slug": paper_dir.name, **meta})
    return papers


def _render_markdown_file(path: Path) -> str:
    text = path.read_text(encoding="utf-8", errors="replace")
    return md_lib.markdown(text, extensions=["tables", "fenced_code"])


@app.get("/", response_class=HTMLResponse)
def dashboard(request: Request):
    papers = _list_papers()
    synthesis_files = sorted(p.name for p in SYNTHESIS_DIR.glob("*.md")) if SYNTHESIS_DIR.is_dir() else []
    has_citations_report = (CITATIONS_DIR / "report.md").exists()
    return templates.TemplateResponse(
        request,
        "dashboard.html",
        {
            "papers": papers,
            "synthesis_files": synthesis_files,
            "has_citations_report": has_citations_report,
        },
    )


@app.get("/papers/{slug}", response_class=HTMLResponse)
def paper_detail(request: Request, slug: str):
    paper_dir = PAPERS_DIR / slug
    meta = _load_metadata(paper_dir)
    if meta is None:
        raise HTTPException(status_code=404, detail=f"No metadata.yaml for paper {slug!r}")
    paper_md_path = paper_dir / "paper.md"
    paper_html = _render_markdown_file(paper_md_path) if paper_md_path.exists() else None
    citations_path = paper_dir / "citations.yaml"
    citations = yaml.safe_load(citations_path.read_text(encoding="utf-8")) if citations_path.exists() else None
    return templates.TemplateResponse(
        request,
        "paper_detail.html",
        {
            "slug": slug,
            "meta": meta,
            "paper_html": paper_html,
            "citations": citations,
        },
    )


@app.get("/synthesis/{name}", response_class=HTMLResponse)
def synthesis_detail(request: Request, name: str):
    path = SYNTHESIS_DIR / name
    if not path.is_file() or path.parent != SYNTHESIS_DIR:
        raise HTTPException(status_code=404, detail=f"No synthesis file {name!r}")
    html = _render_markdown_file(path)
    return templates.TemplateResponse(
        request, "doc.html", {"title": name, "html": html}
    )


@app.get("/citations", response_class=HTMLResponse)
def citations_report(request: Request):
    path = CITATIONS_DIR / "report.md"
    if not path.exists():
        raise HTTPException(status_code=404, detail="No citations/report.md yet -- run scripts/citations.py")
    html = _render_markdown_file(path)
    return templates.TemplateResponse(
        request, "doc.html", {"title": "Citation graph report", "html": html}
    )

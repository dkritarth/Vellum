"""Phase 4 local web UI: browse + trigger pipeline actions.

FastAPI app that reads directly off papers/, synthesis/, citations/ on disk
-- no database. Browse routes are read-only; the /actions routes shell out
to the existing scripts/{ingest,synthesize,citations}.py as subprocesses
(argv-list form only, never shell=True) so all real pipeline logic still
lives in scripts/, not here.

Run locally:
    source .venv/bin/activate
    uvicorn webapp.main:app --reload
Then open http://127.0.0.1:8000/
"""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

import markdown as md_lib
import yaml
from fastapi import FastAPI, Form, HTTPException, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

REPO_ROOT = Path(__file__).resolve().parent.parent
PAPERS_DIR = REPO_ROOT / "papers"
SYNTHESIS_DIR = REPO_ROOT / "synthesis"
CITATIONS_DIR = REPO_ROOT / "citations"
SCRIPTS_DIR = REPO_ROOT / "scripts"

# Reuse the repo's own venv interpreter so shelled-out scripts see the same
# deps (markitdown/requests/pyyaml/paper-qa) this app itself needs -- a bare
# `python3` on PATH may be a different, dependency-less interpreter. Fall
# back to sys.executable (the interpreter running this FastAPI app) only if
# the venv is missing, e.g. a fresh checkout that hasn't run the one-time
# setup in CLAUDE.md yet.
_VENV_PYTHON = REPO_ROOT / ".venv" / "bin" / "python3"
PYTHON_BIN = str(_VENV_PYTHON) if _VENV_PYTHON.exists() else sys.executable

# Scripts shell out to `claude -p` with their own CLAUDE_TIMEOUT_SECONDS
# (ingest.py: 240s, synthesize.py: 300s, citations.py: 240s) for a single
# claude-cli call. These are the whole-script wall-clock budgets from this
# web UI's synchronous subprocess.run, so they need headroom beyond that for
# downloads/PDF conversion/multiple calls, not just one claude invocation.
INGEST_TIMEOUT_SECONDS = 360
SYNTHESIZE_TIMEOUT_SECONDS = 420
CITATIONS_TIMEOUT_SECONDS = 360

_TAIL_N = 200

app = FastAPI(title="local-anara")
app.mount("/static", StaticFiles(directory=str(Path(__file__).parent / "static")), name="static")
templates = Jinja2Templates(directory=str(Path(__file__).parent / "templates"))


def _tail(text: str, n: int = _TAIL_N) -> str:
    lines = text.splitlines()
    return "\n".join(lines[-n:])


def _run_script(args: list[str], timeout: int) -> subprocess.CompletedProcess:
    """Run a scripts/*.py subprocess. argv-list form only -- never shell=True,
    and no user input is ever string-interpolated into a shell command; each
    form field is passed as its own argv element."""
    cmd = [PYTHON_BIN, *args]
    try:
        return subprocess.run(
            cmd,
            cwd=str(REPO_ROOT),
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except subprocess.TimeoutExpired as exc:
        return subprocess.CompletedProcess(
            cmd,
            returncode=-1,
            stdout=(exc.stdout or ""),
            stderr=(exc.stderr or "") + f"\n[timed out after {timeout}s]",
        )


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


@app.get("/actions", response_class=HTMLResponse)
def actions_form(request: Request):
    return templates.TemplateResponse(request, "actions.html", {})


def _action_result_response(
    request: Request,
    action: str,
    result: subprocess.CompletedProcess,
    slug: str | None = None,
) -> HTMLResponse:
    return templates.TemplateResponse(
        request,
        "action_result.html",
        {
            "action": action,
            "ok": result.returncode == 0,
            "returncode": result.returncode,
            "cmd": " ".join(result.args),
            "stdout_tail": _tail(result.stdout),
            "stderr_tail": _tail(result.stderr),
            "tail_n": _TAIL_N,
            "slug": slug,
        },
    )


@app.post("/actions/ingest", response_class=HTMLResponse)
def action_ingest(request: Request, paper_ref: str = Form(...), model: str = Form(...)):
    result = _run_script(
        [str(SCRIPTS_DIR / "ingest.py"), paper_ref, "--model", model],
        timeout=INGEST_TIMEOUT_SECONDS,
    )
    slug = None
    match = re.search(r"Done\. Wrote (.+?)/?\s*$", result.stdout, re.MULTILINE)
    if match:
        slug = Path(match.group(1)).name
    return _action_result_response(request, "Ingest", result, slug=slug)


@app.post("/actions/synthesize", response_class=HTMLResponse)
def action_synthesize(
    request: Request,
    topic: str = Form(...),
    model: str = Form(...),
    paper_ids: str = Form(""),
    contradictions: bool = Form(False),
):
    args = [str(SCRIPTS_DIR / "synthesize.py"), topic]
    ids = [pid.strip() for pid in paper_ids.split(",") if pid.strip()]
    args.extend(ids)
    if contradictions:
        args.append("--contradictions")
    args.extend(["--model", model])
    result = _run_script(args, timeout=SYNTHESIZE_TIMEOUT_SECONDS)
    return _action_result_response(request, "Synthesize", result)


@app.post("/actions/citations/build", response_class=HTMLResponse)
def action_citations_build(
    request: Request,
    model: str = Form(...),
    no_external: bool = Form(False),
):
    args = [str(SCRIPTS_DIR / "citations.py"), "build", "--model", model]
    if no_external:
        args.append("--no-external")
    result = _run_script(args, timeout=CITATIONS_TIMEOUT_SECONDS)
    return _action_result_response(request, "Build citations", result)

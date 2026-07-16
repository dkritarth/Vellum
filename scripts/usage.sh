#!/usr/bin/env bash
# Token/cost usage for local-anara's own Claude Code sessions and background
# agents. Thin filter over the global tracker at ~/.claude/scripts/token_tracker.py
# (which scans every ~/.claude/projects/**/*.jsonl transcript on the machine);
# this just scopes the report to project dirs whose name contains "local-anara"
# so worktree-isolated agent sessions are included too.
set -euo pipefail
exec python3 "$HOME/.claude/scripts/token_tracker.py" report --project local-anara "$@"

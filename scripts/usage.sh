#!/usr/bin/env bash
# Token/cost usage for local-anara's own Claude Code sessions and background
# agents. Thin filter over the global tracker at ~/.claude/scripts/token_tracker.py
# (which scans every ~/.claude/projects/**/*.jsonl transcript on the machine);
# this just scopes the report to project dirs whose name contains "local-anara"
# so worktree-isolated agent sessions are included too.
set -euo pipefail
tracker_script="$HOME/.claude/scripts/token_tracker.py"

# Refresh incrementally first, so sessions created since the previous report
# are included. The tracker deduplicates assistant message IDs.
python3 "$tracker_script" scan >/dev/null
exec python3 "$tracker_script" report --project local-anara "$@"

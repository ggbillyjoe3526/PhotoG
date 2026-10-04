#!/usr/bin/env bash
# Run the project's critic (.claude/agents/critic.md) as a separate Claude Code
# process pinned to Opus 5.5 at "Extra" (xhigh) effort.
#   tools/dev/run-critic.sh <prompt-file> <report-file>
# Must run from the repo root so the project agent is found. The report
# (markdown) is written to <report-file>; raw JSON goes to <report-file>.json.
set -euo pipefail
prompt_file=$1
report=$2
cd "$(dirname "$0")/../.."
sid=$(python3 -c 'import uuid; print(uuid.uuid4())')
claude -p --agent critic --model claude-opus-5-5 --effort xhigh \
  --no-session-persistence --session-id "$sid" \
  --allowedTools "Read,Glob,Grep,Bash" --output-format json \
  < "$prompt_file" > "$report.json"
python3 - "$report.json" "$report" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
models = ', '.join(d.get('modelUsage', {}).keys())
open(sys.argv[2], 'w').write(f"<!-- critic model(s): {models} -->\n" + (d.get('result') or '(no result)') + "\n")
print(f"critic finished ({models}); report: {sys.argv[2]}")
PY

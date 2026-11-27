#!/usr/bin/env bash
# Fails if any doc is over its word cap (1 page = 500 words).
# Caps below are authoritative (see CLAUDE.md rule 5). Any other .md that declares
# <!-- cap: N words --> is checked against its declared cap, except verbatim transcripts.
# A "word" is any whitespace-separated token after stripping HTML comments, as `wc -w`
# counts it. Table pipes count: a reviewer counting the page with wc gets the same number.
set -euo pipefail
cd "$(dirname "$0")/.."

declare -A CAPS=(
  [PRD.md]=500
  [DESIGN.md]=1000
  [CAPACITY.md]=500
  [LOADTEST.md]=500
  [OPS.md]=500
  [ROADMAP.md]=500
  [CHANGE-RESPONSE.md]=500
  [ai/AI-NOTES.md]=250
)

count_words() {
  perl -0pe 's/<!--.*?-->//gs' "$1" | wc -w
}

fail=0
for f in "${!CAPS[@]}"; do
  [[ -f "$f" ]] || { echo "MISSING  $f"; fail=1; }
done

while IFS= read -r f; do
  f="${f#./}"
  cap="${CAPS[$f]:-}"
  # Historical quoted documents are evidence, not separately capped deliverables.
  if [[ -z "$cap" && "$f" == ai/transcripts/* ]]; then continue; fi
  if [[ -z "$cap" ]]; then
    cap=$(grep -oP '<!--\s*cap:\s*\K[0-9]+' "$f" | head -1 || true)
    [[ -n "$cap" ]] || continue
  fi
  n=$(count_words "$f")
  if (( n > cap )); then
    printf 'OVER     %-22s %5d / %d words\n' "$f" "$n" "$cap"; fail=1
  else
    printf 'ok       %-22s %5d / %d words\n' "$f" "$n" "$cap"
  fi
done < <(find . -name '*.md' -not -path '*/node_modules/*' -not -path './.git/*' | sort)

exit "$fail"

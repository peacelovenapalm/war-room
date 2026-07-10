#!/bin/bash
# war-room v3 imagegen lane — one codex $imagegen call per asset.
#
#   gen.sh <asset-name> [<asset-name> ...]
#   gen.sh --category portraits          # every asset in a category
#   gen.sh --missing                     # every asset with no raw PNG yet
#
# Reads spec.json (sibling), writes raw PNGs to ../out/imagegen-raw/.
# CRITICAL: $imagegen must reach codex LITERALLY — the prompt is built
# with single-quoted printf formats so zsh/bash never expand it
# (verified invocation pattern, Diablito 2026-07-06).
# Images bill the ChatGPT subscription ~3-5x faster than text turns:
# one image per call, no retries inside this script.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SPEC="$HERE/spec.json"
RAW="$HERE/../out/imagegen-raw"
REPO="$(cd "$HERE/../../.." && pwd)"
mkdir -p "$RAW"

names=()
if [[ "${1:-}" == "--category" ]]; then
  names=($(python3 -c "
import json,sys
spec=json.load(open('$SPEC'))
print('\n'.join(a['name'] for a in spec['assets'] if a['category']==sys.argv[1]))" "$2"))
elif [[ "${1:-}" == "--missing" ]]; then
  names=($(python3 -c "
import json,os
spec=json.load(open('$SPEC'))
print('\n'.join(a['name'] for a in spec['assets']
                if not os.path.exists(os.path.join('$RAW', a['name']+'.png'))))"))
else
  names=("$@")
fi
[[ ${#names[@]} -gt 0 ]] || { echo "gen.sh: nothing to generate" >&2; exit 1; }

for name in "${names[@]}"; do
  out="$RAW/$name.png"
  # Compose the full prompt (style block + framing block + subject) in python;
  # stdout of $(...) is never re-expanded by the shell, so $imagegen survives.
  prompt="$(python3 - "$name" "$out" "$SPEC" <<'PYEOF'
import json, sys
name, out = sys.argv[1], sys.argv[2]
spec = json.load(open(sys.argv[3]))
a = next(x for x in spec["assets"] if x["name"] == name)
parts = ["Use $imagegen to generate the following image at exactly "
         + a["genSize"] + " pixels. Save it as " + out]
parts.append(a["prompt"])
parts.append(spec["styleBlock"])
if a["category"] == "portraits":
    parts.append(spec["portraitBlock"])
print("\n\n".join(parts))
PYEOF
)"
  echo "=== [$name] $(date +%H:%M:%S) generating -> $out"
  if (cd "$REPO" && codex exec --skip-git-repo-check -s workspace-write "$prompt") \
      > "$RAW/$name.codex.log" 2>&1; then
    if [[ -f "$out" ]]; then
      echo "=== [$name] OK $(du -h "$out" | cut -f1) $(python3 -c "
from PIL import Image; print('%dx%d' % Image.open('$out').size)")"
    else
      echo "=== [$name] FAIL codex exited 0 but $out missing (see $name.codex.log)" >&2
    fi
  else
    echo "=== [$name] FAIL codex exit $? (see $name.codex.log)" >&2
  fi
done

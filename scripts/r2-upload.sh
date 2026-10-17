#!/usr/bin/env bash
# Usage: scripts/r2-upload.sh <folder> <path/to/file.pdf>
# Uploads a PDF into <folder> in the bucket. Any folder name works – a new folder becomes a new section
# in the library automatically (no code change). Folders starting with "_" or ".", and "Annotation", are reserved.
set -euo pipefail

folder="${1:-}"; file="${2:-}"
[[ -n "$folder" && -n "$file" ]] || { echo "Usage: $0 <folder> <file.pdf>" >&2; exit 1; }
[[ "$folder" != _* && "$folder" != .* && "$folder" != */* && "${folder,,}" != "annotation" ]] || { echo "Invalid folder name: $folder" >&2; exit 1; }
[[ -f "$file" ]] || { echo "File not found: $file" >&2; exit 1; }

npx wrangler r2 object put "baws/${folder}/$(basename "$file")" --file "$file" --content-type application/pdf --remote

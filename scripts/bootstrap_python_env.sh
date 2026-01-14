#!/bin/bash

# Ensure a Python virtual environment exists and contains the OneSub deps.

set -euo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$( cd "$SCRIPT_DIR/.." && pwd )"
VENV_DIR="${ONESUB_PYTHON_VENV:-$PROJECT_ROOT/.venv}"
PYTHON_BIN="$VENV_DIR/bin/python3"
STAMP_FILE="$VENV_DIR/.onesub-deps"

if [ ! -x "$PYTHON_BIN" ]; then
  echo "Creating Python virtualenv at $VENV_DIR"
  python3 -m venv "$VENV_DIR"
fi

ENV_HASH="$(
  python3 - <<'PY' "$PROJECT_ROOT"
import hashlib
import pathlib
import sys

root = pathlib.Path(sys.argv[1])
hash_obj = hashlib.sha256()
for name in ("pyproject.toml", "requirements.txt"):
    path = root / name
    if path.exists():
        hash_obj.update(path.read_bytes())
print(hash_obj.hexdigest())
PY
)"

if [ ! -f "$STAMP_FILE" ] || [ "$ENV_HASH" != "$(cat "$STAMP_FILE")" ]; then
  echo "Installing OneSub dependencies (this may take a moment)..."
  "$PYTHON_BIN" -m pip install --upgrade pip
  "$PYTHON_BIN" -m pip install -e "$PROJECT_ROOT"
  echo "$ENV_HASH" > "$STAMP_FILE"
else
  echo "Python environment already up to date."
fi

#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
export PYTHONDONTWRITEBYTECODE=1
export UV_PROJECT_ENVIRONMENT="$(pwd)/.tools/host-tests"
uv sync --project vendor/kaipi --frozen --no-dev --no-install-project
"$UV_PROJECT_ENVIRONMENT/bin/python" tests/test_bridge.py

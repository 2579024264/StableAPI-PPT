#!/bin/sh
set -eu

cd /app

if ! uv run --directory backend alembic upgrade head; then
    echo "WARNING: Alembic upgrade failed before backend startup; app.py will retry and fall back to create_all when possible." >&2
fi

exec uv run --directory backend python app.py

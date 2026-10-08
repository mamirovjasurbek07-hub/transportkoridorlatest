#!/bin/sh
set -eu

attempt=1
max_attempts="${DATABASE_STARTUP_RETRIES:-12}"

while ! alembic upgrade head; do
  if [ "$attempt" -ge "$max_attempts" ]; then
    echo "Database migration failed after $attempt attempts." >&2
    exit 1
  fi

  delay=$((attempt * 5))
  if [ "$delay" -gt 30 ]; then
    delay=30
  fi
  echo "Database is not ready; retrying migration in ${delay}s (${attempt}/${max_attempts})." >&2
  sleep "$delay"
  attempt=$((attempt + 1))
done

exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}"

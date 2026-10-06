#!/bin/sh
# KACP app runtime entrypoint (docs/README.md 5단계 결정).
# The source folder is mounted read-only at /src. It is copied to /app (writable), dependencies are
# installed there, then KACP_COMMAND runs. The source is never modified. Data goes to /app-data.
set -eu
: "${KACP_RUNTIME:?}" "${KACP_COMMAND:?}" "${PORT:?}"
export HOST=0.0.0.0 APP_DATA_DIR=/app-data

echo "[kacp] runtime=$KACP_RUNTIME port=$PORT"
if [ "$KACP_RUNTIME" != static ]; then
  cp -a /src/. /app/
  cd /app
fi

case "$KACP_RUNTIME" in
  node)
    if [ -f package.json ] && [ ! -d node_modules ]; then
      echo "[kacp] installing node dependencies"
      if [ -f package-lock.json ]; then npm ci --omit=dev --no-audit --no-fund; else npm install --omit=dev --no-audit --no-fund; fi
    fi
    ;;
  python)
    if [ -f requirements.txt ]; then
      echo "[kacp] installing python dependencies"
      pip install --no-cache-dir --disable-pip-version-check --target /app/.deps -r requirements.txt
      export PYTHONPATH="/app/.deps${PYTHONPATH:+:$PYTHONPATH}"
    fi
    ;;
  static)
    cd /src
    ;;
esac

echo "[kacp] exec: $KACP_COMMAND"
exec sh -c "$KACP_COMMAND"

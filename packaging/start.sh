#!/bin/sh
set -eu
PACKAGE_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec "$PACKAGE_DIR/runtime/bin/node" "$PACKAGE_DIR/app/server.mjs"

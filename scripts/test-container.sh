#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
runtime=docker
if command -v podman >/dev/null 2>&1; then runtime=podman; fi
version=$(node -p 'require("./package.json").devDependencies["@playwright/test"]')
image="mcr.microsoft.com/playwright:v${version}-noble"
container=$($runtime create --platform linux/amd64 --init --ipc=host -e CI=1 -e AX_SCREENSHOTS=1 -w /work "$image" sleep infinity)
trap '$runtime rm -f "$container" >/dev/null' EXIT
$runtime start "$container" >/dev/null
COPYFILE_DISABLE=1 tar --no-xattrs --exclude='._*' --exclude=./node_modules --exclude=./.git --exclude=./test-results --exclude=./playwright-report -cf - . | "$runtime" exec -i "$container" tar -xf - -C /work
"$runtime" exec "$container" npm install --ignore-scripts --no-audit --no-fund
status=0
"$runtime" exec "$container" npx playwright test "$@" || status=$?
"$runtime" cp "$container:/work/tests/ax.spec.ts-snapshots/." tests/ax.spec.ts-snapshots/
"$runtime" cp "$container:/work/test-results/." test-results/
exit "$status"

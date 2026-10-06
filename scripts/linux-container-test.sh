#!/usr/bin/env bash
set -euo pipefail
mkdir -p /proof
node -e 'console.log(JSON.stringify({node:process.version,platform:process.platform,arch:process.arch}))' | tee /proof/runtime.json
uname -a | tee /proof/kernel.txt
export HAT_NATIVE_HELPER="/app/native/sampler/artifacts/linux-$(node -p 'process.arch')/hat-sampler"
npm run check 2>&1 | tee /proof/typecheck.log
npm test 2>&1 | tee /proof/tests.log
node scripts/smoke.mjs 2>&1 | tee /proof/terminal.json
node scripts/release.mjs --output /proof/release --platform "linux-$(node -p 'process.arch')" 2>&1 | tee /proof/release.log
node scripts/check-distribution.mjs --root /proof/release --platform linux --arch "$(node -p 'process.arch')" 2>&1 | tee /proof/distribution.json
node scripts/herdr-test-bin.mjs --output /proof/herdr-test-bin 2>&1 | tee /proof/herdr-source.json
export HERDR_BIN_PATH="/proof/herdr-test-bin/herdr-linux-$(node -p 'process.arch === "arm64" ? "aarch64" : "x86_64"')"
node scripts/live-herdr-test.mjs --release /proof/release --proof /proof/live-herdr 2>&1 | tee /proof/live-herdr.log
node /proof/release/scripts/check-install.mjs --root /proof/release 2>&1 | tee /proof/preflight.json
node /proof/release/dist/entrypoints/inspector.js --demo --once 2>&1 | tee /proof/demo.txt

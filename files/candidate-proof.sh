set -e
. /tmp/rer-cloud-toolchain.sh
export PATH="$HOME/.rer/node/node-v22.20.0-linux-x64/bin:$PATH"
cloud_run timeout 600 node --test --test-name-pattern='^(API-004|DEV-012):' tests/coffer.test.mjs
pnpm typecheck
node scripts/edition-authoring/cli.mjs check > /tmp/coffer-exact-lock-check.json
cloud_run npx -y @runeditrun/rer check --profile first-party
node /tmp/coffer-ledger-probe.mjs

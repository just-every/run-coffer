# Coffer Zapier package

This is an **unpublished** Coffer-only integration. It connects an existing
installation key and provides **Create Non-Ask Task**. It has no webhook trigger,
credential administration, arbitrary command, export or provider-send action.
It does not establish Zapier publication, hosted qualification or a working
Crank connector.

Use Node 22.20.0. The Zapier runtime and CLI are both pinned to 18.4.0; the
package lock fixes their dependency graph. From this directory:

```sh
npm ci --no-audit --no-fund
npm run validate
```

The validation script runs the actual `zapier validate --without-style` command.
It validates the loaded package locally without signing in, registering an app
or contacting Zapier for publication checks. A successful result means the
package is structurally sound; it does not mean the app has been published or
that Zapier has accepted a production installation. Push Verify installs and
validates this same package before executing its task journey.

## Connect an existing key

In your installation, a current native owner or admin explicitly creates a
**full local API key** using Coffer's existing native API-key door. Supply that
key and the installation's HTTPS origin in the connection fields. Do not put
keys in source files, input examples or source-event fields. The connection
checks the authenticated OpenAPI endpoint; it does not issue a new key, upgrade
its scope or change its expiry. A read-only or gift-entry key cannot create a
task. A full key retains only API-001's documented local allowlist and the
creator's current authority, expiration and revocation checks.

## Create an owned non-ask task

Map all six inputs explicitly:

- **Stable Invocation ID:** an opaque source event identity unique to this task
  step, for example `synthetic-coffer-7106`. Reuse it and the exact same inputs
  on retries. Do not generate the value from the current time or a new random
  value on each execution. Use a distinct step suffix if one event intentionally
  creates more than one task. Do not place personal data or credentials here.
- **Constituent ID:** the exact current native record; merged or erased IDs are
  refused. There is no automatic name or email match.
- **Task Owner ID:** an explicitly selected active native team member ID.
- **Due Date:** an exact `YYYY-MM-DD` calendar date.
- **Task Kind:** call, meeting, thank_you, follow_up or data_fix.
- **Task Title:** the instruction the owner will see in the native task list.

The action posts only those task facts plus `isAsk: false` to
`/api/coffer/v1/tasks`, with `Idempotency-Key` equal to `zapier:task:` followed by
the invocation ID. It returns only the native task ID. The native task rules
validate the donor, owner, date, kind, title and current authority. A solicitation
restriction does not block this non-ask task and is never cleared by it. No
message is sent and no payment is requested.

Concurrent executions, a retry after a lost response and unchanged retries
under the same key and installation return the same task. Reusing an invocation
ID with different task inputs is a conflict: review the original task before
choosing a new identity for an intentional new operation. Do not switch keys to
work around an uncertain result. Replay is principal-bound: replacing a key or
restoring an archive does **not** transfer the old key's replay guarantee. Keys
and receipts are not restored. Revoked, expired or changed creator authority is
refused even for a previously successful invocation. Donor erasure removes its
receipts and prevents replay from returning its old identifier.

Requests refuse redirects; a redirect never forwards the installation key to a
new location. Reconnect with the correct HTTPS origin instead. Rate limits and
native refusals remain in effect. Transient retries must preserve all inputs.

## Proof and remaining scope

`tests/zapier-journey.mjs` runs the packaged action using the pinned Zapier
runtime over a local HTTPS transport into actual Coffer HTTP handlers. Its only
transport adaptation is trust for an ephemeral test certificate. It reads the
owned task and audit, checks concurrent and lost-response retries, conflicts,
limited scopes, expiry, revocation, changed creator authority, native validation,
restricted-donor non-asks, merged and erased identities, redirect refusal and
archive custody. It mocks no Coffer service. It is registered in
`tests/coffer.test.mjs` under API-003 and runs in push Verify's donors shard.

API-003 remains partial. The gift-triggered Crank flow depends on Crank
CONN-010 and TRIG-001 admitting Coffer's timestamped signature and named task
creation action. No sibling repository is changed here. Zapier webhook triggers,
the remaining API actions, publication, hosted qualification and full clause
acceptance remain owed. Any future webhook door must inherit API-002's native
endpoint approval, current authority, identifier-only disclosure, signing,
replay lineage and custody rules, including the unchanged RL-101 ruling. This
package introduces no webhook door or new policy grant. Wider TEAM-001 roles
and existing account, ct, Base and device holds remain unchanged.

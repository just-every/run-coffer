# Coffer Zapier package

This **unpublished** Coffer-only integration connects an existing installation
key. It supplies the eight native signed webhook triggers, named local record
actions and exact-ID searches. It supplies no credential administration,
arbitrary command, export, merge, erasure, plan mutation, campaign publication
or direct provider-send action. Local validation does not establish publication,
hosted qualification or a working Crank connector.

## Validate locally

Use Node 22.20.0. The Zapier runtime and CLI remain pinned to 18.4.0; the
package lock fixes their dependency graph. From this directory:

```sh
npm ci --no-audit --no-fund
npm run validate
```

The script executes the actual `zapier validate --without-style` against the
loaded package without signing in or registering an app. Push Verify performs
the same validation and executes the package against native Coffer handlers.
Manual webhook setup produces style warnings that are deliberately excluded
from structural validation. Publishing and hosted installation qualification
require separate Zapier review and are not claimed here.

## Connect an existing key

In Coffer Settings, a current native owner or admin explicitly creates an
expiring public API key. Supply it and the installation HTTPS origin in the
connection fields. The connection checks the authenticated OpenAPI endpoint;
it cannot issue, upgrade, extend or administer keys. Read only permits the
native resource reads. Gift entry permits its existing resource reads and gift
recording. Full permits only API-001's documented local allowlist under the
creator's current authority. Revocation, expiry and changed creator authority
apply to every action and trigger, including retries.

## Receive a signed event

The static hooks are gift created, gift reversed, donor created, donor updated,
plan failed, plan canceled, task assigned and form submitted. They expose only
`id`, `type`, `occurredAt` and `data.id`. They neither fetch donor details nor
expand the approved disclosure. Use an exact-ID search as a separately scoped
step when a workflow needs native record context.

1. Select the trigger and copy its Zapier hook URL.
2. In native Coffer Settings, explicitly review and approve that exact public
   HTTPS URL and event. Use the same owner or admin who created the connection
   key. Supply the resulting endpoint ID and that exact hook URL in the trigger
   inputs. Zapier does not supply `bundle.targetUrl` during trigger execution.
3. Use a full key for this connection. Coffer retains its sealed signing key;
   the connector does not copy it into Zapier. To test the trigger, perform the
   actual native operation, then allow Coffer's scheduled delivery to run.
4. Map the stable event `id` to each downstream action's Stable Invocation ID,
   with a distinct step suffix when one event intentionally creates multiple
   records. Map `data.id` only to the resource it identifies: for gift events,
   first find that gift and take its `donor_id` for a constituent input.
5. Before removing or turning off the Zap, pause its endpoint in native Coffer
   Settings. Zapier cannot pause, create, resume or replay subscriptions.

The trigger forwards the exact raw capture, combined timestamped signature,
delivery ID from Zapier’s `Http-Coffer-*` headers and the configured hook URL
to `/api/coffer/v1/webhook-receipts/verify`.
This read-only verification door checks the current full key and approver,
exact active approved endpoint, signed raw bytes within five minutes, current
signing authority and any explicitly approved overlap, actual event and delivery,
and retained identifier-only canonical content. It returns no signing key.
Paused endpoints, held or erased deliveries, wrong receivers, another approver's
key, changed signatures and stale captures are refused. Recovery stays paused;
resume releases no held history. Native replay retains the same event identity
and lineage, and donor erasure removes captures' backing events. Rotation and
recovery continue through the existing reviewed native API-002 doors, under
RL-101; this connector grants no new custody authority.

Zapier uses the stable event ID for trigger deduplication. Deliveries can still
be repeated. Downstream native writes must use that same stable invocation ID
and the same principal; no exactly-once claim crosses replacement keys or an
archive restore. A capture accepted before authority changes cannot retract a
Zap already executing; every later Coffer write independently checks its own
current key, scope, record identity and native authority.

## Create an owned non-ask task

Map the constituent ID, active native owner ID, exact `YYYY-MM-DD` due date,
task kind, title and Stable Invocation ID explicitly. Task kind is call,
meeting, thank_you, follow_up or data_fix. No identity or date is inferred.
The action posts to `/api/coffer/v1/tasks` with `isAsk: false` and the stable
`zapier:task:` idempotency prefix. It returns only the task ID. A solicitation
restriction is never cleared and does not block this non-ask task. Creating it
submits no payment or message. Merged and erased constituent IDs are refused.

## Named native record actions

The package also exposes these fixed operations:

- Create constituent, record gift, create held pledge, record interaction,
  create opportunity, define fund, create draft campaign and record soft credit.
- Replace constituent contact, update opportunity, set solicitation restriction,
  set constituent status and record consent evidence.
- Set gift or soft-credit acknowledgment, assign task, snooze task and complete
  task.

Fields come from the connected installation's authenticated OpenAPI schema.
Money is whole cents, dates are `YYYY-MM-DD`, and complex allocations or pledge
installments are JSON values matching that schema. Supply exact current record
versions for updates. Replacing constituent contact has native replacement
semantics: omitted optional contact fields are cleared. Pledges retain their
native review hold; campaign creation leaves an inactive draft. Gift rules,
address processing and consent synchronization retain their existing native
behavior and holds; no connector operation bypasses them or grants direct
provider sending or charging authority.

Every action requires an opaque Stable Invocation ID, unique to that workflow
step. Named record actions accept 1 to 160 visible ASCII characters; the original
task action accepts up to 180. Reuse the exact ID and inputs on every retry;
never generate a timestamp or random value per execution. Concurrent calls and
lost-response retries with unchanged input return one native identifier.
Changed inputs conflict. Do not replace a key to work around an uncertain
outcome. Keys and idempotency receipts are installation-bound, principal-bound
and excluded from archives. Erasure removes associated receipts.

Exact-ID searches cover constituents, gifts, pledges, plans, interactions,
tasks, opportunities, funds, campaigns and soft credits. They retain the native
scope, confidentiality and erased-record rules. An absent record refuses;
searches perform no identity matching or export.

All requests remain on the explicitly connected HTTPS origin and refuse
redirects. Rate limits and native validation remain in effect. Errors disclose
neither private response bodies nor credentials.

## Proof and remaining scope

`tests/zapier-journey.mjs` executes the packaged actions, searches and all eight
triggers using the pinned Zapier runtime over HTTPS into actual Coffer HTTP
handlers. It reads exact records and audit facts; exercises concurrent and
lost-response task creation, gift idempotency, changed-input conflicts, scope
refusals, native holds and version checks, expiry, revocation, changed creator
authority, restricted non-asks, merge and erasure, redirect refusal and archive
custody. The trigger checks reuse actual signed captures from
`tests/webhook-sources-journey.mjs`, whose existing native source assertions are
retained. Only provider network edges and ephemeral local TLS trust are adapted;
no Coffer service or authority is mocked. The single API-003 registration in
`tests/coffer.test.mjs` is part of push Verify's donors shard.

API-003 remains partial. Crank CONN-010 and TRIG-001 must admit Coffer's
combined timestamped signature and named task action before the actual
Coffer-gift-triggered Crank flow can pass. Publication and hosted qualification
remain unproved; no missing Zapier account is established. API-002 production
public-network and hosted-delivery proof gaps, wider TEAM-001 authority and all
existing account, ct, Base and device holds remain unchanged. No sibling
repository is changed here.

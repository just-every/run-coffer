# Coffer commands and access

Everything the screens do goes through the same server handlers, which check the caller's role on every request. Use the app's real origin.

## Who can do what

| Actor | Allowed |
| --- | --- |
| Owner | Everything below, plus backup, restore (`/api/portability/*`) and `donor.erase`. |
| Admin | All commands except backup, restore and erasure; CSV downloads; the Stripe move-in. |
| Member | Read; `donor.create`, `donor.update`, `gift.record`, `pledge.create`, `consent.record`. |
| Agent key | Donor list/context and frozen preparation through the company-policy door; named standing receipt grants may also dispatch. See [Agents and MCP](/docs/agents). |

An agent key is created in **Data & access** (or `{"command":"agent.create","input":{"label":"…"}}` by an owner or admin). The response holds `{id,label,token,expiresAt}` once; `expiresAt` is epoch milliseconds, 30 days ahead. Revoke with `agent.revoke` and `{"id":"<key-id>"}`. A key stops working when it is revoked, expires, or the person who created it is deactivated or changes role. A key can read donor records: treat it as private data access.

Agents send `Authorization: Bearer <token>` and adopt a complete company policy at `/agents`; native HTTP mutations also require `Idempotency-Key`. Native sessions send their cookie and, for changes, the exact `Origin`. Never send an `actor` or role field; the server decides who you are.

## Reading

| Request | Returns |
| --- | --- |
| `GET /api/coffer/donors?q=&page=` | `{donors,more,page,q,total}`, 50 per page; `q` matches name, email or household. |
| `GET /api/coffer/donors/<id>` | `{donor,household,gifts,pledges,consents,letters,appeals,events,totals,current}`. |
| `GET /api/coffer/letters` | `{today,thresholdCents,targetDays,due,batches}`; `due` gifts carry `due_on`, `overdue` and `goods`. |
| `GET /api/coffer/letters/<batch-id>` | `{batch,letters,approval,events}`. |
| `GET /api/coffer/appeals` and `/api/coffer/appeals/<id>` | Appeals; one appeal with `recipients`, `approval` and `consentChanged`. |
| `GET /api/coffer/settings` | Letter settings, including `version` and `reviewed_at`. |
| `GET /api/coffer/letters/<id>/letters.csv`, `/api/coffer/appeals/<id>/recipients.csv` | Exported files (owner or admin, after export). |

## Changing

```http
POST /api/coffer/commands
Content-Type: application/json
Authorization: Bearer <token>

{"command":"ack.prepare","input":{}}
```

Errors return `{error,message,details?}` with a 4xx status. Refresh and review before repeating a refused decision. Money is either typed dollars (`"amount":"250.00"`) or exact integer cents (`"amountCents":25000`); a bare number in `amount` is refused.

| Command | Input | Notes |
| --- | --- | --- |
| `donor.create` | `name`, optional `email`, `phone`, `household`, `addressLine1`, `addressLine2`, `city`, `region`, `postalCode`, `country` | Email is unique. |
| `donor.update` | `donorId`, `version`, the same fields | Version must match. |
| `gift.record` | `donorId`, `amount`/`amountCents`, `receivedOn` (YYYY-MM-DD, not future), `method` (check, card, online, cash, bank transfer, other), `goods` (`none` or `provided`), with `goodsValue` and `goodsDescription` when provided; optional `reference`, `fund`, `pledgeId`, `note` | Reference is unique among hand-entered gifts. |
| `gift.reverse` | `giftId`, `reason`, optional `reversedOn` | Adds the negative line; once per gift; refused while the gift is in a prepared or approved letter batch. |
| `gift.classify` | `giftId`, `version`, `goods`, goods fields | Only for an imported gift whose answer is unknown. |
| `pledge.create` | `donorId`, `amount`, `pledgedOn`, optional `dueBy`, `fund` | |
| `consent.record` | `donorIds` (1–500), `channel` (`email`, `mail`), `status` (`granted`, `withdrawn`), `method` (web form, paper form, verbal, email reply, event sign-up, other), `evidence`, `capturedOn` | Appends; never edits. |
| `settings.update` | `version`, `organisation`, `ein`, `timezone`, `threshold`, `targetDays`, `letterSubject`, `letterTemplate`, `noneStatement`, `goodsStatement` | See the placeholders on the settings page. |
| `ack.prepare` | optional `giftIds` | Agents may run it. Needs reviewed settings; at most 500 letters. |
| `ack.approve`, `ack.discard`, `ack.export` | `batchId`, `version` | Approval binds the content hash; export repeats return the same record. |
| `ack.markSent` | `batchId`, `version`, `sentOn`, `method` (mail, email, mail and email) | |
| `appeal.prepare` | `name`, `channel`, optional `givenSince`, `minTotal` | Agents may run it. Returns `recipients` and `excluded` counts. |
| `appeal.approve`, `appeal.discard`, `appeal.export` | `appealId`, `version` | Refused with `CONSENT_CHANGED` if any recipient's consent moved. |
| `appeal.markSent` | `appealId`, `version`, `sentOn` | |
| `donor.erase` | `donorId`, `confirm: "ERASE"` | Owner only. Returns the anonymous placeholder's `donorId`. |

## Stripe move-in

Owner or admin. Bodies up to 12 MiB of JSON.

| Request | Body |
| --- | --- |
| `POST /api/coffer/imports/preview` | `{customers:[page…], charges:[page…], noGoodsOrServices}` |
| `POST /api/coffer/imports/apply` | The same plus `fingerprint` from the preview. Repeating it continues the same job. |
| `POST /api/coffer/imports/resume`, `/undo` | `{id}` |
| `GET /api/coffer/imports/journal?id=<job-id>` | Job, plan and retained originals. |

## Backup and restore

The owner-only Base portability protocol is mounted at `/api/portability/*` (`exports`, `exports/<id>/advance`, `exports/<id>/download`, `imports`, `imports/<id>/parts/<n>`, `imports/<id>/finalize`). The command line (`rer export`, `rer import`) is the simpler route; see the README.

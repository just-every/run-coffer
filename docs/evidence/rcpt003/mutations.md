# RCPT-003 exception coverage fix

The acceptance and ct riders remain unchanged. No product behavior changed.
The former thrown Fetch fixture is now an explicit HTTP 500 response. The
additional native HTTP edge consumes a Lob request and destroys its socket
without a response. This exercises the rejected-fetch branch, through the
same authenticated command and durable database used by the product.

`postalTransportJourney` in `tests/postal-transport-journey.mjs` is invoked by
`postalDeliveryJourney` in the existing RCPT-003 registration in
`tests/receipts.test.mjs`. Push Verify already runs that registration in
`phone-staff`. No test registration was added or removed.

The new assertions require exactly one provider request, one uncertain piece
attempt, its exact idempotency and metadata identities, two held household documents with distinct permanent document attempts,
no provider message or delivery event, and no acknowledgment. Repeating the
owner command and exporting and restoring into another installation preserve
the same attempt without another request. The existing postal journey proves
successful submissions, definite rejection, HTTP-error uncertainty, authority,
tracking, per-document tasks and custody.

## Mutation table

The first 27 caught mutations below are ct's recorded results at
76fddb2e0f5278bbf2d6046450c9c6b9f14ea923. They are historical results, not a
claim that this round reran them. The relevant application bytes remain
identical; the existing assertions remain unchanged. This round adds the
transport assertions and makes the existing HTTP 500 fixture explicit.
The final two rows are fresh executions against this round's assertions;
product source was restored after each execution.

| Mutation | Deliberate defect | Result and assertion source |
| --- | --- | --- |
| M01 | Shift window placement | ct caught; print-formats-journey.mjs:59 |
| M02 | Omit a label | ct caught; print-formats-journey.mjs:66 |
| M03 | Wrong envelope size | ct caught; print-formats-journey.mjs:75 |
| M04 | Omit a Word row | ct caught; print-formats-journey.mjs:89 |
| M05 | Omit a grouped PDF piece | ct caught; grouped-print-exports.mjs:13 |
| M06 | Refuse a supported template kind | ct caught; single-letters-journey.mjs:74 |
| M07 | Wrong frozen name | ct caught; single-letter-snapshots.mjs:27 |
| M08 | Omit single-letter timeline entry | ct caught; single-letters-journey.mjs:55 |
| M09 | Wrong template version | ct caught; single-letter-snapshots.mjs:27 |
| M10 | Discard blank review | ct caught; single-letter-snapshots.mjs:30 |
| M11 | Serve stale financial output | ct caught; single-letters-journey.mjs:100 |
| M12 | Retain erased body | ct caught; single-letter-snapshots.mjs:54 |
| M13 | Serve unapproved output | ct caught; single-letters-journey.mjs:44 |
| M14 | Accept wrong approval hash | ct caught; single-letters-journey.mjs:46 |
| M15 | Accept member approval | ct caught; single-letters-journey.mjs:48 |
| M16 | Send a local copy to a provider | ct caught; single-letters-journey.mjs:70 |
| M17 | Skip postage confirmation | ct caught; postal-delivery-journey.mjs:38 |
| M18 | Wrong audit fact | ct caught; postal-delivery-journey.mjs:53 |
| M19 | Select an attempted piece again | ct caught; postal-delivery-journey.mjs:73 |
| M20 | Omit grouped-donor event | ct caught; postal-delivery-journey.mjs:81 |
| M21 | Wrong document attempt | ct caught; postal-delivery-journey.mjs:92 |
| M22 | Omit delivered timeline entry | ct caught; postal-delivery-journey.mjs:108 |
| M23 | Omit address tasks | ct caught; postal-delivery-journey.mjs:115 |
| M24 | Skip configuration gate | ct caught; postal-delivery-journey.mjs:132 |
| M25 | Claim delivery on task completion | ct caught; postal-delivery-journey.mjs:125 |
| M26 | Discard literal defaults | ct caught; single-letter-snapshots.mjs:31 |
| M28 | Retry HTTP-error response | ct caught; postal-delivery-journey.mjs:46 and repeated-action count |
| M27 | Await an identical second fetch inside the exception handler | fresh caught; postal-transport-journey.mjs:26, exactly one request |
| M29 | Start an identical unawaited fetch inside the exception handler | fresh caught; postal-transport-journey.mjs:26, exactly one request |

All paths in this table are under `./tests/`. The fresh mutation probes run
only the transport journey so failures cannot come from unrelated formats or
screens. Both probes must fail an assertion rather than fail to parse or time
out. The unmodified registered RCPT-003 and RCPT-009 journeys also pass, with
native screens at 1440 and 390. Typecheck, first-party validation and the
edition lock are checked separately. Exact candidate SHA, workflow execution
and publication scan fields accompany the fresh judge request after landing.

The provider boundary remains a network-edge fake. No live postage,
printing, delivery, legal compliance or provider-side erasure is claimed.

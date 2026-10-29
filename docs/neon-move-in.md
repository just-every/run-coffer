# Move reviewed Neon CRM history into Coffer

Open More, Move in from your CRM, then **Read Neon history**. Supply the Neon organization ID and a read-capable API key, then explicitly confirm that the organization records USD amounts. The API does not identify currency; other or unconfirmed currencies are refused and no conversion is performed. An earlier review without this recorded confirmation cannot apply or continue. The key is used for this preview only; Coffer does not save it in the review, journal or archive. Preview does not change donor records. Review the accounts, source IDs, custom definitions, household counts, preferences and cash totals before approving **Move these records in**.

This bounded API slice reads Neon API version 2.12 from its fixed HTTPS origin. It pages account search results, reads each account and its donations, memberships, pledges and event registrations, reads payment tender names, account, donation and activity custom definitions and households, then reads active and inactive recurring schedules and searches and reads activities. The documented schema is at <https://developer.neoncrm.com/api-v2/>. An HTTP failure, incomplete page, repeated identity or unsupported payment stops the preview; it never approves a truncated organization. An owner or admin must still have an active native session for preview, apply, continue and undo.

## Supported records

- Individual and company accounts, name parts and unchanged salutations; three emails and up to 32 phone contacts and explicitly primary-labelled postal addresses within the bounded review. The primary source address is retained independently of its position in the API array. Extra street lines remain in the postal address. Supported contact types use Coffer's typed contact validator. Dated source addresses require separate review.
- Typed account, donation and activity custom definitions, their ordered pick lists and each record's values. Text, numbers, currency, dates and Boolean values use the native validator; pick-one and pick-many choices must match the source definition. The preview names the generated field key, source definition and choices. Invalid values and collisions with existing definitions block apply.
- Explicit source households and an explicitly flagged primary household contact as the head. No head is inferred. Household salutations survive as overrides. An unchanged source ID resolves to its earlier import without overwriting native names, contacts or households.
- Source membership history retains level, term dates, status, source active and renewal flags, and its fee. A paid membership links to the exact received gift and benefits value; complimentary history adds no cash. Source renewal flags authorize no Coffer renewal or future charge.
- Pledges retain dated installments, received payments and explicit source installment allocations. Promises are not cash. Imported pledge email stays held until the owner reviews the native pledge, schedule and wording. Closed pledges with unrecorded write-offs require separate review.
- Active and inactive recurring schedules retain amount, cadence, source account and next date as migration evidence. Optional reviewed processor references remain opaque. Raw card and bank details from API responses are discarded; no source schedule is stopped and no replacement schedule is activated.
- Fully paid donations and event registration payments with one successful monetary payment. Registration non-deductible amounts become goods values, never extra cash. Missing goods facts remain unknown. Source soft credits remain independent recognition and never increase cash totals.
- Single-account activities, retaining their source IDs as notes or typed email, call and meeting interactions. Donation tribute honorees, notification contacts and reviewed source groups survive. Imported tribute amounts are withheld from family notifications until native permission exists.
- All four source channel choices, including unknown. Neon consent `GIVEN` means granted, `DECLINED` means withdrawn and `NOT_ASKED` or an absent answer means unknown. Email opt-out tightens the email choice. These are separate from do-not-solicit, which blocks asks on every channel. New source reviews cannot overwrite separately recorded or later native choices.

## Historical facts the API does not establish

Neon's `sendAcknowledgeEmail` and `sendAcknowledgeLetter` are instructions, not evidence of a historical send. Coffer never turns these options into an acknowledged status. Without source evidence, acknowledgment remains not acknowledged; no date, method or interaction is invented.

Optionally upload one `neon-history.json` file prepared from reviewed source reports. Every map key must be a source ID in the API snapshot. Unsupported properties are refused. It is a source-history interchange format for this Coffer adapter, not a claim that Neon has such an endpoint.

```json
{
  "accounts": {
    "synthetic-coffer-7001": {
      "preferenceOn": "2026-09-01",
      "restrictionOn": "2026-09-01",
      "codes": ["No fundraising"]
    }
  },
  "households": {
    "synthetic-coffer-7041": {
      "addressee": "The Reed Reading Family",
      "informal": "Ava and Bee"
    }
  },
  "donations": {
    "synthetic-coffer-7011": {
      "Acknowledgment Status": "acknowledged",
      "Acknowledgment Date": "2026-09-04",
      "Acknowledgment Method": "email",
      "Acknowledgment Interaction ID": "synthetic-coffer-7031",
      "tributeGroup": "synthetic-coffer-7045"
    }
  },
  "registrations": {},
  "memberships": {},
  "pledgePayments": {},
  "recurring": {
    "7121": {
      "customerReference": "synthetic-coffer-7125",
      "paymentMethodReference": "synthetic-coffer-7122"
    }
  },
  "softCredits": [
    {
      "id": "synthetic-coffer-7051",
      "accountId": "synthetic-coffer-7002",
      "donationId": "synthetic-coffer-7011",
      "amount": 100,
      "Acknowledgment Status": "acknowledged",
      "Acknowledgment Date": "2026-09-05",
      "Acknowledgment Method": "phone call",
      "Acknowledgment Interaction ID": "synthetic-coffer-7032"
    }
  ]
}
```

Account history can also carry `status` (active, inactive or deceased), `statusReason` and `deceasedOn`. The normal status validator applies. Source history cannot clear a current Neon deceased flag, and a supplied death date must be real and no later than today in the organization time zone. Unknown source dates stay explicitly unknown in preference evidence; import time is retained separately. Household history can supply addressee and informal overrides; the API's household salutation supplies the formal override.

Donation and registration histories accept the six acknowledgment columns shown in the preview: status, date, method, reason, reference and interaction ID, with the exact `Acknowledgment ` prefix used above. Donation history can additionally supply `tributeGroup`. Status is acknowledged, not acknowledged or do not acknowledge. An interaction link must belong to the same donor, or to the independently credited donor, and match each supplied date and method. It never claims a Coffer send.

Map organization-specific codes in the existing communication-code review. Known **Do not solicit** retains its restriction. A completed mapping is reused for the next Neon preview. Tags and unsupported combinations still need separate review; ignoring a code is an explicit reviewed choice.

## Reconcile, replay and undo

The review and journal compare gift counts and cents by year, fund and donor. Soft credits, pledges and recurring commitments are not cash received. Repeating the same completed snapshot changes nothing. A changed source fact requires a new review and never silently overwrites earlier custody. Current native preferences win over an older import. Erasure prevents source replay from restoring the account.

Undo is one guarded transaction. It removes only records this import created, including untouched created custom definitions. A changed household, custom field, donor, gift or downstream use refuses the entire undo and preserves current work. A portable archive retains the source links, independent acknowledgment facts, preferences and household provenance; restoring it retains the same undo guards.

## Remaining coverage

This is partial Neon coverage. Replacement recurring schedules and vault transfer remain outside this historical import. Dated contacts, additional source objects, unsupported custom definition kinds, membership custom fields, pledge write-offs and custom fields, split or pending payments, refunds, disputes and noncash transactions need further reviewed migration. Unsupported payment records stop the preview rather than being counted as cash. A registration payment is preserved as historical giving, not as a native guest-list seat. Keep the incumbent installation and its full exports until every required source object has been separately reconciled. These fixtures establish no live Neon qualification and no completion of CAMP-004 or MOVE-009. Existing DONOR-009 and DONOR-015 requirements remain in force.

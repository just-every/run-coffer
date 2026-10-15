# Move in from Stripe

Coffer's first move-in kit reads the JSON that Stripe's own API returns. You save the pages; Coffer never asks for your Stripe key and never contacts Stripe.

## Save the pages

Use the [Stripe CLI](https://docs.stripe.com/stripe-cli) on your own computer, signed in with `stripe login` (a restricted key with read access to Customers and Charges is enough). Each call returns up to 100 objects:

```sh
# Customers (donors)
stripe get /v1/customers -d limit=100 > customers-1.json

# Charges (gifts) for one year, here October 2025 to September 2026
stripe get /v1/charges -d limit=100 -d "created[gte]=1759276800" -d "created[lt]=1790812800" > charges-1.json
```

If a page ends with `"has_more": true`, fetch the next one by adding `-d starting_after=<id of the last object>` and save it as the next file. Coffer warns when a page says more results exist.

Each file must be Stripe's list response, `{"object":"list","data":[...],"has_more":...,"url":...}`, unchanged. The documented shapes are [List all customers](https://docs.stripe.com/api/customers/list) and [List all charges](https://docs.stripe.com/api/charges/list). `tests/fixtures/stripe/` holds a synthetic year in exactly this shape.

## What Coffer does with them

| Stripe | Coffer |
| --- | --- |
| Customer | A donor: name (or email), email, phone, address. Metadata stays in the retained page. |
| A second customer with the same email | Skipped; its charges go to the first customer's donor. |
| Customer whose email matches an existing donor | Skipped; its charges go to that donor. |
| Successful (`status: succeeded`, `paid: true`) US-dollar charge | A gift on its customer's donor, dated by the charge time in your settings' time zone, net of any partial refund. `metadata.fund` or `metadata.campaign` becomes the fund; `description` becomes the note. |
| Charge without a customer | Attached to the donor whose email matches its billing or receipt email. |
| Failed, fully refunded or non-USD charge; charge with no matching donor | Skipped, with the reason shown in the preview. |
| Charge already imported | Skipped. If Stripe now shows a different net amount, the preview tells you to record the refund as a reversal. |
| Customer or email of an erased donor | Skipped; never imported again. |

Consent is never imported: Stripe does not record appeal consent. Record it in Coffer.

The **These charges were donations** box records that no goods or services were given for every imported gift. Leave it unticked if some charges paid for tickets, dinners or merchandise: those gifts then show **Goods/services not answered**, and their letters wait until an owner or admin answers on the donor page.

## Limits

One review holds at most 1,000 Stripe objects in 40 pages and 4 MB. Import a larger year in several reviews, for example by quarter; customers already in Coffer are skipped, so later reviews only need the charge pages (add customer pages for new donors). Applying writes in parts that fit one request; the journal's **Continue** button carries on.

## Undo

The journal's **Undo** removes exactly what that import added. It stops at anything a person has since built on: a new gift, consent, pledge, letter or appeal for an imported donor, or a letter for an imported gift.

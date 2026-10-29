# Move in from Stripe

Open **More → Move in from Stripe**, or follow Today’s second setup step. Coffer reads the account connected under Giving. Choose the first and last gift dates and press **Read Stripe and preview**. Dates include the whole day in UTC. Coffer follows Stripe’s next pages automatically; there are no commands or files to prepare.

## Use a read-only key instead

The page also explains this alternative in full:

1. Open [Stripe API keys](https://dashboard.stripe.com/apikeys). Select the organization and live mode, or the sandbox for a test move-in.
2. Under **Restricted keys**, choose **Create restricted key** and name it **Coffer move-in**.
3. Give **Customers**, **Charges**, **Payment Intents**, **Subscriptions** and **Invoices** **Read** permission. Leave everything else at **None**.
4. Copy the restricted key into the page. Coffer uses it only for this preview; it is never saved or carried into the approval form. Expire the key in Stripe after the move-in.

Stripe’s [key documentation](https://docs.stripe.com/keys) describes restricted keys and sandbox/live separation. The importer makes only GET requests, including when it uses Giving’s existing key.

## Review, approve and check

Customers with charges in the selected dates, monthly plans for those customers, and plans created during the period are read directly. Coffer reads [charges](https://docs.stripe.com/api/charges/list), [Payment Intents](https://docs.stripe.com/api/payment_intents/list), [invoices](https://docs.stripe.com/api/invoices/list) and [subscriptions](https://docs.stripe.com/api/subscriptions/list). A successful PaymentIntent resolves to its real charge. Payment Intents and invoices supply context and never create another copy of a gift; invoices marked paid outside Stripe do not create gifts.

The preview shows new donors, gifts, net cents, monthly plans and every skip reason. Compare the gift count and total with Stripe’s payments for those dates, after the refunds and skips shown. Tick the approval box to apply that exact plan. The journal then compares the actual gifts in Coffer with the approved count and cents. Large imports apply in parts; use **Continue the import** until complete.

| Stripe record | Coffer result |
| --- | --- |
| Customer | Donor name (or email), email, phone and address. Existing matching emails attach to that donor. |
| Successful US-dollar charge | One gift, net of refunds, dated in the organization’s time zone. Metadata fund/campaign and description are carried. |
| Failed, fully refunded, non-USD or unmatched charge | Listed and skipped. |
| Charge already in Coffer | Skipped. A changed refund balance is named for a person to reconcile. |
| Active, fixed-price USD monthly subscription | A monthly plan on the donor, using its existing Stripe subscription and customer IDs. Stripe continues billing it; Coffer creates no new subscription and transfers no card. |
| Other subscription schedule, currency, status, usage, discounts or tax | Listed with a specific skip reason; not silently reduced to a different plan. |
| Erased donor or email | Not restored. |

Consent is never inferred. Importing sends no receipts. The donations checkbox records that no goods or services were provided; leave it unticked for tickets, meals or merchandise so those receipts wait for a person’s answer.

## Large histories and undo

One review holds at most 1,000 source objects, 40 retained pages and 4 MB. Use a month or quarter for larger histories; Coffer skips earlier imported records. An incomplete read fails without adding any records.

The journal’s **Undo** removes exactly the donors, gifts and monthly plans this import added. It does not cancel anything in Stripe. It stops if someone has since changed or built on those records, including a letter, gift, recovery action or another plan using the imported campaign. Retained responses have verified digests; PaymentIntent client secrets are never included in a connected preview.

## Advanced: saved JSON

JSON files are copies of Stripe API responses. Use the collapsed **Advanced: upload saved Stripe JSON** option only if someone has already saved those files for you. It accepts unchanged Customers and Charges list responses, such as `{"object":"list","data":[...],"has_more":false}`. Multiple files or pasted pages are supported. A saved page whose `has_more` is true is explicitly warned as incomplete. The normal connected path reads the remaining pages for you.

### Imported pledge payment links

An optional `Installment ID` on a pledge-payment row reserves that installment
within the row's pledge. Payments without that link fill the remaining dated
installments. Repeated imports keep earlier payments and their exact cents;
equal amounts alone never identify the same payment.

When a later explicit link displaces an earlier general allocation, the payment
history retains the original match, its source file and import, and the replacing
source file and import. Only current allocations affect balances. Both import
orders use the same rule. An import involved in a replacement cannot be undone
while its retained allocation history is in use; refusal changes no money.

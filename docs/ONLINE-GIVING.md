# Online and monthly giving

Coffer takes gifts on your own campaign pages through Stripe, the payment company that handles donors' cards. Donors pay on Stripe's secure page, so card numbers never reach Coffer. Stripe sends the money to your bank account; Coffer records each gift on the donor's record, adds it to the campaign total and reconciles your payouts.

## Connect Stripe

Open **Giving → Connect Stripe** in Coffer. The page shows whether Stripe is connected, in test or live mode, and walks through every step for your installation, with the exact commands filled in. In short:

1. **Get your keys.** Sign in at dashboard.stripe.com (or create a free account for your organization). Turn on **Test mode** (or open your sandbox), open **Developers → API keys** and reveal the **Secret key**. A test key starts `sk_test_`; a live key starts `sk_live_`.
2. **Add a webhook.** Stripe confirms each payment, monthly renewal, failed card, refund and payout by sending a message to Coffer. In **Developers → Webhooks**, choose **Add endpoint** (or **Add destination**, then **Webhook endpoint**). Use the address `https://<your Coffer address>/api/coffer/giving/webhook` and select the events listed below. Leave the API version at Stripe's default: Coffer reads each payment's current state from Stripe itself. Then reveal the endpoint's **Signing secret**, which starts `whsec_`.
3. **Save the keys.** On a hosted Coffer they are secrets of its Cloudflare Worker. In a terminal in the Coffer folder you deployed from, with the same Cloudflare settings you used to deploy, run the lines the page shows. They look like this, with your environment name:

```sh
read -rs STRIPE_SECRET_KEY && export STRIPE_SECRET_KEY
read -rs STRIPE_WEBHOOK_SECRET && export STRIPE_WEBHOOK_SECRET
rer deploy --environment production --set-secret STRIPE_SECRET_KEY,STRIPE_WEBHOOK_SECRET
```

Each `read` waits for you to paste a value and press Enter; nothing shows while you paste, and the value stays out of your command history. `rer deploy --set-secret` changes only those secrets, in one new version of the Worker named `coffer-<environment>`, without a rebuild or any data change.

4. **Check it.** Back on **Connect Stripe**, choose **Check with Stripe**. Coffer asks Stripe whether the key works, shows your account's country and currency, and says whether a webhook sends to this address and which events it still lacks.
5. **Take a test gift.** Publish a campaign under **Giving**, open its page and give with card `4242 4242 4242 4242`, any future expiry date and any three-digit code. The gift appears on the donor's record and in the campaign total.

When you are ready for real gifts, finish Stripe's account activation and repeat steps 1–3 with the live secret key and a live-mode webhook.

### On your own computer

Coffer on your computer reads its private settings file, `.dev.vars`, in the Coffer folder. **Connect Stripe** shows these lines for it:

```sh
rer dev --stop
read -rs STRIPE_SECRET_KEY
(umask 077; grep -v '^STRIPE_SECRET_KEY=' .dev.vars > .dev.vars.new; echo "STRIPE_SECRET_KEY=$STRIPE_SECRET_KEY" >> .dev.vars.new; mv .dev.vars.new .dev.vars)
rer dev
```

The file stays readable only by you. The webhook is optional on your computer: Stripe cannot reach it, and the thank-you page records each one-time and first monthly gift. To see renewals and refunds while testing, run the [Stripe CLI](https://docs.stripe.com/stripe-cli) with `stripe listen --forward-to http://127.0.0.1:<port>/api/coffer/giving/webhook` and save the `whsec_` secret it prints as `STRIPE_WEBHOOK_SECRET` the same way.

### Webhook events

| Group | Events |
| --- | --- |
| Checkout | `checkout.session.completed`, `checkout.session.async_payment_succeeded` |
| Invoices (monthly gifts) | `invoice.paid`, `invoice.payment_succeeded`, `invoice.payment_failed`, `invoice.updated` |
| Subscriptions (monthly gifts) | `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted` |
| Charges and refunds | `charge.succeeded`, `charge.updated`, `charge.refunded`, `charge.failed`, `refund.created`, `refund.updated`, `refund.failed`, `payment_intent.payment_failed` |
| Disputes | `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed`, `charge.dispute.funds_withdrawn`, `charge.dispute.funds_reinstated` |
| Payouts | `payout.created`, `payout.updated`, `payout.paid`, `payout.failed`, `payout.canceled`, `payout.reconciliation_completed` |

Without the signing secret, webhook requests are refused. Coffer verifies each message's signature, reads the current state from Stripe, matches the donor by email and writes each successful gift once to the ledger with its campaign and fund. A failed payment never counts as money raised.

## Campaign pages

An owner or admin opens **Giving**, publishes a campaign with its own page address, story, fund and goal, and shares `/give/<address>`. Donors choose one-time or monthly and continue to Stripe Checkout for card or Link. Apple Pay appears in Stripe Checkout on eligible devices once you register your Coffer's domain under Stripe's payment method domains. US bank giving is coming soon.

The giving page asks separately whether the donor wants news and appeals by email. That box is optional and unticked; when a donor ticks it, Coffer records email consent with the checkout as evidence once the gift is paid. Gift receipts are transactional and go to the donor's email either way: each paid online gift's receipt is emailed as soon as Coffer records the gift, whatever the amount, using your letter wording. To approve each one first, choose **Hold online receipts for me to approve in Letters** in **Letter settings**. On this computer (local mode) email is switched off, so the receipt is marked “Not emailed” instead.

### Campaign media and closing

When publishing under **Giving**, add a PNG, JPEG or WebP image up to 1 MiB and its description. Coffer strips embedded image metadata before keeping the public copy. Check the visible image for private details and confirm it may be public.

After publishing, use **Campaign video** on Giving to choose the campaign and upload an MP4 up to 100 MiB. Video content and embedded metadata are public; review both before confirming. The upload streams into the installation's own file storage. A failure does not publish a video, and the page links to the campaign only after the upload succeeds. A published video cannot be silently overwritten.

Hosted deployment provisions the declared FILES R2 bucket through Base. The Cloudflare account must have R2 enabled and the deployment token must permit bucket creation and access. A missing permission or disabled R2 is an installation error; Coffer does not send files to another provider. Local Coffer uses its own emulated bucket without a Cloudflare account. Base backups and restores include the referenced videos and public image copies.

**Page closes after** accepts the last giving day in the organization's time zone. From the following day, the campaign explains it has closed and refuses new checkout requests. Campaign start/end planning dates do not close a page or hide recorded money. Public totals show received money, distinct giving donors and gifts, and the donor wall includes only explicitly opted-in gifts under their permitted recognition names.

## Monthly gifts

Monthly plans run as Stripe subscriptions. Set your account's retry schedule in Stripe (Billing revenue recovery). Coffer follows that schedule and records failures, the next attempt and a successful recovery. Failed-invoice notices use durable claims: failed or uncertain provider submission is recorded and acknowledged to Stripe without automatically resending the message. Recovery notice approval governs configured sequences and donor permission. The current default card receives one warning in the calendar month before expiry, under the applicable notice policy. Exhausted retries create one ordinary call task per invoice for the relationship manager, or the installation owner when none is assigned. Provider acceptance is not proof of delivery.

Donors open **Manage my monthly gift**, request an emailed link and confirm it to see only their own plans. Links expire after 30 minutes and work once; sessions last one hour. Card updates happen in Stripe's billing portal. Cancelling stops future gifts at the end of the current billing period; gifts already received stay in the ledger. Coffer on your computer sends no email, so the portal link only works on a hosted Coffer.

## RER Managed

RER Managed does not have the payment connection yet. **Connect Stripe** says so, and any Stripe action on a managed installation says Stripe is not available yet. Use a self-hosted Coffer for giving today.

Advanced form fields, embedding, other recurring frequencies, ACH and PayPal remain on the roadmap in `CONTRACT.md`.

### Honor and memory gifts

Open **Give in honor or memory** on a campaign page to name the honoree and an
optional family contact. These details stay private with the organization; they
are absent from Stripe metadata and the public donor wall. **Include my gift
amount in the family notification** is optional and unchecked. Its saved answer
cannot be changed by retrying a checkout. Staff and imported tributes have no
amount permission by default.

On the donor page, Tributes shows the current remaining total across gifts with
the same honor/memory kind and case/whitespace-normalized honoree, including CRM
history. This groups gifts; it never merges people. Staff prepare a family
notification; an owner/admin reviews and approves its exact version before
email-text download or printing. Coffer does not contact the family, send the
notification or claim delivery. The approved copy retains its original wording;
changed gifts or tribute facts need a fresh notification.

## Supporter fundraising

Verified supporters can create personal pages and teams from their giving portal.
See [Supporter fundraising](/docs/peer-fundraising) for publication, credit, leaderboard
and reviewed notice behavior.

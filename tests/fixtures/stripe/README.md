# Stripe move-in fixtures

Synthetic data for a fictional charity, Riverbend Literacy Project. Every name,
email, phone number and address is invented; emails use the reserved
`example.org` domain. No real Stripe account produced these files.

The files follow Stripe's documented list-response shape:

- `customers.json`: one page of [List all customers](https://docs.stripe.com/api/customers/list)
  (`GET /v1/customers`), each item a [Customer object](https://docs.stripe.com/api/customers/object).
- `charges-2025-q4.json` and `charges-2026.json`: two pages of
  [List all charges](https://docs.stripe.com/api/charges/list) (`GET /v1/charges`),
  each item a [Charge object](https://docs.stripe.com/api/charges/object).

Each page is `{"object":"list","data":[...],"has_more":false,"url":"..."}`.
Amounts are integer cents; `created` is a Unix timestamp.

The year covers what a real export holds: monthly and one-off gifts, two grant
installments paid by bank transfer, a gala ticket (goods provided), a failed
charge, a fully refunded and a partly refunded charge, a Canadian-dollar charge,
a guest charge whose email matches a customer, a guest charge matching nobody,
and a second Stripe customer sharing an earlier customer's email.

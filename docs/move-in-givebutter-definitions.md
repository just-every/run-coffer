# Givebutter custom definitions: unavailable

Research checked on 29 October 2026. The public API documentation does not
provide enough metadata to implement complete custom question enrichment.
This is an explicit source limitation, not an empty successful import.

No runtime reader or credential-entry door is exposed. No metadata, choice list, data type, selection cardinality, or record match is
inferred from answers, labels, names, or other identifying information.

## Official evidence

The [documentation index](https://docs.givebutter.com/llms.txt) links the
[official OpenAPI document](https://givebutter.com/docs/api.json).
That document contains no custom field definition endpoint or question
definition schema. Its only custom field schema is
`CustomFieldResponseResource`, with required members:

```ts
{
 id: number,
 field_id: number,
 title: string,
 description: string | null,
 type: string,
 value: string,
 created_at: string,
 updated_at: string
}
```

There is no type enum, choice list, or selection cardinality. Contact
`custom_fields` is an array with unconstrained item schema. The full
transaction response variant uses an array of `CustomFieldResponseResource`;
the compact variant has no custom fields. Campaign settings contain only
string `name` and `value` members, without a documented question encoding.
Paging answered records cannot recover unanswered definitions or unused
choices.

The [contact lookup](https://docs.givebutter.com/api-reference/contacts/get-a-contact)
accepts an integer contact ID. The
[transaction lookup](https://docs.givebutter.com/api-reference/transactions/get-a-transaction)
accepts the transaction `tid`. Transaction responses distinguish `id` from
`number`; contact responses distinguish `id` from `external_id` and
`external_ids`. None should be interchanged. Exact IDs alone do not solve the
missing definition metadata. Interaction and note enrichment is unavailable
as well.

The [campaign field guide](https://help.givebutter.com/en/articles/3586683-how-to-add-custom-fields-to-a-campaign)
describes text, textarea, checkbox, select, radio, and file questions and
response export. The
[contact field guide](https://help.givebutter.com/en/articles/7212021-how-to-use-contact-custom-fields)
describes text, number, date, toggle, and option fields, including multiple
selection. These dashboard capabilities do not establish API schemas.
The [webhook guide](https://help.givebutter.com/en/articles/8828428-how-to-automate-workflows-and-data-using-webhooks)
shows response metadata, without complete choices. Creating a webhook would
also change the source and cannot recover historical completeness.

Revisit only when official documentation supplies complete definitions,
choices and types, plus exact resolution for the IDs retained by the existing
CSV import. Any future reader must use the official fixed origin, ephemeral
credentials, bounded complete paging and redirects handled manually with
all redirections rejected. Invalid original values must remain available for
review. No runtime import door is supplied by this research.

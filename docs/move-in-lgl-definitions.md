# Little Green Light custom definitions

`src/coffer/move-in/lgl-definitions.ts` exports `readLglCustom(apiKey, records)`
and imports `SourceDefinition` from `src/coffer/move-in/source-definitions.ts`.
Call it inside an authorized server handler, for records already imported from
CSV or XLSX. It returns data for review and makes no writes. The private key
exists only during the read, in the Bearer authorization header. It is never
persisted, logged, cached, or returned. Requests use the fixed official host,
refuse redirects, and never follow a response's `next_link`.

Each input is `{kind, externalId}`. Constituents and gifts require the **LGL
record ID** printed in the export, as an exact positive decimal string without
leading zeroes. The similarly named external-system identifier is different.
Repeated inputs are read once. Interactions and notes are explicitly refused:
their documented detail models contain no custom definition or assignment
structures. Mixed requests fail as a whole.

The adapter reads all constituent categories and gift custom field categories,
including account defaults and empty definitions. It keeps category names,
choice names, source record IDs, and selected values. `facet_type: single`
becomes text with `pick-one`; `facet_type: list` becomes text with `pick-many`.
Other facet types fail. Every category's complete keyword list is read through
its own paginated endpoint, including choices that cannot currently be selected.
Selected choices must match both their ID and label. Missing or empty selections
remain unset. Namespaced definition IDs distinguish category kinds and attributes.

Constituent free-form attribute definitions have a documented API limitation:
the account definition endpoint omits the value classification. Constituent
detail responses include `classification` alongside attribute values, including
the blank values in LGL's official example. The adapter joins these classifications
to the complete definition list. The documented examples establish `text` and
`integer`, mapped to text and number. Values retain their API strings for typed
review; malformed numbers are never silently coerced. Null, missing, and empty
attribute values remain unset. An unknown classification or any definition with
no classification on the requested constituents fails the whole read. Date,
currency, year, checkbox, and other attribute classifications are not inferred.

The ordinary gift classification `gift_category_id` is separate from custom
gift fields. Its lookup endpoint is documented, but it is not repackaged as a
custom field by this adapter.

Limits are 1,000 input records, 100 definitions of each category kind, 100
constituent attribute definitions, 1,000 choices per category, 3,000 total HTTP
requests, 2 MB per response, and 15 seconds per request. Requests have at most
four concurrent records or category-choice lists. Lists request 25 items at a
time, validate stable totals and exact offsets, reject duplicate IDs and empty
intermediate pages, and finish the complete list before returning. Reaching any
bound fails the whole read; it never returns a partial capture. Concurrent edits
that change a total, selection metadata, or choice identity also fail. LGL does
not document snapshot isolation, so this cannot establish a single atomic source
snapshot while unrelated edits happen.

HTTP fixtures for integration checks should use the following documented shape.
All paths below are relative to the fixed base `https://api.littlegreenlight.com/api/v1`:

- `categories.json`, with `item_type=Constituent` or `item_type=Gift`, `limit=25`, and `offset=0` initially.
- `categories/31/keywords.json`, with `limit` and `offset`.
- `attributes.json`, with `item_type=Constituent`, `limit`, and `offset`.
- `constituents/71.json`, followed by `constituents/71/categories.json` with `limit` and `offset`.
- `gifts/81.json`.

A category definition has `{id:31,item_type:'Constituent',name:'Coffer segment',key:'synthetic-coffer-1',facet_type:'list',keywords:[]}`.
A keyword has `{id:41,category_id:31,name:'Coffer circle'}`. A paginated response
has `{items_count:1,total_items:1,limit:25,offset:0,items:[item]}`. For an
intermediate page add `next_item` equal to the next offset; final responses may
omit `next_item` and `next_link`, as LGL's actual examples do. A constituent's
category list uses category objects whose `keywords` contain selected keywords.
A gift detail uses `{id:81,custom_fields:[{id:32,item_type:'Gift',name:'Coffer gift segment',facet_type:'single',values:[{id:42,category_id:32,name:'Coffer circle'}]}]}`.
The corresponding gift category definition uses `keywords`, with ID 32 and choice
42. Constituent detail can use `{id:71,custom_attrs:[{id:51,name:'Coffer detail',key:'synthetic-coffer-2',classification:'text',value:'Coffer value'}]}`;
its attribute definition is `{id:51,item_type:0,name:'Coffer detail',description:'Coffer detail',key:'synthetic-coffer-2'}`.
The adapter does not interpret the attribute definition's numeric `item_type`:
the official schema supplies no numeric mapping, so the endpoint filter establishes
the requested scope. Empty attribute fixtures must return an empty complete list.

Primary sources checked on 29 October 2026:

- [Official static API documentation, authentication and examples](https://api.littlegreenlight.com/api-docs/static.html).
- [Official category schema](https://api.littlegreenlight.com/api-docs/json/lgl_api/v1/categories.json).
- [Official keyword schema](https://api.littlegreenlight.com/api-docs/json/lgl_api/v1/keywords.json).
- [Official attribute schema](https://api.littlegreenlight.com/api-docs/json/lgl_api/v1/attributes.json).
- [Official constituent schema](https://api.littlegreenlight.com/api-docs/json/lgl_api/v1/constituents.json).
- [Official gift schema](https://api.littlegreenlight.com/api-docs/json/lgl_api/v1/gifts.json).
- [Official ordinary gift category schema](https://api.littlegreenlight.com/api-docs/json/lgl_api/v1/gift_categories.json).
- [Official note schema](https://api.littlegreenlight.com/api-docs/json/lgl_api/v1/notes.json).
- [Official contact report schema](https://api.littlegreenlight.com/api-docs/json/lgl_api/v1/contact_reports.json).

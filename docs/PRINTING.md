# Printing and postal delivery

Approve a batch in Letters, then choose its downloadable PDF, Avery 5160
labels, #10 envelopes or Word merge package. Every format uses the same frozen
postal pieces. The existing gift, constituent and household settings determine
the piece count; email receipts remain separate. A changed household refuses a
first download until the batch is prepared and approved again. Previously
exported copies retain their frozen names.

The letter PDF uses US Letter paper with the address two inches below the top.
Long letters continue on another page without sharing a page with the next
piece. Labels use thirty 2⅝ by 1 inch positions per sheet; envelopes use 9½ by
4⅛ inch paper. Print at 100 percent and disable browser headers and footers.
An overflowing label or unsupported PDF glyph is refused explicitly. The Word
package and browser printing retain the original text for those cases.

Extract every file from the Word package into one folder. Open
`letter-template.docx` and use `recipients.docx` as its source if Word asks to
reconnect it. The package also contains the frozen merged letters. No macro,
remote resource or provider connection is needed for a local merge.

From a constituent's Letters and appeals panel, expand Produce one letter.
Choose a reviewed template and an owned gift, property contribution or statement
year. Review the frozen names, address, facts and empty fields, then approve the
copy. Its PDF, label, envelope and Word package become available. Preparation
appears on the timeline and never claims mailing. The copy does not replace an
issued receipt; changed financial facts refuse an obsolete copy. Names and
wording survive later profile edits and archives; donor erasure redacts them.

## Optional Lob connection

Configure the private deployment keys `LOB_API_KEY`, `LOB_WEBHOOK_SECRET` and
`LOB_FROM_ADDRESS_ID`, then explicitly set `LOB_ENABLED` to `true`. Subscribe
the Lob webhook to `/api/coffer/postal/events`. Never put these values into an
archive, source file or support attachment. Local and demo installations do not
send postal requests.

An owner or admin separately authorizes the approved hash and postage in the
batch's Postal delivery panel. Lob receives operational US letters, with an
extra address sheet so its address placement cannot cover the reviewed text.
The authorization names that additional printing and postage. Each frozen
piece has one permanent submission attempt. Rejected and uncertain attempts
stay visible and are never automatically retried.

Submission acceptance acknowledges the included gifts by letter; USPS delivery
remains unconfirmed until a signed provider result arrives. Tracking events
retain Lob provenance, the exact piece and document attempts, and the USPS
occurrence time. A return to sender opens an address task on each affected
document and leaves a print option. Completing the task never claims delivery.
Archives retain this evidence; merges preserve its donor custody and erasure
removes personal snapshots and task notes. Local erasure makes no claim about
Lob's separately held copies.

The HTTP journeys fake only the Lob network edge. They establish Coffer's
submission and tracking behavior, not live printing, postage or delivery.
Protocol references: [Lob letters](https://docs.lob.com/) and
[signed webhooks](https://help.lob.com/print-and-mail/getting-data-and-results/using-webhooks).

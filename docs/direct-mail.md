# Direct-mail replies

Prepare a postal appeal after reviewing the completed address-processing pass.
The mail-house CSV contains frozen personal or household addressing, an ask in
USD and a unique permanent response code for every piece. It contains no email,
phone, giving-history details or custom donor fields.

The default ask is the remaining balance of the latest positive hard-credit
monetary gift, ordered by received date, creation time and ID. Household pieces
use current members at that postal address, retaining distinct gift IDs. A
reversed gift, soft credit, property value, pledge or expected match does not
supply the ask. Without a prior monetary gift the ask stays blank. Preparation
freezes the gift and balance used; later gifts never silently rewrite a CSV.

Approve and export the reviewed pieces, then record the actual mailing date.
Each admitted donor's Letters and appeals history links to that run. A
restricted or nonconsenting household member does not enter the addressee.

For each returned check, enter the printed code as `responseCode` (or `appeal`)
on `giftBatch.add` / `giftBatch.edit`. A blank or omitted code retains an
edited row's code, or uses the batch's appeal for a new row. A batch may contain codes
from different pieces or appeals. Codes are checked when the row is entered
and again when a balanced batch closes. Draft rows are not money. Closing
records the defined appeal and mail-piece channel on each real ledger gift.
The existing run-level code continues to work for replies without a piece code.

Results include all signed ledger money under the run and its piece codes.
The donor response rate remains responding frozen recipient donors divided by
recipient donors. The separate piece response rate is pieces with a positive
remaining coded gift divided by the frozen piece count. Reversals and refunds
reduce money and can remove a response. Run-code replies count toward run
results but cannot identify a responding piece. Recorded mailing is not proof
of postal delivery; delivery, opens and clicks remain unknown.

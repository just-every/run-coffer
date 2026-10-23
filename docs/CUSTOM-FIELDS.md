# Custom fields

The owner or an admin defines fields under **Letter settings → Custom fields**.
Choose a stable lowercase key, label, record kind, value type and entry method.
Current record kinds are constituent, gift and interaction. Text, number, USD
currency, date, year and checkbox values support free-form, pick-one and
pick-many entry. Pick-list choices are entered one per line. Existing choices
must remain when editing a definition; changing its label preserves values.

Open a donor's **Custom record fields** card to choose the constituent, an
original gift or a logged interaction. Enter its value and source, then save.
Pick-many fields use a multiple selection. Every write checks the field and value
versions, retains its source and history, and refuses a stale form. **Clear value**
records a new empty version; it does not delete the history. Members and agents
cannot define, assign or clear custom values.

A defined field is available as `{{custom.key}}` in the published template
catalog. Use a literal fallback such as `{{custom.board_term|our board}}` for an
optional value. An interaction value is used only when that recipient's
interaction is explicitly selected for the document. A foreign recipient's
interaction is refused. Property acknowledgments keep their no-value rules and
cannot use currency custom fields. The template editor can insert a selected
field without saving or publishing its draft.

Prepared wording and its empty-field review remain frozen after a value changes.
Discard and prepare again to use current values. A welcome step with missing
values remains pending before any provider handoff and names its recipient and
field keys on Appeals. Fill the values, then run due steps again. A stored value
is literal text, including any braces it contains. New fields are not
automatically synchronized to external provider profiles.

Private constituent, gift and interaction CSVs include `custom_fields`; the
constituent file also includes tags. Currency is entered as USD and exported as
an exact integer-cent decimal string within that JSON object. Pick-many values
remain arrays and cleared values may be null. Definitions and value history
travel with the owner's archive. Donor erasure removes the values and history
and redacts prepared personal text under the ordinary erasure rules.

Pledge reminders use reviewed wording under **Letter settings → Pledge reminder
wording**. The same catalog and literal defaults apply. A missing value holds the
reminder before any submission claim, and the settings review links to its exact
pledge. The donor’s pledge form can select an email type and that donor’s
interaction for a manual run; scheduled reminders use the primary email and no
interaction context. Each submitted reminder freezes its wording, template
version and exact contact point. Later wording or value changes never rewrite it.

Current email appeals also use the catalog, literal defaults and field insertion.
Preparation retains only used field values, rendered wording and distinct blank
keys per recipient. The unpaged review names every affected donor before the
existing human approval decision. Later profile edits do not rewrite that text.
On the provider connection page, extra profile fields start off and require an
explicit owner/admin selection. A missing profile-context value needs a literal
default or refuses transfer. Saving the selection sends nothing. See
[appeal setup](appeals.md) and [declared data flows](data-flows.md).

Currency values retain exact integer cents up to the safe-integer boundary.
Template formatting and currency list comparisons keep the final cent and
pick-many values, including zero, without floating-point dollar conversion.

CRM export move-in preserves custom columns from Little Green Light,
Bloomerang and Raiser’s Edge NXT CSV reports and XLSX worksheets. Include the
source record IDs in constituent, gift, pledge and note reports. A call, meeting
or email note maps to an interaction; other notes map to note records.
Opportunities have no export importer yet.

Preview the files, then open **Map custom report columns** on the re-upload form.
Choose an existing field or supply its stable key, label, record kind, type,
entry method and choices, and upload the same files again. The review names
every selected column, worksheet, CRM and definition before apply. Existing
fields retain their reviewed definition and version. Pick-many source cells
contain a JSON array, such as `["Books","Music"]`; checkbox cells contain
`true` or `false`. Currency cells contain decimal USD amounts with at most two
fractional digits, without currency symbols or thousands separators. Invalid
choices, dates, currency and other typed values block apply and name their
source column and row. Empty cells leave values unset. Unselected columns stay
visible as left out.

Values attach to the native records resolved from the source record IDs,
including matched constituents. Existing custom values are never overwritten.
Every imported value retains its original source record ID, source donor ID,
column, file, worksheet, row and original cell text alongside its canonical
value, version and history. These facts and the importer custody travel with
the private installation archive; no provider receives them. Replaying the same
review, including after filenames or field labels change, does not duplicate
or rewrite values. Different source values require review and an undo of the
earlier move-in first.

Undo removes the imported values and their history atomically with the other
imported records. Later custom edits or newly attached custom values refuse
undo. Field definitions remain available after undo, including later label
edits, so shared definitions are never discarded. Only an owner or admin can
preview, apply or undo this mapping.

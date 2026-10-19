# Prospect research data flow

MAJOR-005 optionally connects the nonprofit's own WealthEngine API account. Only the owner or an admin can connect, screen selected donors or read the saved research. Members, preparation agents and donor-facing pages cannot read it.

When a person explicitly screens a selection, Coffer sends each selected donor's first and last name, United States postal address and an opaque Coffer donor ID to WealthEngine's fixed HTTPS `/v1/profile/summary/basic` endpoint. It sends no email address, phone, gifts, consent, conversations, notes or operator identity. Until separate name parts ship, the screen explains that it uses the first word as the given name and the remaining words as the surname. Review the identity and address before screening.

Coffer checks the account key using `/v1/session/create` and stores the key sealed with AES-GCM under an installation-derived key. Credentials and temporary provider sessions never enter a backup, an export or a result response. Disconnecting removes the sealed credential; it does not claim that previously saved research was erased at the provider.

Coffer retains only the provider profile ID, screening date, matched/no-match outcome, wealth rating/score, provider-labelled capacity range and boundaries, propensity to give and estimated annual donations. These are labelled **WealthEngine estimates**, never verified wealth. Raw provider profiles and unrelated demographics are not retained. A new screening replaces that constituent's saved results. A failure or an invalid response saves no results for the selected batch.

Research follows donor merge and undo, is included in the owner's private installation archive, and is removed with donor erasure, including private merge snapshots. Restoring an archive predating that erasure is refused by DATA-001's fence. The optional account must be reconnected after restore. Staff cannot separately delete research in a way that promises to remove it from older archives.

Provider-side retention is governed by the nonprofit's WealthEngine account; Coffer does not claim that a lookup or local erasure deletes provider records. See the [official WealthEngine API contract](https://apidocs.wealthengine.com/docs/api-service-openapi.yaml).

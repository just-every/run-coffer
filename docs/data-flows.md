# Prospect research data flow

MAJOR-005 optionally connects the nonprofit's own WealthEngine API account. Only the owner or an admin can connect, screen selected donors or read the saved research. Members, preparation agents and donor-facing pages cannot read it.

When a person explicitly screens a selection, Coffer sends each selected donor's first and last name, United States postal address and an opaque Coffer donor ID to WealthEngine's fixed HTTPS `/v1/profile/summary/basic` endpoint. It sends no email address, phone, gifts, consent, conversations, notes or operator identity. Until separate name parts ship, the screen explains that it uses the first word as the given name and the remaining words as the surname. Review the identity and address before screening.

Coffer checks the account key using `/v1/session/create` and stores the key sealed with AES-GCM under an installation-derived key. Credentials and temporary provider sessions never enter a backup, an export or a result response. Disconnecting removes the sealed credential; it does not claim that previously saved research was erased at the provider.

Coffer retains only the provider profile ID, screening date, matched/no-match outcome, wealth rating/score, provider-labelled capacity range and boundaries, propensity to give and estimated annual donations. These are labelled **WealthEngine estimates**, never verified wealth. Raw provider profiles and unrelated demographics are not retained. A new screening replaces that constituent's saved results. A failure or an invalid response saves no results for the selected batch.

Research follows donor merge and undo, is included in the owner's private installation archive, and is removed with donor erasure, including private merge snapshots. Restoring an archive predating that erasure is refused by DATA-001's fence. The optional account must be reconnected after restore. Staff cannot separately delete research in a way that promises to remove it from older archives.

Provider-side retention is governed by the nonprofit's WealthEngine account; Coffer does not claim that a lookup or local erasure deletes provider records. See the [official WealthEngine API contract](https://apidocs.wealthengine.com/docs/api-service-openapi.yaml).

## Public gift recognition

GIFT-011 stores a separate recognition name and opt-in with a donation checkout in the installation’s database. Only gifts explicitly opted into the campaign wall publish that chosen recognition name and remaining monetary amount. A donor or gift anonymity choice overrides it; blank recognition names display Anonymous. Legal names, emails, donor/gift IDs and receipt text never enter the public wall. Existing and imported gifts start private. Staff can withdraw a wall opt-in; they cannot create one for an old private gift. These choices do not add data to Stripe requests.

Owner/admin honor-roll reports and CSV files use current positive remaining monetary gifts received in an inclusive date period, under donor-authorized recognition names or Anonymous. Anonymous gift amounts have separate rows. The owner’s private archive keeps the original recognition choices; donor merge/undo retains conservative privacy, and erasure removes names and wall opt-ins.

## Public campaign media

GIVE-002 publisher uploads are explicitly confirmed for public viewing. PNG/JPEG/WebP images up to 1 MiB have embedded metadata stripped before the public copy is stored in the installation's portable D1 records. MP4 videos up to 100 MiB stream into the installation's declared FILES R2 bucket; the upload form states that video content and metadata remain public. No media is sent to an external video host or loaded from a third-party embed.

Only the current owner or admin can upload. Session, origin and publication permission are checked at the server, including the transaction exposing the video reference. Failed uploads have no public reference and their bytes are removed. Public image/video routes serve only the recorded campaign's media with exact content types, nosniff and same-origin page policies. Base archive custody includes referenced R2 objects and restores them alongside campaign records. Cloudflare is the installation's existing storage provider; the nonprofit controls its bucket and account.

## Optional marketing profile fields

On the existing Mango or Mailchimp connection, only an owner or admin can explicitly confirm a versioned selection from Coffer’s published merge catalog. Extra fields start off. Saving or inserting fields sends no profile or email. Mailchimp adds private text audience fields and updates consenting, already subscribed members during the existing preference check; new members retain the existing double-opt-in requirement. Mango carries the selection only during an already authorized appeal or welcome list handoff. Selection alone creates no Mango membership or subscription. Current provider opt-outs and Coffer consent checks still apply.

Selected values can include names and contact details, own-ledger giving summaries and constituent custom values. A profile has no specific gift or interaction context: those missing values require a neutral literal default or refuse the transfer. Unknown fields, incompatible audience definitions and provider limits are refused; values are never silently truncated. Mango’s existing unrelated profile fields are preserved during its whole-profile update. No new custom definition is selected automatically.

Clearing stops fresh selected-value transfers and does not claim to delete earlier provider data. Changing the provider, audience or credential clears the selection. Provider connection credentials and the selection are excluded from portable archives, so a restored installation must reconnect and explicitly choose fields again. Provider retention remains controlled by the nonprofit’s provider account. The adopted owner/admin explicit-sharing default awaits ct approval; RCPT-010 remains partial.

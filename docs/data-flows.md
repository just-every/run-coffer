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

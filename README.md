# Coffer

Coffer keeps donor records for a US nonprofit: donors and households, every gift as an exact ledger line, pledges, and each donor's consent to hear from you. It prepares the written acknowledgement letters that gifts of $250 or more need, and it builds appeal lists that only ever include donors who said yes. You run the app and hold the data in your own account.

Coffer does not process payments, send email, screen wealth or give tax advice. Your gifts arrive through your existing processor (Stripe is the first move-in kit), and the letter wording is your organization's own.

## The run site is local for now

Coffer's public run site will live at https://run-coffer.com once that domain is registered. **It is not live yet.** Until then, the same site runs on your computer: `rer dev` (below) prints a line like `RER_SITE http://127.0.0.1:8904`. Open that address with `/run` on the end, for example http://127.0.0.1:8904/run, using the port `rer` printed for you.

## Start from a fresh clone

You need macOS, Linux or Windows with WSL2, and git. One line clones Coffer, installs the `rer` launcher if you don't have it and starts it:

```sh
npx -y @runeditrun/rer dev just-every/run-coffer
```

To start it again later, run `cd run-coffer && rer dev`.

`rer dev` installs dependencies (with the pinned Node 22.20.0 and pnpm 10.12.4), sets up a local owner and starts the real app. The first launch can take a few minutes; if it is interrupted, run `rer dev` again and it picks up where it stopped. When it is ready it prints:

- `RER_READY http://127.0.0.1:<port>`: the app's address.
- `RER_OPEN <link>`: open this link on this computer. It signs you in as the local owner. **The link is a credential: keep it private.**
- `RER_SITE http://127.0.0.1:<port>`: the local run site; add `/run` for the run page.

The link takes you to a one-time **Finish setup** page: tick the box and continue. You land on **Today**. Development mail is suppressed, so no mailbox is needed for local use. Stop the app with `rer dev --stop` or Ctrl-C.

To install for a real owner mailbox instead of the automatic local owner, run `rer install`, then `rer setup` and answer its prompts, then `rer dev`. [RUN-LOCALLY.md](RUN-LOCALLY.md) covers private answers, the Node runtime and recovery; `rer describe` lists every command.

## Your first week in Coffer

The **Today** page lists these steps and ticks each one off as you finish it.

1. **Review your letter wording.** Open **More → Letter settings**. Enter your organization's name and EIN, check the time zone (gift dates follow it), the threshold (default $250) and how many days you allow to send a letter (default 14). Read the starting letter text and edit it into your own words; Coffer insists only that the letter keeps the donor's name, the amount, the gift date, your organization's name and the goods-or-services statement. Save. Coffer prepares no letters until a person has saved this page.
2. **Move in a year of gifts from Stripe.** Open **More → Move in from Stripe**. Add your saved Stripe pages (see [docs/MOVE-IN.md](docs/MOVE-IN.md) for how to save them; to try it first, use the sample files in `tests/fixtures/stripe/`). Tick **These charges were donations** if none of them paid for tickets or goods. **Preview** shows the donors and gifts it would add and every Stripe object it skips, with the reason, and changes nothing. Tick the approval box and **Apply**. The journal page shows progress, keeps the original Stripe pages and offers **Undo**. A large import applies in parts: press **Continue** until it says **Applied**.
3. **See each donor's history.** **Donors** lists everyone with their total given, last gift and consent. Open a donor for their gifts by year, pledges, consent history, letters, appeals and activity. You can also add a donor and **Record a gift** by hand (amount in dollars, the date received, how it was paid, and whether the donor got goods or services in return).
4. **Record consent.** Appeals only include donors whose latest answer is yes. On **Donors**, tick donors, choose the channel (email or postal mail), the answer, how it was captured and your evidence, and **Record consent**. A donor page shows the full history and lets you record a withdrawal.
5. **Send acknowledgement letters.** **Letters** lists every gift at or over the threshold that has no letter yet, with its due date and an **Overdue** flag. **Prepare letters** fills your wording for each gift. Read the batch, then **Approve these letters**, **Export letters** and **Download letters (CSV)** for your mail merge or printing. Coffer does not send them. When they have gone out, **Record as sent** with the date. Imported gifts without a goods-or-services answer wait until someone answers on the donor page.
6. **Run an appeal.** **Appeals → Prepare an appeal**: name it, pick email or postal mail, and optionally only donors who gave since a date. Coffer shows who is included and how many were left out and why. **Approve**, **Export audience**, download the CSV for your email or mailing tool, then **Record as sent**. If anyone's consent changes before approval or export, Coffer refuses and asks you to prepare it again.

Mistakes are corrected, not edited away: an owner or admin uses **Reverse this gift** on the donor page, which adds a matching negative line with your reason. Totals and letters follow the ledger.

## People and agent access

- **Owner and admins** approve and export letters and appeals, reverse gifts, move records in, change letter settings and manage agent keys.
- **Members** add and edit donors, record gifts, pledges and consent.
- **Only the owner** backs up, restores and erases donors.
- **Agent keys** read records and prepare letter batches and appeal audiences. A person must approve them; every approval records who prepared and who approved the exact content.

Invite people with Base's sign-in routes while signed in as the owner: `POST /auth/invite` with `{"email":"…","displayName":"…","role":"member"}` (or `"admin"`), using the app's exact origin and your session (Base checks the `Origin` header on changes). `GET /auth/operators` lists people; `POST /auth/operator/role` and `POST /auth/operator/status` change access. Hosted invitations need configured mail; local development suppresses it. See the [Base auth contract](src/modules/operator-auth/README.md#http-contract).

Create an agent key in **More → Data & access**. It is shown once and expires after 30 days. [docs/AGENT-COMMANDS.md](docs/AGENT-COMMANDS.md) lists every endpoint and command an agent can call.

## Back up, restore and erase

The owner can **Download backup** in **Data & access**, or export from the command line with the app stopped:

```sh
rer dev --stop
rer export --output exports/coffer.rer
```

The backup holds donors, gifts, consent history, letters, appeals, approvals and the retained Stripe pages. Sign-in accounts, sessions, agent keys and mail settings are left out. Keep it private. To restore on another computer, clone this repository, run `rer dev` once to set up a fresh owner, stop it, then:

```sh
rer import --input exports/coffer.rer --yes
rer dev
```

Restore only goes into an empty installation; a populated one is refused.

To honour an erasure request, the owner opens the donor, types `ERASE` and presses **Erase donor**. Their name, contact details, consent evidence, letter text, gift notes and the Stripe pages that mention them are removed, and a later move-in will not bring them back. Their gift amounts and dates stay as anonymous ledger lines because they are the charity's financial record. Afterwards save a fresh backup; when restoring an older backup, pass it as the later journal so the erased person does not come back: `rer import --input exports/older.rer --journal exports/after-erasure.rer --yes`.

## Deploy in your own Cloudflare account

Local use needs no Cloudflare account. To host Coffer you need your own Cloudflare account with a workers.dev subdomain and an account API token with **Workers Scripts: Edit** and **D1: Edit**. Coffer declares one D1 database; everything it creates belongs to your account.

Put a real verified sender address in `deploy.json` in place of the example `MAIL_FROM` (the declared mail provider is Resend, used for sign-in links only). Then provide `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `OWNER_EMAIL`, `SESSION_SECRET`, `SETUP_TOKEN` and `MAIL_API_KEY` through your environment or a private `--env-file` (never in source or command arguments), and run:

```sh
rer deploy --dry-run
rer deploy
```

The dry run builds and validates locally without contacting Cloudflare. The real deploy creates the Worker and D1 database, applies the migrations and checks the hosted `/health`. Keep the private `.rer/deploy/<environment>.json` it writes out of Git and back it up: later deploys use it to recognise the resources as yours. The [Base owner-account deploy kit](https://github.com/runeditrun/base/blob/ada9f574d8a7247edc3a1180b593ad182b1fbb37/modules/deploy-kit/README.md) and [OPERATIONS.md](OPERATIONS.md) describe recovery and flags. Local checks and a dry run do not prove hosted health or mail delivery.

## What the first release covers

[ACCEPTANCE.md](ACCEPTANCE.md) lists what a person can do in this release and what is not needed. [CONTRACT.md](CONTRACT.md) records the rules the code enforces and [docs/SOURCES.md](docs/SOURCES.md) where the code came from. The integration tests run with `pnpm run test:coffer`.

Coffer is MIT licensed.

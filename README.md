<img src="public/brand/mark.svg" alt="" width="72" height="72">

# Coffer

Coffer keeps donor records for a US nonprofit: donors and households, every gift as an exact ledger line, pledges, and each donor's consent to hear from you. It prepares and sends approved acknowledgement letters for gifts of $250 or more, produces year-end statements and print-ready letters, and builds appeal lists that only ever include donors who said yes. You run the app and hold the data in your own account.

Coffer takes online and monthly gifts on your own campaign pages through your Stripe account, emails receipts, statements, pledge reminders and donor portal links through your SendGrid account, and moves in history from Stripe, Little Green Light, Bloomerang or Raiser's Edge NXT. It does not screen wealth or give tax advice, and the letter wording is your organization's own.

## The run site

Coffer's run site is at https://run-coffer.com, with the run page at https://run-coffer.com/run and the guides at https://run-coffer.com/docs. The same site also runs on your computer: `rer dev` (below) prints a line like `RER_SITE http://127.0.0.1:8904`. Open that address for the homepage, `/run` for the run page and `/docs` for the guides, for example http://127.0.0.1:8904/docs, using the port `rer` printed for you. The guides are also in [docs/](docs/site.json) as Markdown.

## Start from a fresh clone

You need macOS, Linux or Windows with WSL2, and git. One line installs the `rer` launcher, clones Coffer and starts it:

```sh
npx -y @runeditrun/rer dev just-every/run-coffer
```

No Node? `curl -fsSL https://runeditrun.com/install.sh | sh -s -- dev just-every/run-coffer` brings its own Node and does the same.

To start it again later, run `cd run-coffer && rer dev`.

`rer dev` installs dependencies (with the pinned Node 22.20.0 and pnpm 10.12.4), sets up a local owner and starts the real app. The first launch can take a few minutes; if it is interrupted, run `rer dev` again and it picks up where it stopped. When it is ready it prints:

- `RER_READY http://127.0.0.1:<port>`: the app's address.
- `RER_OPEN <link>`: open this link on this computer. It signs you in as the local owner. **The link is a credential: keep it private.**
- `RER_SITE http://127.0.0.1:<port>`: the local run site; add `/run` for the run page.

The link takes you to a one-time **Finish setup** page: tick the box and continue. You land on **Today**. Development mail is suppressed, so no mailbox is needed for local use. Stop the app with `rer dev --stop` or Ctrl-C.

To install for a real owner mailbox instead of the automatic local owner, run `npx -y @runeditrun/rer install just-every/run-coffer`, then `rer setup` and answer its prompts from the checkout, then `rer dev`. [RUN-LOCALLY.md](RUN-LOCALLY.md) covers private answers, the Node runtime and recovery; `rer describe` lists every command.

## Your first week in Coffer

The **Today** page lists these steps and ticks each one off as you finish it.

1. **Review your letter wording.** Open **More → Letter settings**. Enter your organization's name and EIN, check the time zone (gift dates follow it), the threshold (default $250) and how many days you allow to send a letter (default 14). Read the starting letter text and edit it into your own words; Coffer insists only that the letter keeps the donor's name, the amount, the gift date, your organization's name and the goods-or-services statement. Save. Coffer prepares no letters until a person has saved this page.
2. **Move in a year of gifts from Stripe.** Open **More → Move in from Stripe**. Add your saved Stripe pages (see [docs/MOVE-IN.md](docs/MOVE-IN.md) for how to save them; to try it first, use the sample files in `tests/fixtures/stripe/`). Tick **These charges were donations** if none of them paid for tickets or goods. **Preview** shows the donors and gifts it would add and every Stripe object it skips, with the reason, and changes nothing. Tick the approval box and **Apply**. The journal page shows progress, keeps the original Stripe pages and offers **Undo**. A large import applies in parts: press **Continue** until it says **Applied**.
3. **See each donor's history.** **Donors** lists everyone with their total given, last gift and consent. Open a donor for their gifts by year, pledges, consent history, letters, appeals and activity. You can also add a donor and **Record a gift** by hand (amount in dollars, the date received, how it was paid, and whether the donor got goods or services in return).
4. **Record consent.** Appeals only include donors whose latest answer is yes. On **Donors**, tick donors, choose the channel (email or postal mail), the answer, how it was captured and your evidence, and **Record consent**. A donor page shows the full history and lets you record a withdrawal.
5. **Send acknowledgement letters.** **Letters** lists every gift at or over the threshold that has no letter yet, with its due date and an **Overdue** flag. **Prepare letters** fills your wording for each gift. Read the batch, **Approve these letters**, then **Send approved letters** through your installation’s SendGrid account. A receipt goes by email to every donor with an email address, whatever their appeal consent; only donors without an address, or whose earlier receipt bounced, go to the print batch. **Print all letters / save PDF**, print one letter or the pending print batch, and record paper letters as printed. CSV export remains available. Choose a calendar year to prepare year-end statements, one letter per donor listing each gift once with the total, for the same approval and delivery flow. **Check delivery with SendGrid** reads provider events when Email Logs access is enabled; a signed event webhook can update them automatically. See [receipt setup and delivery states](docs/RECEIPTS.md). Imported gifts without a goods-or-services answer wait until someone answers on the donor page.
6. **Run an appeal.** **Appeals → Prepare an appeal**: name it, pick email or postal mail, and optionally only donors who gave since a date. Coffer shows who is included and how many were left out and why. **Approve**, **Export audience**, download the CSV for your email or mailing tool, then **Record as sent**. If anyone's consent changes before approval or export, Coffer refuses and asks you to prepare it again.

Moving from another CRM? **More → Move in from a CRM** lists the export steps for Little Green Light, Bloomerang and Raiser's Edge NXT, previews the files and checks the totals before anything changes ([guide](https://run-coffer.com/docs/move-in-crm)).

To take gifts online, open **Giving → Connect Stripe**. It explains what Stripe does, where to find your test and live keys, how to save them for this installation (the exact commands, filled in) and how to add Stripe's webhook, then checks the connection with Stripe ([guide](https://run-coffer.com/docs/online-giving)). Publish a campaign under **Giving** and share its `/give/<address>` page; the page asks donors separately whether they want appeals by email.

Mistakes are corrected, not edited away: an owner or admin uses **Reverse this gift** on the donor page, which adds a matching negative line with your reason. Totals and letters follow the ledger.

## People and agent access

- **Owner and admins** approve, send and print letters and statements, export appeals, reverse gifts, move records in, change letter settings and manage agent keys.
- **Members** add and edit donors, record gifts, pledges and consent.
- **Only the owner** backs up, restores and erases donors.
- **Agent keys** read records and prepare letter batches and appeal audiences. A person must approve them; every approval records who prepared and who approved the exact content.

Invite people in **More → Data & access → People and roles**: enter their email, choose **Member** or **Admin** and press **Send invitation**. A hosted Coffer emails them a one-use sign-in link that admits them with that role. Coffer on your computer sends no email; a **Sign in as** link appears next to the invited person instead. See [People and roles](https://run-coffer.com/docs/people).

Create an agent key in **More → Data & access**. It is shown once and expires after 30 days. [docs/AGENT-COMMANDS.md](docs/AGENT-COMMANDS.md) lists every endpoint and command an agent can call.

## Back up, restore and erase

The owner can **Download backup** in **Data & access**, or export from the command line with the app stopped:

```sh
rer dev --stop
rer export --output exports/coffer.rer
```

The backup holds donors, gifts, consent history, letters, appeals, approvals and the retained Stripe pages. Sign-in accounts, sessions, agent keys and mail settings are left out. Keep it private. To restore on another computer, run `npx -y @runeditrun/rer dev just-every/run-coffer` once to set up a fresh owner. Then, in that Coffer folder, stop it, move the downloaded backup in, make it private (browsers save downloads readable by other accounts, and `rer import` refuses them) and restore it:

```sh
rer dev --stop
mkdir -p exports
mv ~/Downloads/coffer.rer exports/coffer.rer
chmod 600 exports/coffer.rer
rer import --input exports/coffer.rer --yes
rer dev
```

Restore only goes into an empty installation; a populated one is refused.

To honor an erasure request, the owner opens the donor, types `ERASE` and presses **Erase donor**. Their name, contact details, consent evidence, letter text, gift notes and the Stripe pages that mention them are removed, and a later move-in will not bring them back. Their gift amounts and dates stay as anonymous ledger lines because they are the charity's financial record. Afterwards save a fresh backup; when restoring an older backup, pass it as the later journal so the erased person does not come back: `rer import --input exports/older.rer --journal exports/after-erasure.rer --yes`.

## Deploy in your own Cloudflare account

Local use needs no Cloudflare account. To host Coffer you need your own Cloudflare account with a workers.dev subdomain and an account API token with **Workers Scripts: Edit** and **D1: Edit**, plus a SendGrid account for mail. Coffer declares one D1 database; everything it creates belongs to your account.

Hosted mail uses three Worker secrets: `MAIL_PROVIDER=sendgrid`, `MAIL_API_KEY` (a SendGrid API key with Mail Send permission) and `MAIL_FROM` (a sender address you verified in SendGrid). Receipts and statements only go through SendGrid. Stop the local app first (`rer deploy` refuses while `rer dev` holds the folder), then give the Cloudflare and mail settings through your environment (never in source or command arguments) and deploy:

```sh
rer dev --stop
export CLOUDFLARE_ACCOUNT_ID=your-account-id
read -rs CLOUDFLARE_API_TOKEN && export CLOUDFLARE_API_TOKEN
export OWNER_EMAIL=you@yourcharity.example.org MAIL_PROVIDER=sendgrid MAIL_FROM=receipts@yourcharity.example.org
read -rs MAIL_API_KEY && export MAIL_API_KEY
rer deploy --dry-run
rer deploy --environment production
```

Each `read` waits for you to paste a value and press Enter, without showing it. The dry run builds and validates locally without contacting Cloudflare. The real deploy creates the Worker `coffer-production` and its D1 database, applies the migrations, checks the hosted `/health`, claims the owner for `OWNER_EMAIL` and prints the address; rer generates the session and setup secrets. Keep the private `.rer/deploy/` folder it writes out of Git and back it up: later deploys use it to recognize the resources as yours. Change a secret later with `rer deploy --environment production --set-secret NAME`. Then connect Stripe in **Giving → Connect Stripe**.

To take a hosted Coffer down, first sign in as the owner and **Download backup** from **More → Data & access** (or copy the whole database with `npx wrangler d1 export coffer-production-db --remote --output exports/coffer-production-db.sql`), then run `rer deploy --environment production --remove --yes`. It deletes the Worker and database it created, with every record in them, reads back that both are gone and touches nothing else. [Host it on Cloudflare](https://run-coffer.com/docs/hosting) covers each step; the [Base owner-account deploy kit](https://github.com/runeditrun/base/blob/ada9f574d8a7247edc3a1180b593ad182b1fbb37/modules/deploy-kit/README.md) and [OPERATIONS.md](OPERATIONS.md) describe recovery and flags. Local checks and a dry run do not prove hosted health or mail delivery.

## What the first release covers

[ACCEPTANCE.md](ACCEPTANCE.md) lists what a person can do in this release and what is not needed. [CONTRACT.md](CONTRACT.md) records the rules the code enforces and [docs/SOURCES.md](docs/SOURCES.md) where the code came from. The integration tests run with `pnpm run test:coffer`.

Coffer is MIT licensed.

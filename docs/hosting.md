# Host it on Cloudflare

Coffer on your computer needs no accounts. To let your team and donors reach it, host it in your own Cloudflare account. Everything it creates there (one Worker and one D1 database) belongs to you.

## What you need

- A Cloudflare account with a workers.dev subdomain, and an account API token with **Workers Scripts: Edit** and **D1: Edit** (Cloudflare dashboard → **My Profile → API Tokens → Create Token**).
- A SendGrid account for email: sign-in links, invitations, receipts, pledge reminders and donor portal links. Create an API key with **Mail Send** permission (**Settings → API Keys**), and verify the address Coffer sends from (**Settings → Sender Authentication**: a single sender, or better, your domain).
- The Coffer folder on your computer, where `rer dev` runs.

## Mail

A hosted Coffer sends mail through SendGrid with three settings:

| Setting | Value |
| --- | --- |
| `MAIL_PROVIDER` | `sendgrid` |
| `MAIL_API_KEY` | your SendGrid API key |
| `MAIL_FROM` | the sender address you verified in SendGrid, for example `receipts@yourcharity.example.org` |

They are secrets of the Worker, given at deploy time (below), never written into `deploy.json` or any file in the repository. Receipts and statements go only through `sendgrid`, so use it for all of Coffer's mail. Delivery tracking is optional; [Sending and printing receipts](/docs/receipts) explains it.

## Deploy

Stop Coffer on your computer first: a running `rer dev` holds the folder, and `rer deploy` refuses until it stops. Then, in a terminal in the Coffer folder:

```sh
rer dev --stop
export CLOUDFLARE_ACCOUNT_ID=your-account-id
read -rs CLOUDFLARE_API_TOKEN && export CLOUDFLARE_API_TOKEN
export OWNER_EMAIL=you@yourcharity.example.org MAIL_PROVIDER=sendgrid MAIL_FROM=receipts@yourcharity.example.org
read -rs MAIL_API_KEY && export MAIL_API_KEY
rer deploy --dry-run
rer deploy --environment production
```

Each `read` waits for you to paste a value and press Enter; nothing shows while you paste. The dry run builds and checks everything without contacting Cloudflare. The real deploy creates the Worker `coffer-production` and its D1 database, applies the database steps, checks that the new Coffer answers, claims the owner for `OWNER_EMAIL` and prints the address. Open it, enter your email on the sign-in page and follow the link SendGrid delivers. rer generates the session and setup secrets itself and keeps them in `.rer/deploy/` (private, ignored by Git); back that folder up, because later deploys use it to recognise the resources as yours.

To deploy a second copy (for testing), use another environment name, such as `--environment trial`; every name gives its own Worker `coffer-<name>` and database.

After deploying, connect Stripe from **Giving → Connect Stripe** ([Online and monthly giving](/docs/online-giving)) and invite your team from **More → Data & access** ([People and roles](/docs/people)).

## Change a setting later

Change one or more secrets without a rebuild, in one new version of the Worker:

```sh
read -rs MAIL_API_KEY && export MAIL_API_KEY
rer deploy --environment production --set-secret MAIL_API_KEY
```

## Update to a newer Coffer

Pull the new version, then deploy again with the same environment name and the same exported settings as the first time (`CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `OWNER_EMAIL`, `MAIL_PROVIDER`, `MAIL_FROM`, `MAIL_API_KEY`). rer checks the mail settings before it builds; the Worker keeps the secret values it already holds.

```sh
rer dev --stop
git pull --ff-only
rer deploy --environment production
```

## Back up a hosted Coffer

Pause donor and staff writes while a backup runs. From the Coffer folder that deployed the environment, create an authenticated portability archive:

```sh
rer run backup:hosted -- --environment production --output exports/coffer.rer --session-file owner-session.txt
```

Sign in as the owner at the hosted origin first. In browser Developer Tools, open **Application** (or **Storage**) → **Cookies**, choose that origin, and copy the `__Host-operator_session` cookie name and value. Save the single `NAME=VALUE` cookie to `owner-session.txt` using a hidden terminal prompt, then restrict the file to your account:

```sh
read -rsp 'Paste the owner cookie NAME=VALUE: ' OWNER_COOKIE
printf '\n'
umask 077
printf '%s' "$OWNER_COOKIE" > owner-session.txt
unset OWNER_COOKIE
chmod 600 owner-session.txt
```

The command reads the hosted origin from `.rer/deploy/production.json` and authenticates with the owner cookie; it does not need Cloudflare credentials. If you run from another Coffer clone without that deploy receipt, pass the address with `--origin https://your-coffer.example.org`. Keep the session file and `.rer` archive private. The archive excludes accounts, sessions and secrets. `rer export` saves only the local installation and cannot back up a hosted Coffer. See [Back up, restore and erase](/docs/backup) for the full restore steps.

## Take it down

Taking a hosted Coffer down deletes its Worker and its database, with every record in it, and cannot be undone. Capture a hosted backup first (above), then restore it into a newly deployed empty environment and check the restored records before removal. Then, in the same terminal setup as for deploying:

```sh
rer deploy --environment production --remove --yes
```

rer deletes only what its own deploy record says it created for that environment, reads back that each piece is gone and touches nothing else. Your Stripe account, its webhook and your SendGrid account stay; delete the Coffer webhook in Stripe under **Developers → Webhooks** if you no longer need it.

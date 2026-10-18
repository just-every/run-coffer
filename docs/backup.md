Your donor records live in your own installation. Back them up regularly and keep each archive private.

## Download a local backup

The owner opens **More → Data & access** and presses **Download backup**. Or, from the command line with Coffer stopped:

```sh
rer dev --stop
rer export --output exports/coffer.rer
```

`rer export` reads the installation on this computer only. It does not connect to or back up a hosted Coffer.

A backup holds donors, gifts, consent history, letters, appeals, approvals and the Stripe pages kept from each move-in. Sign-in accounts, sessions, agent keys, mail settings and installation access activity are left out. Donor-history audit events travel with the records. The destination keeps its own sign-in and access history; export that separately from **More → Audit log → Download filtered CSV**.

## Restore a local backup

1. Get the same Coffer version and start it once so it sets up a fresh owner ([Getting started](/docs/getting-started)).
2. In that Coffer folder, stop it, move the archive in, make it private and restore it:

```sh
rer dev --stop
mkdir -p exports
mv ~/Downloads/coffer.rer exports/coffer.rer
chmod 600 exports/coffer.rer
rer import --input exports/coffer.rer --yes
rer dev
```

Browsers save downloads so other accounts on the computer can read them. `chmod 600` makes the file yours alone, which `rer import` requires before it reads a backup. Change `~/Downloads` if your browser saves somewhere else. An archive made with `rer export` is already private.

A restore only goes into an empty installation; Coffer refuses to restore over records you already have.

## Back up and restore a hosted Coffer

Pause donor and staff writes while the backup runs so the archive captures a consistent point in time. Run this from the Coffer folder that deployed the hosted environment. The command reads the hosted origin from `.rer/deploy/production.json` and authenticates with the owner cookie; it does not need Cloudflare credentials:

```sh
rer run backup:hosted -- --environment production --output exports/coffer.rer --session-file owner-session.txt
```

If you are running from another Coffer clone without that deploy receipt, provide the hosted address explicitly with `--origin https://your-coffer.example.org`.

The owner session file contains one cookie header value, `__Host-operator_session=VALUE`. To create it, first sign in as the owner at the hosted Coffer origin. In your browser's Developer Tools, open **Application** (or **Storage**) → **Cookies**, select that origin, and copy the `__Host-operator_session` cookie name and value. In a terminal, enter it into a hidden prompt and save the file privately:

```sh
printf 'Paste the owner cookie NAME=VALUE: '
read -rs OWNER_COOKIE
printf '\n'
umask 077
printf '%s' "$OWNER_COOKIE" > owner-session.txt
unset OWNER_COOKIE
chmod 600 owner-session.txt
```

Keep the session file private and remove it when the backup is complete. The backup archive excludes accounts, sessions and secrets. It contains Coffer's donor and fundraising records; it does not contain the owner's login or mail and Stripe credentials.

To restore, deploy an empty environment using the same Coffer version and the same Cloudflare account credentials. Sign in as the owner at the new environment's origin, create a new session file for that origin using the steps above, then restore:

```sh
rer deploy --environment restored --env-file .env.coffer
rer run backup:hosted -- --environment restored --restore exports/coffer.rer --session-file restored-owner-session.txt --yes
```

The destination must be a newly deployed, empty environment. The restore uses the destination owner's session, not the source environment's session. Re-enter the destination's mail and Stripe secrets through `rer deploy` before resuming mail or online giving. Review records and settings at the restored origin before directing people there.

Hosted backup and restore operate on the authenticated Coffer portability archive. They do not promise a raw SQL database restore. Keep the archive in a private location, and retain it until you have checked the restored records.

## Erase a donor

When someone asks you to erase their data, the owner opens their page, types `ERASE` under **Erase this donor** and presses **Erase donor**. Their name, contact details, consent evidence, letter text, gift notes and the Stripe pages that mention them are removed, and a later move-in will not bring them back. Their gift amounts and dates stay as anonymous ledger lines, because they are your organization's financial record.

Afterwards, download a fresh backup. If you ever restore an older backup, pass the newer one as the journal so the erased person does not come back:

```sh
rer import --input exports/older.rer --journal exports/after-erasure.rer --yes
```

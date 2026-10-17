Your donor records live in your own installation. Back them up regularly and keep the file private.

## Download a backup

The owner opens **More → Data & access** and presses **Download backup**. Or, from the command line with Coffer stopped:

```sh
rer dev --stop
rer export --output exports/coffer.rer
```

A backup holds donors, gifts, consent history, letters, appeals, approvals and the Stripe pages kept from each move-in. Sign-in accounts, sessions, agent keys and mail settings are left out.

## Restore on another computer

1. Get Coffer and start it once so it sets up a fresh owner ([Getting started](/docs/getting-started)).
2. In a terminal in that Coffer folder, stop it, move the downloaded backup in, make it private and restore it:

```sh
rer dev --stop
mkdir -p exports
mv ~/Downloads/coffer.rer exports/coffer.rer
chmod 600 exports/coffer.rer
rer import --input exports/coffer.rer --yes
rer dev
```

Browsers save downloads so other accounts on the computer can read them. `chmod 600` makes the file yours alone, which `rer import` requires before it reads a backup. Change `~/Downloads` if your browser saves somewhere else. A backup made with `rer export` is already private.

A restore only goes into an empty installation; Coffer refuses to restore over records you already have.

## Back up a hosted Coffer

**Download backup** works the same on a hosted Coffer and saves its records. [Host it on Cloudflare](/docs/hosting#back-up-a-hosted-coffer) also shows how to copy the whole hosted database, and how to take a hosted Coffer down once you have a backup.

## Erase a donor

When someone asks you to erase their data, the owner opens their page, types `ERASE` under **Erase this donor** and presses **Erase donor**. Their name, contact details, consent evidence, letter text, gift notes and the Stripe pages that mention them are removed, and a later move-in will not bring them back. Their gift amounts and dates stay as anonymous ledger lines, because they are your organization's financial record.

Afterwards, download a fresh backup. If you ever restore an older backup, pass the newer one as the journal so the erased person does not come back:

```sh
rer import --input exports/older.rer --journal exports/after-erasure.rer --yes
```

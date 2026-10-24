# Foundation operations

Run all first-party operations from the composed, runnable edition checkout
with `rer`. To get a runnable checkout, run `npx -y @runeditrun/rer dev just-every/run-coffer` (set up only: `npx -y @runeditrun/rer setup just-every/run-coffer`; without Node: `curl -fsSL https://runeditrun.com/install.sh | sh -s -- dev just-every/run-coffer`). Inside that checkout, `rer dev` alone launches it for review. The detailed flags and effects are in
`RUN-LOCALLY.md` and `SEED-COMMAND-CONTRACT.md`.

```sh
rer install
rer setup --owner-email you@example.com
rer dev
```

Use the setup prompt instead of the owner-email flag when entering the real
mailbox. Open the printed `RER_OPEN` link to sign in as the owner. Development
and demo mail is silently suppressed. Stop `dev` with
`rer dev --stop` or Ctrl-C, and stop `preview` with
`rer preview --stop` before build or verification.

```sh
rer verify
rer reset --yes
rer export --output exports/installation.rer
rer import --input exports/installation.rer --yes
rer deploy
rer describe
```

Use `rer describe` to inspect the checkout's actual
capabilities. `rer check --profile first-party` validates the
declared command contract; it does not run application journeys or contact a
provider.

## Local data and recovery

Setup and development use explicit owner identity and real local migrations.
Dev and preview use the same owner and canonical `.wrangler/state`. Local dev
sign-in uses the checkout’s private key; keep `RER_OPEN` private. Private
settings are kept in `.dev.vars` with mode 0600 and are not copied into build output.

Local export creates a private archive with an integrity receipt and explicit
exclusions. The foundation has no product-domain tables or background jobs; an
edition's archive contains the supported domain tables and resources that its
adapter declares. Owner and authentication state, outbox, bookkeeping, private settings and
transient runtime state are excluded. Import validates and restores atomically
into an empty destination; confirmed reset preserves export archives. Run setup
after restore to establish a fresh owner. Each first-party seed verifies local
equivalence through export, import and re-export across its supported resources. Remote transfer
is available only when the adapter declares complete resource coverage.

Preserve ambiguous state and applied migration history. Never place a remote
credential, owner secret or local resource ID in source. A schema change needs
a forward migration and verified transition/recovery.

## Deployment

`rer deploy --dry-run` validates the real owner-account
deployment declaration and builds locally without provider requests. Real
deployment requires privately supplied `CLOUDFLARE_ACCOUNT_ID` and
`CLOUDFLARE_API_TOKEN`, the owner email, and the mail secrets `MAIL_PROVIDER=sendgrid`,
`MAIL_API_KEY` and a verified `MAIL_FROM` sender (rer generates the session and setup
secrets). Remove a deployment with `rer deploy --environment NAME --remove --yes`
after downloading a hosted backup. Follow the owner-account deploy-kit
instructions under `node_modules/@runeditrun/rer/modules/deploy-kit`; account scope,
resource ownership, migrations, receipt and health checks are defined there.
Local validation does not prove hosted acceptance, provider delivery or remote
health.

## Hosted delivery package

`packaging.json` declares this installation's Worker, DB and FILES resources,
unchanged migration sources, recovery instructions and hosted setup. Run
`pnpm run build`, then `pnpm delivery:spec` to refresh the committed deployment
specification. `pnpm check:deployment-spec` refuses a stale projection.
Package with `node scripts/delivery/base/cli.mjs package --config packaging.json --output rer-package`,
or produce only the artifact with `node scripts/delivery/base/cli.mjs artifact --config packaging.json`.
The generated output directories are disposable. The Managed workflow accepts
manual dispatch only. No release tag is created by these commands.

Managed authentication mail uses the assigned RER relay URL and private mail
credential. Assisted authentication mail can use SendGrid, Resend or Cloudflare
with the selected provider's own credentials and sender setup. Coffer's receipt
and pledge-reminder delivery still requires SendGrid and explicitly refuses
Managed installations. Do not treat successful authentication mail setup as
proof that those donor-mail workflows are available on Managed hosting.

Coffer runs on your own computer. You need macOS, Linux or Windows with WSL2, and git.

## Start Coffer

Two lines install the `rer` launcher, get Coffer and start it:

```sh
curl -fsSL https://runeditrun.com/install.sh | sh
rer dev just-every/run-coffer
```

The first line installs `rer` for you alone, with its own Node if you have none. It changes no shell settings: if it prints an `export PATH=…` line, run that line before the second. Already have Node 22 or later? `npx -y @runeditrun/rer dev just-every/run-coffer` does both lines in one.

The first start installs everything and can take a few minutes. If it is interrupted, run the same line again: it picks up where it stopped. When Coffer is ready it prints:

- `RER_READY http://127.0.0.1:<port>`, the app's address.
- `RER_OPEN <link>`. Open this link on this computer: it signs you in as the owner. **The link is a credential: keep it private.**
- `RER_SITE http://127.0.0.1:<port>`, a local copy of this site.

## Finish setup

The link opens a one-time **Finish setup** page. Tick the box and continue. You land on **Today**, which lists your first steps and ticks each one off as you finish it: [Your first week](/docs/first-week) walks through them.

Local use sends no email, so no mailbox is needed.

## Stop and start again

Stop Coffer with `rer dev --stop`, or Ctrl-C in the window where it runs. To start it again later:

```sh
cd run-coffer && rer dev
```

## Install for a real owner mailbox

The two lines above make a local owner automatically. To install with your own email as the owner instead, run these from the `run-coffer` folder and answer the prompts:

```sh
rer install
rer setup
rer dev
```

`rer describe` lists every command.

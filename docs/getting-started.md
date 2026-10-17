Coffer runs on your own computer. You need macOS, Linux or Windows with WSL2, and git.

## Start Coffer

One line installs the `rer` launcher, gets Coffer and starts it:

```sh
npx -y @runeditrun/rer dev just-every/run-coffer
```

No Node? `curl -fsSL https://runeditrun.com/install.sh | sh -s -- dev just-every/run-coffer` brings its own Node and does the same.

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

The line above makes a local owner automatically. To install with your own email as the owner instead, run `npx -y @runeditrun/rer install just-every/run-coffer`, then run these from the `run-coffer` folder and answer the prompts:

```sh
rer setup
rer dev
```

`rer describe` lists every command.

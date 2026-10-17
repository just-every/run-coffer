An appeal's audience only ever includes donors whose latest answer for that channel is yes. Coffer builds the list and a person approves it. You then send the email through Mango or Mailchimp, or download the list for any other email or mailing tool.

## Prepare an audience

On **Appeals**, an owner or admin fills in **Prepare an appeal**:

- **Appeal name**, such as "Spring 2026 appeal".
- **Channel**: email or postal mail.
- **Gave since** (optional): only donors with a gift on or after this date.
- **At least this much since then** (optional, with **Gave since**): only donors whose gifts since that date add up to this amount or more.
- **Email subject** and **Email message**: needed to send the appeal by email through Mango or Mailchimp. Leave both blank to download the list instead. If you fill in one, Coffer asks for the other on the same page.

**Prepare audience** shows who is included and how many were left out, by reason: no consent recorded, consent withdrawn, no email address or no postal address. An agent with a key can prepare an audience too; it cannot approve one.

## Approve, export and record

1. Check the recipients and press **Approve this audience**. Coffer records who prepared and who approved it, with each recipient's exact consent answer.
2. To send by email, see the next section. Otherwise press **Export audience**, then **Download audience (CSV)** for your email or mailing tool.
3. Send the appeal.
4. Enter the date it went out and press **Record as sent**. Each recipient's page lists the appeal.

## Send by email through Mango or Mailchimp

Open **Appeals → Connect Mango or Mailchimp**. You need to do this once.

**Mango** is a free, open-source email and text marketing app from the same family as Coffer, which you run yourself. To get one, open [run-mango.com/run](https://run-mango.com/run), or run `curl -fsSL https://runeditrun.com/install.sh | sh -s -- dev just-every/run-mango`.

1. Sign in to Mango as its owner and open **Settings**. Under **Integration credentials**, name a credential `Coffer`, tick all four boxes (contacts:read, contacts:write, events:read, campaigns:send) and press **Create credential**.
2. Copy the credential straight away: Mango shows it only once.
3. In Coffer, paste Mango's address (as your browser shows it) and the credential, then press **Connect Mango**. Coffer checks both with Mango before saving them. They stay in Coffer's own database; you do not change any deploy settings.

On an approved email appeal, **Add recipients to Mango** puts every consenting donor on a Mango list named after the appeal, with the consent they gave. Coffer then shows **Finish in Mango**: start a campaign in Mango for that list, paste the subject and message Coffer shows, approve it and choose a time. Mango sends it and lists every send under the campaign's results. Mango fills in each donor's name; it cannot fill in giving figures, so Coffer tells you which sentences to rewrite.

**Mailchimp**: in Mailchimp open **Profile → Extras → API keys**, create a key and paste it into Coffer. Coffer lists your audiences: pick one and enter the sender name and reply-to address. **Send through Mailchimp** then sends each recipient the approved message as a Mailchimp campaign to a saved segment holding just that donor. Mailchimp asks new contacts to confirm before they receive appeals.

Until a provider is connected, the send button on an approved appeal leads to the connect page. Opt-outs flow both ways once connected: **Sync email preferences** reads unsubscribes from the provider and sends Coffer withdrawals to it. Receipts never depend on this connection.

## When consent changes

If any recipient's consent changes before approval or export, Coffer refuses and says how many changed. Discard the audience and prepare it again, so nobody who said no is ever sent an appeal.

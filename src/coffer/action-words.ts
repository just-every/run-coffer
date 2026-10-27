// Recorded actions as a person reads them. Every screen that shows an action
// (the audit log, a donor's activity, a letter batch, agent activity) reads it
// through here; the API and the audit CSV keep the codes.

const ACTIONS: Record<string, string> = {
 'singleLetter.prepare':'Single letter produced', 'singleLetter.approve':'Single letter approved', 'ack.sendPostal':'Postal spending authorized', 'communication.preferences':'Communication choices recorded',
 'pledgeTemplate.save':'Pledge reminder wording reviewed',
 'contact.save':'Contact point saved', 'custom.define':'Custom field defined', 'custom.set':'Custom value saved', 'custom.clear':'Custom value cleared',
 'list.save':'Live list saved', 'list.bulk':'List tags and manager changed', 'list.undo':'List changes undone', 'list.profile':'List profiles changed', 'list.profileUndo':'List profile changes undone', 'list.tasks':'List call tasks created', 'list.welcome':'List welcome enrollment reviewed', 'list.solicitation':'List solicitation restrictions changed',
 'solicitation.set':'Solicitation restriction saved', 'solicitation.include':'One-run inclusion recorded', 'solicitation.import':'Solicitation restriction imported', 'solicitation.resolveMerged':'Original merged restriction resolved', 'solicitation.mergeCustody':'Merged communication choices preserved',
 'sms.preference':'Text permission recorded', 'sms.prepare':'Text run prepared', 'sms.approve':'Text run approved', 'sms.discard':'Unsent text run discarded', 'sms.claim':'Text submission started', 'sms.submitted':'Text submitted', 'sms.uncertain':'Text submission uncertain', 'sms.failed':'Text rejected by provider', 'sms.stop':'Text permission withdrawn by STOP',
 'giftRule.save':'Gift rule saved unpublished', 'giftRule.publish':'Gift rule reviewed and published', 'giftRule.pause':'Gift rule paused', 'giftRule.fire':'Gift rule action recorded', 'giftRule.notification':'Team notice result recorded',
 'contribution.record':'Typed contribution recorded', 'contribution.stockSale':'Stock sale recorded',
 'giftBatch.create':'Gift batch opened', 'giftBatch.add':'Gift added to batch', 'giftBatch.edit':'Gift batch entry corrected', 'giftBatch.close':'Balanced gift deposit closed',
 'recognition.donor':'Donor recognition saved', 'recognition.gift':'Gift recognition saved', 'recognition.honorRoll':'Honor roll prepared',
 'ack.prepare': 'Letters prepared', 'ack.prepareStatements': 'Year-end statements prepared', 'ack.approve': 'Letters approved',
 'ack.discard': 'Letters discarded', 'ack.export': 'Letters exported', 'ack.markSent': 'Letters marked sent', 'ack.send': 'Letters emailed',
 'ack.printed': 'Letters recorded as printed', 'ack.checkDelivery': 'Email delivery checked',
 'agent.create': 'Agent key created', 'agent.revoke': 'Agent key revoked', 'agent.read': 'Records read by an agent', 'agent.undo': 'Agent action undone',
 'agent.receipts.prepare': 'Missing receipts prepared',
 'appeal.prepare': 'Appeal audience prepared', 'appeal.approve': 'Appeal approved', 'appeal.discard': 'Appeal discarded',
 'appeal.export': 'Appeal audience exported', 'appeal.markSent': 'Appeal marked sent', 'appeal.send': 'Appeal emailed',
 'campaign.create': 'Campaign created', 'consent.record': 'Consent recorded',
 'donor.create': 'Donor added', 'donor.update': 'Donor details changed', 'donor.erase': 'Donor erased', 'donor.dataRequest': 'Donor’s data file produced', 'donor.merge': 'Donors merged', 'donor.unmerge': 'Merge undone',
 'export.download': 'File downloaded', 'request.change': 'Change saved',
 'gift.record': 'Gift recorded', 'gift.reverse': 'Gift reversed', 'gift.classify': 'Goods or services answered',
 'giving.paid': 'Paid online', 'payments.gift': 'Stripe gift recorded', 'payments.entry': 'Stripe transaction recorded',
 'interaction.record': 'Conversation recorded', 'tribute.record': 'Tribute recorded',
 'match.record': 'Employer match expected', 'match.receive': 'Employer match received',
 'pledge.create': 'Pledge recorded', 'pledge.match': 'Gift applied to a pledge', 'pledge.remind': 'Pledge reminder sent', 'pledge.reminder': 'Pledge reminder sent',
 'planned.save': 'Planned intention saved', 'planned.realize': 'Estate gift linked', 'planned.unlink': 'Estate gift unlinked', 'legacy.set': 'Legacy society membership changed',
 'prospect.save': 'Prospect saved', 'relationship.create': 'Relationship added', 'relationship.remove': 'Relationship removed',
 'settings.update': 'Letter settings saved', 'softCredit.record': 'Soft credit recorded', 'softCredit.remove': 'Soft credit removed',
 'task.repeatCreate': 'Repeating task created', 'task.repeatComplete': 'Repeating task completed', 'task.repeatNext': 'Next repeating task created',
 'task.generate': 'Call task created', 'task.assign': 'Call task assigned', 'task.snooze': 'Call task snoozed', 'task.complete': 'Call logged',
 'stewardship.draft': 'Thank-you drafted', 'stewardship.save': 'Thank-you saved', 'stewardship.send': 'Thank-you emailed',
 'stewardship.discard': 'Thank-you draft discarded', 'stewardship.restore': 'Thank-you draft restored', 'stewardship.key': 'AI key changed',
 'marketing.connect': 'Email marketing connected', 'marketing.connectMango': 'Mango connected', 'marketing.connectMailchimp': 'Mailchimp connected',
 'marketing.disconnect': 'Email marketing disconnected', 'marketing.unsubscribe': 'Opt-out sent to email marketing', 'marketing.sync': 'Email preferences synced',
 'marketing.prepare': 'Appeal prepared for email marketing', 'marketing.submitted': 'Appeal handed to email marketing', 'marketing.listed': 'Added to the Mango list',
 'marketing.result': 'Email marketing result recorded',
 'reconciliation.run': 'Gifts reconciled', 'reconciliation.applied': 'Reconciliation correction applied', 'reconciliation.undone': 'Reconciliation correction undone',
 'receipts.prepare': 'Missing receipts prepared', 'receipts.discard': 'Missing receipts discarded',
 'recovery.run': 'Monthly gifts checked', 'recovery.schedule': 'Retry schedule set', 'recovery.waiting': 'Card update requested',
 'recovery.recovered': 'Monthly gift recovered', 'recovery.lapsed': 'Monthly gift lapsed',
 'reply.received': 'Reply received', 'reply.complete': 'Reply handled', 'welcome.publish': 'Welcome email published', 'welcome.run': 'Welcome emails sent',
 'mail.delivered': 'Email delivered', 'mail.bounced': 'Email bounced', 'mail.complained': 'Email marked as spam',
 'auth.signin': 'Signed in', 'auth.sessionEnded': 'Signed out', 'auth.idpSignIn': 'Sign-in options changed',
 'auth.owner:signin-link': 'Owner sign-in link used', 'auth.provider:unlink': 'Sign-in account unlinked',
 'stripe.charge.succeeded': 'Card charge succeeded', 'stripe.charge.failed': 'Card declined', 'stripe.charge.refunded': 'Charge refunded',
 'stripe.charge.updated': 'Charge updated', 'stripe.customer.created': 'Stripe customer created', 'stripe.invoice.paid': 'Monthly invoice paid',
 'stripe.invoice.updated': 'Monthly invoice updated', 'stripe.invoice.payment_failed': 'Monthly payment failed',
 'stripe.checkout.session.completed': 'Online checkout completed',
 'stripe.payout.created': 'Payout created', 'stripe.payout.paid': 'Payout paid', 'stripe.payout.failed': 'Payout failed',
 'stripe.payout.canceled': 'Payout canceled', 'stripe.payout.updated': 'Payout updated',
 'stripe.refund.created': 'Refund created', 'stripe.refund.failed': 'Refund failed', 'stripe.refund.updated': 'Refund updated',
}

const RECORDS: Record<string, string> = {
 acknowledgements: 'Letter batch', appeal: 'Appeal', agent: 'Agent key', campaign: 'Campaign', donor: 'Donor', gift: 'Gift',
 identity: 'Sign-in settings', interaction: 'Conversation', letter: 'Letter', match: 'Employer match', operator: 'Team member',
 payment: 'Stripe transaction', pledge: 'Pledge', 'provider-event': 'Stripe event', prospect: 'Prospect', relationship: 'Relationship',
 reply: 'Reply', route: 'Page', settings: 'Letter settings', softCredit: 'Soft credit', stewardship: 'Thank-you draft', task: 'Call task',
}

/** Services that act on their own: their rows read "via Stripe", never as an agent or a person. */
const SERVICES = new Set(['stripe', 'mail-provider', 'email-routing', 'online-receipts'])

/** "softCredit.remove" → "Soft credit remove": a code no one named yet still reads as words. */
const words = (code: string) => {
 const text = code.replace(/^(auth|stripe)\./, '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[._:-]+/g, ' ').trim().toLowerCase()
 return text.charAt(0).toUpperCase() + text.slice(1)
}

export const actionWords = (action: string) => ACTIONS[action] ?? words(action)
export const recordWords = (kind: string) => RECORDS[kind] ?? words(kind)

/** A recorded row's actor: actor_id, actor_name and actor_role. */
type Actor = Record<string, any>
const service = (r: Actor) => SERVICES.has(r.actor_id ?? '') || r.actor_role === 'system'
/** "Owner", "Agent", "Service": the kind of actor under a name in the audit log. */
export const roleWords = (r: Actor) => service(r) ? 'Service' : words(r.actor_role)
/** "Gift recorded by June Albright", "Letters prepared by Weekly letters assistant (agent)", "Paid online via Stripe". */
export const activityWords = (r: Actor) =>
 `${actionWords(r.action)} ${service(r) ? 'via' : 'by'} ${r.actor_name}${!service(r) && r.actor_role === 'agent' && !/agent$/i.test(r.actor_name) ? ' (agent)' : ''}`

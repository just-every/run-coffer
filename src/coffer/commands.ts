import { teamAccessCommand, readOnlyRefusal } from './team-access'
import { peerNoticeCommand } from './peer/notices'
import { builderCommand } from './report-builder/store'
import { journeyCommand } from './communications/journeys'
import { postalCommand } from './postal-delivery'
import { preferenceCommand } from './communications/preference-store'
import { singleLetterCommand } from './single-letters'
import { apiKeyCommand } from './api/keys'
import { auctionCommand, AUCTION_COMMANDS } from './auction'
import { rankCalls, saveCallRankPolicy } from './call-ranking'
import { taskTeamCommand } from './task-team'
import { webhookCommand } from './webhooks'
import { fundraisingEventCommand } from './fundraising-events'
import { reportScheduleCommand } from './report-schedules'
import { reservePreparationGrant } from './agent-grants-legacy'
import { agentGrantCommand } from './agent-grants'
import { executeGranted } from './agent-grants-execution'
import { protectionCommand } from './giving/protection'
import { givingConnectionCommand } from './giving/connections'
import { profileFieldCommand } from './communications/profile-fields'
import { pledgeTemplateCommand } from './pledge-templates'
import { contactCommand } from './contact-points'
import { listTasksCommand } from './list-tasks'
import { profileBulkCommand } from './list-profile-bulk'
import { bulkListCommand } from './list-bulk'
import { restorePendingCommand } from './list-pending-restore'
import { customChoiceCommand } from './custom-choices'
import { tagCommand } from './tags'
import { customFieldCommand } from './custom-fields'
import { addressCommand } from './addresses/commands'
import { contributionTypeCommand } from './contribution-types'
import { giftRulesCommand, runGiftRules } from './gift-rules'
import { solicitationCommand } from './solicitation'
import { smsCommand } from './sms'
import { smsRegistrationCommand } from './sms-registration'
import { giftBatchCommand } from './gift-batches'
import { savedListCommand } from './saved-lists'
import { giftAcknowledgmentWrite } from './gift-ack-write'
import { personDefaultsCommand } from './person-defaults'
import { organizationContactCommand } from './organizations'
import { meetingQuestionCommand } from './meeting-questions'
import { householdCommand } from './households'
import { statusCommand } from './status'
import { meetingCommand } from './meeting-briefs'
import { calendarCommand } from './calendars/google'
import { bookingCommand } from './calendars/bookings'
import { tributeNotificationCommand } from './tribute-notifications'
import { receiptTaskCommand } from './receipt-tasks'
import { dashboardCommand } from './dashboard'
import { recognitionCommand } from './recognition'
import { researchCommand } from './research'
import { volunteerCommand } from './volunteering'
import { taxReportCommand } from './tax-reports'
import { inKindCommand } from './in-kind'
import { grantCommand } from './grants'
import { engagementCommand } from './engagement'
import { cultivationCommand } from './cultivation'
import { softCreditAckCommand } from './soft-credit-ack'
import { portfolioCommand } from './portfolios'
import { plannedGivingCommand } from './planned-giving'
import { restrictedFundCommand } from './restricted-funds'
import { attributionCommand } from './attribution'
import { recurringTaskCommand } from './recurring-tasks'
import { marketingCommand } from './communications/commands'
import { syncPreferences } from './communications/preferences'
import { welcomeCommand } from './communications/welcome'
import { replyCommand } from './communications/replies'
import { callTaskCommand } from './call-tasks'
import { majorGiftCommand } from './major-gifts'
import { digest, requireRole, type Role } from './auth'
import { commit, event, fail, newId, object, sql, text, type Context, type Row } from './db'
import { mergeDonor, undoMerge, canonicalDonor } from './donor-merge'
import { donorDepthCommand } from './donor-depth'
import { giftDepthCommand } from './gift-depth'
import { pledgeCommand } from './pledges'
import { donorCommand } from './donors'
import { giftCommand } from './gifts'
import { correctReceipt } from './receipt-corrections'
import { ackCommand } from './acknowledgements'
import { appealCommand } from './appeals'
import { settingsCommand } from './settings'
import { letterTemplateCommand } from './letter-templates'
import { deliveryCommand } from './letter-delivery'
import { prepareStatements } from './year-end'

const STAFF: Role[] = ['owner', 'admin', 'member'], MANAGERS: Role[] = ['owner', 'admin'], PREPARERS: Role[] = ['owner', 'admin', 'agent']
// Who may run each command. Agents prepare letters and appeal audiences; a
// person approves, exports and records them. Members do data entry only.
export const ACCESS: Record<string, Role[]> = {
 'team.access':MANAGERS,
 'peer.noticePreview': MANAGERS, 'peer.sendNotice': MANAGERS,
 'report.save':MANAGERS,'report.import':MANAGERS,'report.share':MANAGERS,'report.revoke':MANAGERS,
 ...Object.fromEntries(AUCTION_COMMANDS.map(command=>[command,MANAGERS])),
 'marketing.topicMapping':MANAGERS, 'communication.preferences':MANAGERS, 'marketing.constantContactConnect':MANAGERS, 'marketing.constantContactSync':MANAGERS, 'marketing.constantContactDisconnect':MANAGERS, 'ack.sendPostal':MANAGERS,
 'singleLetter.prepare':MANAGERS, 'singleLetter.approve':MANAGERS,
 'calls.rank':MANAGERS, 'calls.policy':MANAGERS,
 'task.teamSave':['owner','admin'], 'task.create':STAFF, 'task.policy':MANAGERS, 'task.reminders':STAFF,
 'apiKey.create': MANAGERS, 'apiKey.revoke': MANAGERS,
 'webhook.subscribe': MANAGERS, 'webhook.pause': MANAGERS, 'webhook.replay': MANAGERS,
 'webhook.rotate': MANAGERS, 'webhook.retireOverlap': MANAGERS, 'webhook.recover': MANAGERS, 'webhook.resume': MANAGERS, 'webhook.migrateReplay': MANAGERS,
 'event.create': MANAGERS, 'event.ticket': MANAGERS, 'event.checkIn': MANAGERS, 'event.question': MANAGERS, 'event.matchGuest': MANAGERS,
 'reportSchedule.save': MANAGERS, 'reportSchedule.pause': MANAGERS, 'reportSchedule.resend': MANAGERS, 'reportSchedule.revokeRecipient': MANAGERS,
 'giving.protection': MANAGERS, 'giving.resume': MANAGERS,
 'giving.connectTwilio': MANAGERS, 'giving.keyword': MANAGERS,
 'contact.save': STAFF,
 'marketing.fields': MANAGERS, 'pledgeTemplate.save': MANAGERS, 'custom.renameChoice': MANAGERS, 'tag.category': MANAGERS, 'tag.define': MANAGERS, 'custom.define': MANAGERS, 'custom.set': MANAGERS, 'custom.clear': MANAGERS,
 'address.processing': MANAGERS, 'address.verify': STAFF, 'address.queueNcoa': MANAGERS,
 'contribution.record': STAFF, 'contribution.stockSale': STAFF,
 'giftRule.save': MANAGERS, 'giftRule.publish': MANAGERS, 'giftRule.pause': MANAGERS,
 'sms.registration.refresh': MANAGERS, 'sms.schedule': MANAGERS, 'sms.cancelSchedule': MANAGERS, 'sms.discard': MANAGERS, 'solicitation.set': STAFF, 'sms.preference': STAFF, 'sms.prepare': MANAGERS, 'sms.approve': MANAGERS, 'sms.send': MANAGERS,
 'giftBatch.create': STAFF, 'giftBatch.add': STAFF, 'giftBatch.edit': STAFF, 'giftBatch.close': STAFF,
 'list.tasks': MANAGERS,'list.welcome': MANAGERS,'list.profile': MANAGERS,'list.profileUndo': MANAGERS, 'list.restorePending': MANAGERS,'list.bulk': MANAGERS, 'list.undo': MANAGERS,
 'list.solicitation': MANAGERS, 'list.save': MANAGERS, 'person.defaultsPreview': MANAGERS, 'person.defaults': MANAGERS, 'organization.contact': STAFF, 'household.update': STAFF, 'household.confirmNames': STAFF, 'statusNotice.acknowledge': STAFF, 'household.defaultsPreview': MANAGERS, 'household.defaults': MANAGERS, 'donor.profile': STAFF,
 'meeting.question.set': STAFF, 'meeting.schedule': STAFF, 'meeting.cancel': STAFF,
 'calendar.configure': MANAGERS, 'calendar.start': STAFF, 'calendar.disconnect': STAFF, 'calendar.log': STAFF,
 'booking.configure': MANAGERS, 'booking.disconnect': MANAGERS, 'booking.link': STAFF, 'booking.revoke': STAFF,
 'tributeNotification.prepare': STAFF, 'tributeNotification.approve': MANAGERS, 'receiptTask.complete': STAFF, 'recognition.donor': STAFF, 'recognition.gift': STAFF,
 'research.connect': MANAGERS, 'research.screen': MANAGERS, 'research.disconnect': MANAGERS,
 'volunteer.record': STAFF, 'volunteer.import': STAFF,
 'taxReports.settings': MANAGERS,
 'inKind.review': MANAGERS, 'inKind.save': STAFF, 'inKind.dispose': STAFF, 'inKind.acknowledge': MANAGERS,
 'grant.save': STAFF, 'grant.status': STAFF, 'grant.attach': STAFF, 'grant.award': STAFF, 'grant.completeReport': STAFF, 'grant.assignReport': STAFF,
 'engagement.settings': MANAGERS, 'prospect.stages': MANAGERS, 'prospect.close': STAFF,
 'cultivation.template': STAFF, 'cultivation.apply': STAFF, 'cultivation.complete': STAFF, 'proposal.save': STAFF, 'proposal.attach': STAFF, 'proposal.sent': STAFF, 'proposal.response': STAFF,
 'portfolio.save': STAFF, 'portfolio.assign': STAFF,
 'planned.save': STAFF, 'planned.realize': STAFF, 'planned.unlink': STAFF, 'legacy.set': STAFF,
 'dashboard.goal': MANAGERS, 'fund.define': MANAGERS, 'fund.spend': MANAGERS, 'appealCode.define': MANAGERS,
 'task.repeatCreate': STAFF, 'task.repeatComplete': STAFF, 'task.generate': STAFF, 'task.assign': STAFF, 'task.snooze': STAFF, 'task.complete': STAFF, 'prospect.save': STAFF,
 'donor.create': STAFF, 'donor.update': STAFF, 'gift.record': STAFF, 'consent.record': STAFF, 'pledge.create': STAFF,
 'donor.merge': MANAGERS, 'donor.unmerge': MANAGERS, 'relationship.create': STAFF, 'relationship.remove': STAFF, 'interaction.record': STAFF,
 'gift.acknowledge': STAFF, 'gift.resetAcknowledgment': STAFF, 'gift.doNotAcknowledge': MANAGERS,
 'softCredit.acknowledge': STAFF, 'softCredit.resetAcknowledgment': STAFF, 'softCredit.doNotAcknowledge': MANAGERS,
 'softCredit.record': STAFF, 'softCredit.remove': STAFF, 'tribute.record': STAFF, 'match.record': STAFF, 'match.receive': STAFF,
 'pledge.remind': STAFF, 'pledge.match': STAFF, 'pledge.reduce': STAFF, 'pledge.writeOff': STAFF, 'pledge.linkPlan': STAFF, 'pledge.releaseEmail': MANAGERS,
 'gift.reverse': MANAGERS, 'gift.classify': MANAGERS, 'settings.update': MANAGERS, 'letterTemplate.save': MANAGERS, 'letterTemplate.retire': MANAGERS,
 'ack.correct': MANAGERS, 'ack.prepareStatements': MANAGERS, 'ack.send': MANAGERS, 'ack.checkDelivery': MANAGERS, 'ack.printed': MANAGERS, 'ack.prepare': PREPARERS, 'ack.approve': MANAGERS, 'ack.discard': MANAGERS, 'ack.export': MANAGERS, 'ack.markSent': MANAGERS,
 'marketing.sync': MANAGERS, 'marketing.connectMango': MANAGERS, 'marketing.connectMailchimp': MANAGERS, 'marketing.chooseAudience': MANAGERS, 'marketing.check': MANAGERS, 'marketing.disconnect': MANAGERS, 'marketing.refresh': MANAGERS, 'appeal.send': MANAGERS, 'journey.publish': MANAGERS, 'journey.run': MANAGERS, 'journey.stop': MANAGERS, 'journey.cap': MANAGERS, 'welcome.publish': MANAGERS, 'welcome.run': MANAGERS, 'reply.complete': STAFF, 'reply.proposeStop': STAFF, 'reply.confirmStop': STAFF, 'reply.reverseStop': STAFF,
 'appeal.prepare': [...PREPARERS,'member'], 'appeal.approve': MANAGERS, 'appeal.discard': MANAGERS, 'appeal.export': MANAGERS, 'appeal.markSent': MANAGERS,
 'agentGrant.legacyLimits': MANAGERS, 'agentGrant.disable': MANAGERS, 'agentGrant.save': MANAGERS, 'agentGrant.attach': MANAGERS, 'agentGrant.kill': MANAGERS,
 'agent.create': MANAGERS, 'agent.revoke': MANAGERS,
}

export async function execute(c: Context, command: string, input: unknown): Promise<Row> {
 if(c.actor.teamAccess?.readOnly)return readOnlyRefusal()
 if(c.actor.role==='agent' && c.actor.grant) return executeGranted(c,command,object(input))
 if(c.actor.preparationGrant&&['ack.prepare','appeal.prepare'].includes(command))await reservePreparationGrant(c,'prepare')
 const allowed = Object.hasOwn(ACCESS, command) ? ACCESS[command] : undefined
 if (!allowed) fail('COMMAND', 'Unknown Coffer command.', 400)
 requireRole(c.actor, allowed, `run ${command}`)
 const p = object(input)
 const teamResult=await teamAccessCommand(c,command,p);if(teamResult)return teamResult
 for (const key of ['donorId','employerDonorId','relatedDonorId']) if (typeof p[key] === 'string' && p[key] && await canonicalDonor(c,p[key]) !== p[key]) fail('MERGED_DONOR', 'This record was merged. Open the surviving donor record before saving.')
 if (['gift.acknowledge','gift.resetAcknowledgment','gift.doNotAcknowledge'].includes(command)) { const write=await giftAcknowledgmentWrite(c,command,p); await commit(c,write.statements); return write.result }
 if (command === 'ack.correct') return correctReceipt(c, p)
 if (command === 'ack.prepareStatements') return prepareStatements(c, p)
 if (command === 'donor.merge') return mergeDonor(c, p)
 if (command === 'donor.unmerge') return undoMerge(c, p)
 if(command==='calls.rank')return rankCalls(c,p)
 if(command==='calls.policy')return saveCallRankPolicy(c,p)
 if (command === 'settings.update') return settingsCommand(c, p)
 if(command.startsWith('calendar.'))return (await calendarCommand(c,command,p))!
 if(command.startsWith('booking.'))return (await bookingCommand(c,command,p))!
 if (command.startsWith('agentGrant.')) return (await agentGrantCommand(c,command,p))!
 if (command.startsWith('agent.')) return agentKey(c, command, p)
 for (const handler of [peerNoticeCommand,builderCommand,journeyCommand,preferenceCommand,postalCommand,singleLetterCommand,apiKeyCommand,auctionCommand,taskTeamCommand,webhookCommand,fundraisingEventCommand,reportScheduleCommand,protectionCommand,givingConnectionCommand,restorePendingCommand,profileFieldCommand,pledgeTemplateCommand,contactCommand,listTasksCommand,profileBulkCommand,bulkListCommand,customChoiceCommand,tagCommand,customFieldCommand,addressCommand, contributionTypeCommand, giftRulesCommand, solicitationCommand, smsRegistrationCommand, smsCommand, giftBatchCommand, savedListCommand, personDefaultsCommand, organizationContactCommand, householdCommand, statusCommand, meetingQuestionCommand, meetingCommand, tributeNotificationCommand, receiptTaskCommand, letterTemplateCommand, dashboardCommand, recognitionCommand, researchCommand, volunteerCommand, taxReportCommand, inKindCommand, grantCommand, engagementCommand, cultivationCommand, softCreditAckCommand, portfolioCommand, plannedGivingCommand, restrictedFundCommand, attributionCommand, recurringTaskCommand, marketingCommand, welcomeCommand, replyCommand, callTaskCommand, majorGiftCommand, donorCommand, donorDepthCommand, giftDepthCommand, pledgeCommand, giftCommand, deliveryCommand, ackCommand, appealCommand]) {
  const result = await handler(c, command, p)
  if (result !== undefined) {
   if(command==='consent.record' && p.channel==='email'){ const ids=Array.isArray(p.donorIds)?p.donorIds:[p.donorIds??p.donorId]; result.mango=await syncPreferences(c,ids) }
   if(['reply.confirmStop','reply.reverseStop'].includes(command)) result.mango=await syncPreferences(c,[result.donor_id])
   if(command==='gift.record'||command==='contribution.record')await runGiftRules(c.env!,result.id)
   if(command==='giftBatch.close')for(const giftId of result.giftIds)await runGiftRules(c.env!,giftId)
   return result
  }
 }
 return fail('COMMAND', 'Unknown Coffer command.', 400)
}

/** Preparation keys: shown once, stored as a hash, 30-day expiry, bound to
 * the creating person's current account version. */
async function agentKey(c: Context, command: string, p: Row) {
 if (command === 'agent.revoke') {
  const keyId = text(p.id, 'Key', 100)
  await commit(c, [sql('UPDATE cf_agent_keys SET revoked_at=? WHERE id=? AND revoked_at IS NULL', Date.now(), keyId), event(c, 'agent.revoke', 'agent', keyId, null)])
  return { revoked: true }
 }
 const label = text(p.label, 'Agent label', 100)
 const token = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
 const keyId = newId(), now = Date.now(), expiresAt = now + 30 * 86400000
 await commit(c, [sql('INSERT INTO cf_agent_keys(id,token_hash,label,created_by,creator_version,expires_at,revoked_at,created_at) SELECT ?,?,?,id,version,?,NULL,? FROM oa_operators WHERE id=?', keyId, await digest(token), label, expiresAt, now, c.actor.id), event(c, 'agent.create', 'agent', keyId, null, { expiresAt,grantId:'preparation:'+keyId,grantVersion:1 })])
 return { id: keyId, label, token, expiresAt }
}

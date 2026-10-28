import { letterHash } from './acknowledgements'
import { automaticGiftCurrent } from './automatic-receipt-queue'
import { commit, event, guard, one, sql, today, type Context, type Row } from './db'
import { tributeReceiptText } from './gift-depth'
import { receiptFundLabels } from './gift-splits'
import { giftTemplates, renderGiftLetter, templatesUnchanged } from './letter-templates'
import { letterRecipient } from './organizations'
import { withReceiptBenefits } from './receipt-rules'
import type { Settings } from './settings'

/** Persist the exact approved text before any provider call, including its number. */
export async function prepareAutomaticReceipt(c: Context, job: Row, s: Settings): Promise<Row | null> {
 const batchId=`receipt-${job.gift_id}`
 const prior=await one(c,'SELECT * FROM cf_acks WHERE id=?',batchId)
 if(prior)return prior
 const gift=await one(c,'SELECT g.* FROM cf_gift_balances g WHERE g.id=?',job.gift_id)
 if(!gift)return null
 const donor=await one(c,'SELECT * FROM cf_donors WHERE id=?',gift.donor_id)
 if(!donor?.email||donor.erased_at||donor.constituent_status==='inactive')return null
 const recipient=await letterRecipient(c,donor)
 await withReceiptBenefits(c,[gift]);await receiptFundLabels(c,[gift])
 const rendered=renderGiftLetter(s,gift,recipient,today(s.timezone,new Date(c.now)),(await giftTemplates(c,[gift])).get(gift.id))
 const tribute=await one(c,'SELECT * FROM cf_gift_tributes WHERE gift_id=?',gift.id)
 const letter={...rendered,id:batchId,batch_id:batchId,position:0,gift_id:gift.id,donor_id:gift.donor_id,recipient_name:recipient.letter_name,recipient_email:recipient.email,address:recipient.letter_address,
  body:[rendered.body,tributeReceiptText(tribute)].filter(Boolean).join('\n\n'),amount_cents:gift.amount_cents,received_on:gift.received_on}
 const hash=await letterHash(s.version,[letter]),blanks=JSON.parse(rendered.merge_blanks).length>0
 await commit(c,[guard(automaticGiftCurrent,'GIFT_CHANGED','The gift or recipient changed. Review this receipt in Letters.',gift.id),
  guard('EXISTS(SELECT 1 FROM cf_settings WHERE id=1 AND version=?)','SETTINGS_CHANGED','Receipt settings changed. Review this receipt.',job.settings_version),templatesUnchanged(job.template_revision),
  guard('NOT EXISTS(SELECT 1 FROM cf_acks WHERE gift_id=? AND live=1 AND id<>?)','ALREADY_ACKNOWLEDGED','This gift already has a receipt.',gift.id,batchId),
  sql(`INSERT OR IGNORE INTO cf_ack_batches(id,version,status,content_hash,letters,total_cents,settings_version,prepared_by_id,prepared_by_name,prepared_by_role,prepared_at)
   VALUES(?,1,?,?,1,?,?,?,?,?,?)`,batchId,blanks?'prepared':'approved',hash,gift.amount_cents,s.version,c.actor.id,c.actor.name,c.actor.role,c.now),
  sql(`INSERT OR IGNORE INTO cf_acks(id,batch_id,position,gift_id,donor_id,live,recipient_name,recipient_email,address,subject,body,amount_cents,received_on,template_kind,template_id,template_version,merge_blanks,receipt_organisation)
   VALUES(?,?,0,?,?,1,?,?,?,?,?,?,?,?,?,?,?,?)`,batchId,batchId,gift.id,gift.donor_id,letter.recipient_name,letter.recipient_email,letter.address,letter.subject,letter.body,gift.amount_cents,gift.received_on,rendered.template_kind,rendered.template_id,rendered.template_version,rendered.merge_blanks,s.organisation),
  ...(!blanks?[sql(`INSERT OR IGNORE INTO cf_approvals VALUES(?,'acknowledgements',?,?,?,?,?,?,?,?,?)`,`approval-${batchId}`,batchId,hash,c.actor.id,c.actor.name,c.actor.role,c.actor.id,c.actor.name,c.actor.role,c.now)]:[]),
  event(c,'receipt.automatic.prepare','acknowledgements',batchId,gift.donor_id,{source:job.source,settingsVersion:s.version})])
 return one(c,'SELECT * FROM cf_acks WHERE id=?',batchId)
}

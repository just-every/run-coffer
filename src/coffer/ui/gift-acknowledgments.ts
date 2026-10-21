import type { Row } from '../db'
import { SOFT_ACK_METHODS } from '../soft-credit-ack'
import { area, chip, e, field, form, longDay, money, select } from './common'

export function acknowledgmentStatus(gift: Row): string {
 const a=gift.acknowledgment??{status:'not acknowledged'}
 const label=a.status==='acknowledged'?'Acknowledged':a.status==='do not acknowledge'?'Do not acknowledge':'Not acknowledged'
 return `<p>${chip(label)}${a.acknowledged_on?` · ${longDay(a.acknowledged_on)}`:''}${a.method?` · ${e(a.method)}`:''}${a.delivery?` · ${e(a.delivery)}`:''}${a.outcome_unknown?' · <strong>thank-you outcome unknown</strong>':''}</p>${a.reason?`<p>${e(a.reason)}</p>`:''}${a.link?`<p>${a.link.href?`<a href="${e(a.link.href)}">Linked ${e(a.link.kind)}</a>`:`<a href="#timeline">Linked ${e(a.link.kind)}</a>${a.link.content?` · ${e(a.link.content)}`:''}`}</p>`:''}`
}

export function giftAcknowledgmentForms(gift: Row, day: string, boss: boolean, interactions: Row[]=[]): string {
 if(gift.kind!=='gift'||gift.reversed_by)return ''
 const a=gift.acknowledgment??{version:0,status:'not acknowledged'}
 const values={giftId:gift.id,version:a.version??0,returnDonorId:gift.donor_id}
 const conversations=interactions.filter(i=>i.occurred_on>=gift.received_on&&['call','meeting','email'].includes(i.kind))
 return `<details class="edit"><summary>Record gift thank-you</summary><p>Record a thank-you already given. This does not send a message.</p>${form('gift.acknowledge',field('Gift thank-you date','acknowledgedOn','date',day,`required min="${e(gift.received_on)}" max="${e(day)}"`)+select('Gift thank-you method','method',SOFT_ACK_METHODS)+area('Gift thank-you note','notes','','required maxlength="8000"'),'Record gift thank-you',values)}${conversations.length?`<details><summary>Link a recorded conversation</summary>${conversations.map(i=>form('gift.acknowledge',`<p>${longDay(i.occurred_on)} · ${e(i.kind)} · ${e(i.notes)}</p>`,'Link this thank-you conversation',{...values,interactionId:i.id,acknowledgedOn:i.occurred_on,method:i.kind==='call'?'phone call':i.kind==='meeting'?'in person':'email'})).join('')}</details>`:''}</details>${a.status!=='not acknowledged'||a.outcome_unknown?form('gift.resetAcknowledgment','','Mark gift not acknowledged',values,'secondary'):''}${boss?`<details class="edit"><summary>Do not acknowledge this gift</summary>${form('gift.doNotAcknowledge',field('Reason not to acknowledge gift','reason','text','','required maxlength="1000"'),'Save gift acknowledgment exclusion',values)}</details>`:''}`
}

export function timelineAcknowledgmentChoices(gifts: Row[]): string {
 return select('Gift thanked in this conversation (optional)','acknowledgeGift',[['','No gift acknowledgment'],...gifts.filter(g=>g.kind==='gift'&&!g.reversed_by).map(g=>[`${g.id}|${g.acknowledgment?.version??0}`,`${money(g.amount_cents)} · ${longDay(g.received_on)}`] as [string,string])])
}

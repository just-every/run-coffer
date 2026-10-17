import { integer, type Row } from '../db'
import { METHODS } from '../gifts'
import { area, box, e, field, form, money, select } from './common'

export function splitGiftForm(donorId: string, day: string, campaigns: Row[], countValue: string | null = null) {
 const count = countValue ? integer(Number(countValue), 'Number of parts', 2, 50) : 2
 const countForm = `<form method="get" action="/app/donors/${e(donorId)}#split-gift">${field('Number of parts', 'splitParts', 'number', count, 'required min="2" max="50"')}<button class="secondary">Change number of parts</button></form>`
 const parts = Array.from({length:count}, (_,i) => `<fieldset><legend>Part ${i+1}</legend><div class="fields">${field(`Fund ${i+1}`, 'splitFund', 'text', '', 'maxlength="100"')}${select(`Campaign ${i+1} (optional)`, 'splitCampaign', [['', 'Choose a fund instead'],...campaigns.map(c=>[c.id,c.name] as [string,string])])}${field(`Part ${i+1} amount (USD)`, 'splitAmount', 'text', '', 'required inputmode="decimal"')}</div></fieldset>`).join('')
 return box('Record a split gift', `<p>Record one payment and one receipt. Fill a fund for each part, or choose a campaign for every part. Campaigns use their own fund. The parts must add up exactly to the payment.</p>${countForm}${form('gift.record', `<div class="fields">${field('Payment amount (USD)', 'amount', 'text', '', 'required inputmode="decimal"')}${field('Split payment received on', 'receivedOn', 'date', day, 'required')}${select('Split payment method', 'method', METHODS)}${field('Split payment check number or reference', 'reference', 'text', '', 'maxlength="100"')}</div>${parts}<fieldset><legend>Did the donor receive goods or services for this payment?</legend><label><input type="radio" name="goods" value="none" required> No goods or services for split payment</label><label><input type="radio" name="goods" value="provided"> Goods or services for split payment</label><div class="fields">${field('Split payment goods value (USD)', 'goodsValue', 'text', '', 'inputmode="decimal"')}${field('Split payment goods description', 'goodsDescription', 'text')}</div></fieldset>${area('Split payment note', 'note', '', 'maxlength="1000"')}`, 'Record split gift', {donorId})}`, 'split-gift')
}

export function allocationLabel(parts: Row[]) {
 return parts.length ? `<ul class="list">${parts.map(a=>`<li>${money(a.amount_cents)} · ${e(a.fund)}${a.campaign ? ` · ${e(a.campaign)}` : ''}</li>`).join('')}</ul>` : ''
}

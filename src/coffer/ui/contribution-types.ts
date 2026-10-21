import type { Actor } from '../auth'
import { person } from '../auth'
import type { Row } from '../db'
import { box, chip, e, empty, field, form, longDay, money, select } from './common'

const amountField = (label: string, name: string) => field(label, name, 'text', '', 'required inputmode="decimal"')
const base = (day: string, label = 'Received on') => `<div class="fields">${field(label, 'receivedOn', 'date', day, 'required')}${field('Fund', 'fund', 'text', 'Unrestricted', 'required maxlength="100"')}</div>`
const paid = () => select('Payment method', 'method', ['check', 'bank transfer', 'other'], 'check')

/** The root donor page supplies its existing donor options and read authority. */
export function contributionTypesPanel(state: { monetary: Row[]; stocks: Row[] }, donor: Row, donors: Row[], actor: Actor, day: string) {
 const staff = person(actor), values = { donorId: donor.id, returnDonorId: donor.id }
 const options = donors.filter(d => d.id !== donor.id && !d.erased_at).map(d => [d.id, d.name] as [string, string])
 const stocks = state.stocks.map(g => `<li><h3>${e(g.shares)} shares of ${e(g.symbol)}</h3><p>${chip('Publicly traded securities')} · Transferred ${longDay(g.transfer_on)}</p>
  <p>Recorded market value: ${money(g.recorded_value_cents)}. High $${e((g.high_price_micros / 1000000).toFixed(6))} and low $${e((g.low_price_micros / 1000000).toFixed(6))} per share; the mean is multiplied by the shares and rounded once to cents. This recorded value requires accountant review.</p>
  <p>No monetary contribution is added. <a href="#in-kind-${e(g.in_kind_id)}">Property acknowledgment and history</a></p>
  ${g.sold_on ? `<p>Sold ${longDay(g.sold_on)} · Proceeds ${money(g.sale_proceeds_cents)}. Proceeds are recorded separately and do not add a second contribution.</p>` : staff ? `<details><summary>Record stock sale</summary>${form('contribution.stockSale', `${field('Sale date', 'soldOn', 'date', day, `required min="${e(g.transfer_on)}"`)}${amountField('Sale proceeds', 'saleProceeds')}<p>The sale freezes its date and proceeds and records the property as sold.</p>`, 'Record stock sale', { ...values, inKindId: g.in_kind_id, version: g.version })}</details>` : '<p>Stock held.</p>'}</li>`).join('')
 const monetary = state.monetary.map(g => `<li><strong>${g.kind === 'daf' ? 'DAF sponsor grant' : 'IRA qualified charitable distribution'}</strong> · ${longDay(g.received_on)} · ${money(g.amount_cents)}<p>Remaining contribution: ${money(g.net_cents)} · ${e(g.fund)}</p>
  ${g.kind === 'daf' ? `<p>Hard credit belongs to this sponsor. ${g.advisor_name ? `Advisor ${e(g.advisor_name)} receives separate soft credit.` : 'No current advisor credit is linked.'} The sponsor acknowledgment contains no deductibility language.</p>` : `<p>Custodian: ${e(g.custodian ?? 'Erased')}. The acknowledgment states that no goods or services were provided.</p>`}</li>`).join('')
 const stockEntry = form('contribution.record', `${base(day, 'Transfer date')}${field('Publicly traded security symbol', 'symbol', 'text', '', 'required maxlength="15"')}
  <div class="fields">${amountField('Shares (up to six decimal places)', 'shares')}${amountField('Transfer-day high price per share', 'highPrice')}${amountField('Transfer-day low price per share', 'lowPrice')}</div>
  ${select('Goods or services for stock gift', 'goods', [['none', 'No goods or services'], ['unknown', 'Not reviewed'], ['provided', 'Goods or services provided'], ['intangible religious benefits', 'Only intangible religious benefits']], 'none')}
  ${field('Goods or services description (when provided)', 'goodsDescription', 'text', '', 'maxlength="1000"')}${field('Good faith goods value (when provided)', 'goodsValue', 'text', '', 'inputmode="decimal"')}
  <p>The recorded value uses the transfer-day high/low mean. The acknowledgment describes the shares and assigns no dollar value.</p>`, 'Record stock gift', { ...values, kind: 'stock' })
 const dafEntry = donor.constituent_kind === 'organization' ? form('contribution.record', `${base(day)}${amountField('DAF grant amount', 'amount')}${paid()}${select('Advisor receiving soft credit', 'advisorDonorId', options, '', 'required')}<p>This organization receives the hard credit; the advisor receives recognition only. The acknowledgment makes no claim of deductibility.</p>`, 'Record DAF grant', { ...values, kind: 'daf', goods: 'none' }) : '<p>Record a DAF grant on the sponsor’s organization record, then select the advisor for separate soft credit.</p>'
 const qcdEntry = form('contribution.record', `${base(day)}${amountField('IRA distribution amount', 'amount')}${paid()}${field('IRA custodian', 'custodian', 'text', '', 'required maxlength="200"')}<p>Record an IRA qualified charitable distribution received without goods or services. This records the donor’s classification for review.</p>`, 'Record IRA distribution', { ...values, kind: 'qcd', goods: 'none' })
 return box('Stock, DAF and IRA contributions', `${stocks ? `<ul class="list">${stocks}</ul>` : ''}${monetary ? `<ul class="list">${monetary}</ul>` : ''}${!stocks && !monetary ? empty('No stock, DAF or IRA contributions recorded.') : ''}
  ${staff ? `<details><summary>Record publicly traded stock</summary>${stockEntry}</details><details><summary>Record a DAF sponsor grant</summary>${dafEntry}</details><details><summary>Record an IRA distribution</summary>${qcdEntry}</details>` : ''}`, 'contribution-types')
}

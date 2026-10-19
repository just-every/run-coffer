import type { Context } from '../db'
import { manager } from '../auth'
import { restrictionLabel, restrictionReport } from '../restricted-funds'
import { area, box, e, empty, field, form, longDay, money, select } from './common'

export async function restrictedFundsPage(c: Context, url: URL) {
 const report = await restrictionReport(c, url)
 const rows = report.funds.map(f => `<tr><td class="lead">${e(f.fund)}<br><small>${e(restrictionLabel(f))}</small></td><td data-label="Given">${money(f.given_cents)}</td><td data-label="Spent">${money(f.spent_cents)}</td><td data-label="Released">${money(f.released_cents)}</td><td data-label="Still held">${money(f.held_cents)}</td></tr>`).join('')
 const reportBox = box('Release of restrictions', `<p><a href="/app/funds">Back to giving by fund</a></p><form method="get">${field('Through','through','date',report.through)}<button>Read report</button></form><p>Given includes refunds and reversals. Purpose restrictions release as spending is recorded. Time restrictions release the remaining balance on their release date. Undefined funds are unrestricted.</p>${rows ? `<table class="stack"><thead><tr><th>Fund · restriction</th><th>Given</th><th>Spent</th><th>Released</th><th>Still held</th></tr></thead><tbody>${rows}</tbody></table>` : empty('No funds yet.')}`)
 const spending = box('Recorded spending', report.spends.length ? `<ul class="list">${report.spends.map(s => `<li>${e(s.fund)} · ${money(s.amount_cents)} · ${longDay(s.spent_on)}<br>${e(s.reference)} · ${e(s.note)}</li>`).join('')}</ul>` : empty('No spending recorded.'))
 if (!manager(c.actor)) return reportBox + spending
 const define = box('Define a fund', `<p>Use the same fund name when recording gifts, imports and campaigns. Definitions are permanent so accounting history keeps its restriction. Funds already submitted to accounting cannot be reclassified.</p>${form('fund.define', `${field('Fund name','name','text','','required maxlength="100"')}${select('Restriction','restriction',[['unrestricted','Unrestricted'],['purpose','Purpose restricted'],['time','Time restricted']])}${area('Restriction details','detail','','maxlength="300"')}${field('Release on (time restrictions)','releaseOn','date')}`, 'Define fund')}`)
 const restricted = report.funds.filter(f => f.restriction !== 'unrestricted')
 const spend = restricted.length ? box('Record restricted spending', form('fund.spend', `${select('Fund','fund',restricted.map(f => [f.fund,f.fund]))}${field('Spend amount (USD)','amount','number','','required min="0.01" step="0.01"')}${field('Spent on','spentOn','date',report.through,'required')}${field('Accounting reference','reference','text','','required maxlength="100"')}${area('Spend description','note','','required maxlength="500"')}`, 'Record spend')) : ''
 return reportBox + define + spend + spending
}

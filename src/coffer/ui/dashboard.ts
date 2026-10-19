import type { Context, Row } from '../db'
import { manager } from '../auth'
import { dashboardReport, dashboardHref, dashboardEntryHref } from '../dashboard'
import { dashboardEntries } from '../dashboard-ledger'
import { DASHBOARD_DIMENSIONS } from '../dashboard-goals'
import { box, e, empty, field, form, hidden, longDay, money, select } from './common'

const link=(href:string,value:unknown)=>`<a href="${e(href)}">${e(value)}</a>`
export async function dashboardPage(c: Context,url: URL) {
 if(url.searchParams.get('view')==='entries')return dashboardEntriesPage(c,url)
 const r=await dashboardReport(c,url), goalHref=dashboardHref(r.year)+'#goals', retentionHref=`/app/retention?basis=fiscal&year=${r.year}`
 const filter=`<form method="get" action="/app/reports/dashboard"><div class="fields">${field('Fiscal start year','year','number',r.year,'required min="1000" max="9998"')}</div><button>View dashboard</button></form>`
 const stats=`<div class="stats"><a class="stat" href="${e(r.summary.href)}"><strong>${money(r.summary.currentCents)}</strong><span>Raised this fiscal year</span></a><a class="stat" href="${e(r.summary.priorHref)}"><strong>${money(r.summary.priorCents)}</strong><span>Full prior fiscal year</span></a><a class="stat" href="${e(goalHref)}"><strong>${r.summary.goal?money(r.summary.goal.amount_cents):'Not set'}</strong><span>Explicit fiscal goal</span></a></div>`
 const tables=DASHBOARD_DIMENSIONS.filter(d=>d!=='organization').map(d=>{
  const rows=r.dimensions[d].map(row=>`<tr><td class="lead">${e(row.label)}</td><td data-label="Raised">${link(row.href,money(row.currentCents))}</td><td data-label="Full prior year">${link(row.priorHref,money(row.priorCents))}</td><td data-label="Goal">${link(goalHref,row.goal?money(row.goal.amount_cents):'Not set')}</td></tr>`).join('')
  return box(`By ${d}`,rows?`<div class="scroll"><table class="stack"><thead><tr><th>${e(d)}</th><th>Raised</th><th>Full prior year</th><th>Goal</th></tr></thead><tbody>${rows}</tbody></table></div>`:empty('No ledger entries or goals in these years.'),`dashboard-${d}`)
 }).join('')
 const newGroup=r.cohorts.groups.new, retained=r.cohorts.groups.retained, rate=r.cohorts.totals.retentionRate
 const donors=box('Donors and retention',`<p>${link(retentionHref+'#new',newGroup.count)} new donors · ${link(dashboardEntryHref(r.year,'organization','','current','new'),money(newGroup.currentCents))} received. ${link(retentionHref+'#retained',retained.count)} retained donors · ${link(retentionHref,rate===null?'No prior donors':`${(rate*100).toFixed(1)}% retention`)}.</p><p>${link(dashboardEntryHref(r.year,'organization','','current','retained'),'Open retained donors’ ledger entries')}. Cohorts use signed net giving in the full prior fiscal year and the selected current period. Anonymous ledger facts remain in received money, outside donor counts.</p>`)
 const healthHref=`/app/giving/health?from=${r.recurring.from}&through=${r.recurring.through}`
 const sourceHref=(month:string)=>dashboardHref(r.year,{planMonth:month})+'#plans-'+month
 const healthRows=r.recurring.rows.map(m=>`<tr><td class="lead">${e(m.month)}</td><td data-label="Monthly commitment">${link(sourceHref(m.month),money(m.mrrCents))}</td><td data-label="Active donors">${link(sourceHref(m.month),m.activeDonors)}</td><td data-label="Received">${link(dashboardEntryHref(r.year,'month',m.month.slice(5)),money(r.dimensions.month.find(x=>x.key===m.month.slice(5))!.currentCents))}</td></tr>`).join('')
 const recurring=box('Recurring revenue',`<p>Monthly committed USD at month end, or today for this month. Commitments open their plan history report; they are separate from received money. Unknown legacy history is excluded and disclosed in that report.</p><div class="scroll"><table class="stack"><thead><tr><th>Month</th><th>Monthly commitment</th><th>Active donors</th><th>All received money</th></tr></thead><tbody>${healthRows}</tbody></table></div>`,'dashboard-recurring')
 const pipeline=box('Pipeline now',`<p>${link('/app/pipeline',money(r.pipeline.totals.forecastCents))} probability-weighted open commitments · ${link('/app/pipeline',r.pipeline.totals.open)} open opportunities. ${link('/app/pipeline',money(r.pipeline.totals.expectedCents))} expected before probability weighting.</p><p>Current recorded opportunities as of ${longDay(r.asOf)}, independent of the selected historical fiscal year. Open the pipeline for its actual opportunity sources; commitments are never added to received gifts.</p>`)
 const sources=box('Recurring plan sources',`<p>${link(healthHref,'Full recurring health report')}. These are the recorded plan states supporting each month’s committed revenue.</p>`+r.recurringSources.map(month=>`<details id="plans-${e(month.month)}"${url.searchParams.get('planMonth')===month.month?' open':''}><summary>${e(month.month)}</summary>${month.plans.length?`<ul class="list">${month.plans.map(plan=>`<li><code>${e(plan.subscription_id)}</code> · ${plan.donor_id?link('/app/donors/'+plan.donor_id,plan.donor_name):'Unidentified donor'} · ${e(plan.status)} · ${money(plan.amount_cents)} monthly · observed ${longDay(plan.observed_at)}</li>`).join('')}</ul>`:empty('No recorded active plans for this month.')}</details>`).join(''))
 const goals=goalSection(c,r)
 return box('Fundraising dashboard',`<p>Fiscal ${r.year}: ${longDay(r.current.from)} to ${longDay(r.current.through)}${r.current.provisional?' · year to date':''}. ${e(r.timezone)}. Compared with the full prior fiscal year, ${longDay(r.prior.from)} to ${longDay(r.prior.through)}. Signed received contributions include refunds and reversals on their entry dates; fees and soft credits are separate.</p>${filter}${stats}`)+donors+recurring+pipeline+tables+sources+goals
}

function goalSection(c:Context,r:Awaited<ReturnType<typeof dashboardReport>>) {
 const rows=r.goals.map(g=>`<li>${e(g.dimension)} · ${e(r.dimensions[g.dimension as keyof typeof r.dimensions].find(x=>x.key===g.dimension_key)?.label||'Organization')}: ${money(g.amount_cents)} · saved ${longDay(g.updated_at)}</li>`).join('')
 const targets: [string,string,string][] = [['organization','','Organization'],
  ...r.options.funds.map(x=>['fund',x.name,'Fund · '+x.name] as [string,string,string]),
  ...r.options.campaigns.flatMap(x=>[['campaign',x.id,'Campaign · '+x.name],['form',x.id,'Giving form · '+x.name]] as [string,string,string][]),
  ...r.options.appeals.map(x=>['appeal',x.code,'Appeal · '+x.name] as [string,string,string]),
  ...['form','event','mail','email','text'].map(x=>['channel',x,'Channel · '+x] as [string,string,string]),
  ...r.dimensions.month.map(x=>['month',x.key,'Month · '+x.label] as [string,string,string])]
 const options: [string,string][] = targets.map(([dimension,key,label])=>[JSON.stringify({dimension,key,version:r.goals.find(g=>g.dimension===dimension&&g.dimension_key===key)?.version??0}),label])
 const editor=manager(c.actor)?form('dashboard.goal',`<div class="fields">${select('Goal to set','goalTarget',options)}${field('Goal amount (USD)','amount','text','','required inputmode="decimal"')}</div>`, 'Save fiscal goal',{year:r.year,fiscalStart:r.fiscalStart}):''
 return box('Recorded fiscal goals',`<p>Goals belong to fiscal ${r.year}, starting ${e(r.fiscalStart)}. Each is explicit and independent; no organization, monthly or dimensional goal is inferred from another.</p>${rows?`<ul class="list">${rows}</ul>`:empty('No fiscal goals recorded.')}${editor}`,'goals')
}

export async function dashboardEntriesPage(c: Context,url: URL) {
 const r=await dashboardEntries(c,url), href=(page:number)=>{const q=new URLSearchParams(url.searchParams);q.set('page',String(page));return '/app/reports/dashboard?'+q}
 const rows=r.entries.map((row:Row)=>`<tr><td class="lead">${row.donor_id?link('/app/donors/'+row.donor_id,row.donor_name):'Unidentified donor'}<br>${longDay(row.received_on)}</td><td data-label="Fund">${e(row.fund)}</td><td data-label="Campaign">${e(row.campaign_name||'No campaign')}</td><td data-label="Contribution">${money(row.amount_cents)}</td><td data-label="Gift">${e(row.gift_id)}<br>${e(row.kind)}</td></tr>`).join('')
 return box('Dashboard ledger entries',`<p>${link(dashboardHref(r.year),'Back to dashboard')} · Fiscal ${r.year}, ${e(r.period)} period · ${e(r.dimension)} ${e(r.key||'all / unassigned')}.</p><p>${money(r.totalCents)} across ${r.count} signed allocation entries. A split payment appears only for its matching part; refunds and reversals subtract on their entry dates.</p>${rows?`<div class="scroll"><table class="stack"><thead><tr><th>Donor · date</th><th>Fund</th><th>Campaign</th><th>Contribution</th><th>Gift</th></tr></thead><tbody>${rows}</tbody></table></div>`:empty('No ledger entries match.')}<p>${r.page?link(href(r.page-1),'Previous'):''} ${r.more?link(href(r.page+1),'Next'):''}</p>`,'dashboard-entries')
}

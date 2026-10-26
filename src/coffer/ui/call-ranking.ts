import { callRanking } from '../call-ranking'
import { callOutcomes } from '../call-outcomes'
import { taskOwners } from '../call-tasks'
import type { Context } from '../db'
import { box, chip, e, empty, hidden, longDay, select } from './common'

const percent=(value:number|null)=>value===null?'Pending':new Intl.NumberFormat('en-US',{style:'percent',maximumFractionDigits:1}).format(value)
export async function callRankingPage(c:Context,url:URL){
 const managerId=url.searchParams.get('managerId')??c.actor.id
 const [state,people]=await Promise.all([callRanking(c,managerId,url.searchParams.get('runId')??undefined),taskOwners(c)])
 const choose=`<form method="get">${select('Relationship manager','managerId',people.map(p=>[p.id,p.name] as [string,string]),managerId,'aria-label="Relationship manager"')}<button>Open weekly list</button></form>`
 const run=`<form method="post" action="/app/agent/calls/run">${hidden('managerId',managerId)}<button>Rank this week’s calls</button></form>`
 const history=state.runs.length?`<details><summary>Earlier weekly lists</summary><ul class="list">${state.runs.map(r=>`<li><a href="/app/agent/calls?managerId=${e(r.manager_id)}&runId=${e(r.id)}">Week of ${longDay(r.week_on)}</a></li>`).join('')}</ul></details>`:''
 const entry=(row:any)=>`<li><strong><a href="/app/donors/${e(row.donor_id)}">${e(row.donor_name)}</a></strong> ${chip(row.is_ask?'Ask call':'Thank-you only')}<p>Priority ${row.rank_num} · ${e(row.reason)}</p>${row.task_id?`<a href="/app/calls?owner=${e(managerId)}&status=all">Open assigned call</a>`:''}</li>`
 const ranked=state.run?box(`Week of ${longDay(state.run.week_on)}`,`<p>${state.entries.filter(r=>r.state==='task').length} assigned · Capacity ${state.run.capacity}</p><ul class="list">${state.entries.filter(r=>r.state==='task').map(entry).join('')}</ul>${state.overflow.length?`<details open><summary>Overflow (${state.overflow.length})</summary><ul class="list">${state.overflow.map(entry).join('')}</ul></details>`:empty('No overflow.')}<p>${Object.entries(state.excluded).map(([reason,count])=>`${e(reason)}: ${count}`).join(' · ')}</p>`):empty('Rank this week to prepare the manager’s explained call list.')
 let outcomes=''
 if(state.run){
  const data=await callOutcomes(c,state.run.id)
  const group=(name:string,g:any)=>`<p><strong>${name}: ${percent(g.rate)}</strong> · ${g.retained??'Pending'} retained of ${g.priorDonors} prior-year donors (${g.count} listed).</p>`
  outcomes=box('Giving after calls',`<p>${data.fiscalClosed?'Fiscal year closed':'Retention pending fiscal year close'} · Giving window ${data.run.window_days} days.</p>${group('Called',data.called)}${group('Listed without a call',data.uncalled)}<div class="scroll"><table class="stack"><thead><tr><th>Constituent</th><th>Call made</th><th>Gift within window</th><th>Retained</th></tr></thead><tbody>${data.rows.filter(r=>r.available).map(r=>`<tr><td class="lead"><a href="${e(r.evidence.donor)}">${e(r.name)}</a></td><td data-label="Call made">${r.called?`<a href="${e(r.evidence.call)}">${longDay(r.calledOn)}</a>`:'Not called'}</td><td data-label="Gift within window">${r.gaveWithinWindow===true?`<a href="${e(r.evidence.gifts)}">Yes</a>`:r.gaveWithinWindow===false?'No':r.called?'Window open':'No call logged'}</td><td data-label="Retained">${r.retained===null?'Pending fiscal close':r.priorDonor?r.retained?'Yes':'No':'Not a prior-year donor'}</td></tr>`).join('')}</tbody></table></div><details><summary>How outcomes are measured</summary><p>${e(data.definition.retention)}</p><p>${e(data.definition.denominator)}</p><p>${e(data.definition.giftWindow)}</p><p>${e(data.definition.comparison)}</p><a href="/app/retention?basis=fiscal&year=${data.run.fiscal_year}">Open retention report</a></details>`,'call-outcomes')
 }
 return `<p>Prepare the manager’s weekly calls, keep overflow visible, and follow the recorded outcomes.</p>${choose}${run}${history}${ranked}${outcomes}<details><summary>How priorities work</summary><p>Priorities use recorded lapse risk, increases in giving, giving anniversaries, unanswered donor replies, overdue installments and time since meaningful contact. Restricted constituents receive thank-you calls only. Inactive people and withdrawn phone permission stay off the list.</p><p><a href="/app/settings#call-priorities">Call capacity and outcome settings</a></p></details>`
}

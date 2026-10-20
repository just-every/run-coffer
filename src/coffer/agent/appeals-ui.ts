import type { Context } from '../db'
import { box, chip, e, empty, hidden, money, when } from '../ui/common'
import { settings } from '../settings'
import { appealDelivery, deliveryState } from './appeals'

export async function appealAgentPage(c:Context,url:URL) {
 const tz=(await settings(c)).timezone,state=await deliveryState(c),selected=url.searchParams.get('appealId')
 const list=box('Approved appeals',state.appeals.length?`<ul class="list">${state.appeals.map(a=>`<li><a href="/app/agent/appeals?appealId=${e(a.id)}">${e(a.name)}</a> · ${a.recipients} recipients</li>`).join('')}</ul>`:empty('No approved email appeals yet.'))
 const intro='<p>Compare each frozen recipient with sender results and gifts entered with the appeal response code. Handoff is not delivery. Unknown submissions need provider review before a resend.</p>'
 let detail=''
 if(selected){
  const r=await appealDelivery(c,selected)
  const rows=r.rows.map(d=>`<li><a href="/app/donors/${e(d.donorId)}">${e(d.name)}</a> ${chip(d.state)}<p>${e(d.email)} · ${d.checkedAt?'Checked '+when(d.checkedAt,tz):'Not checked'}</p></li>`).join('')
  detail=box(r.appeal.name,`<p>${r.flagged} recipients need review. ${r.deliveryComplete?'Every delivery is confirmed.':'Delivery is incomplete or unconfirmed.'}</p>
  <form method="post" action="/app/agent/appeals/run">${hidden('appealId',selected)}<button>Check sender results</button></form>
  <ul class="list">${rows}</ul>${r.results.bound?`<p>${r.results.responded} donor${r.results.responded===1?'':'s'} responded · ${r.results.gifts} net-positive gift${r.results.gifts===1?'':'s'} · ${money(r.results.dollarsCents!)} net. <a href="/app/appeals/${e(selected)}">Source report and response code</a></p>`:'<p>Gift responses unknown: this historical appeal has no response-code binding.</p>'}
  ${r.resend?`<p><a href="/app/appeals/${e(r.resend.id)}">Review resend (${e(r.resend.status)})</a></p>`:r.rows.some(d=>d.resend)?`<form method="post" action="/app/agent/appeals/prepare">${hidden('appealId',selected)}<p>Prepare only confirmed unsent or bounced recipients with current email permission. Review and approve the new audience before sending.</p><button>Prepare resend for approval</button></form>`:'<p>No confirmed unsent or bounced recipients available for resend.</p>'}`)
 }
 return intro+list+detail+box('Journey results',state.journey.length?`<ul class="list">${state.journey.map(s=>`<li><a href="/app/donors/${e(s.donor_id)}">${e(s.name)}</a> · ${e(s.step)} ${chip(s.state)}<p>${e(s.responses)}</p><p>${s.checked_at?'Checked '+when(s.checked_at,tz):'Not checked'}</p>
 <form method="post" action="/app/agent/appeals/journey/run">${hidden('stepId',s.id)}<button>Check journey sender results</button></form>
 ${s.resendProposal?`<p><a href="/app/appeals/${e(s.resendProposal.id)}">Review journey resend (${e(s.resendProposal.status)})</a></p>`:s.resend?`<form method="post" action="/app/agent/appeals/journey/prepare">${hidden('stepId',s.id)}<p>Prepare this saved message for review with current email permission. A person must approve the new audience before sending.</p><button>Prepare journey resend for approval</button></form>`:''}</li>`).join('')}</ul>`:empty('No submitted journey steps.'))
}

import { auditChoices, auditLog } from '../audit'
import { actionWords, recordWords, roleWords } from '../action-words'
import { all, type Context } from '../db'
import { box, details, e, empty, field, form, moment, select } from './common'

export async function auditPage(c: Context, url: URL) {
 const [log, choices] = await Promise.all([auditLog(c,url),auditChoices(c)])
 const value = (key: string) => url.searchParams.get(key) ?? ''
 const mergeIds = log.rows.filter(r=>r.action==='donor.merge').map(r=>JSON.parse(r.detail).mergeId).filter(Boolean)
 const merges = mergeIds.length ? await all(c,'SELECT id,status FROM cf_donor_merge_journal WHERE id IN (SELECT value FROM json_each(?))',JSON.stringify(mergeIds)) : []
 const undo = (row: typeof log.rows[number]) => {
  if(row.action!=='donor.merge')return ''
  const mergeId=JSON.parse(row.detail).mergeId,state=merges.find(m=>m.id===mergeId)?.status
  return state==='active' ? form('donor.unmerge','<p class="muted">Undo restores the two histories only while their records remain unchanged.</p>','Undo merge',{mergeId}) : state ? `<p class="muted">${state==='undone'?'Merge undone.':'Undo unavailable after erasure.'}</p>` : ''
 }
 const query = new URLSearchParams(url.searchParams); query.delete('page')
 const pagination = (page: number) => { const q = new URLSearchParams(query); q.set('page',String(page)); return '/app/audit?'+e(q.toString()) }
 const filters = `<form method="get" action="/app/audit"><div class="fields">${select('Person','person',[['','Everyone'],...choices.people.map(p=>[p.id,p.name] as [string,string])],value('person'))}${select('Action','action',[['','All actions'],...choices.actions.map(a=>[a.action,actionWords(a.action)] as [string,string]).sort((a,b)=>a[1].localeCompare(b[1]))],value('action'))}${field('Record or donor ID','record','text',value('record'))}${field('From','from','date',value('from'))}${field('To','to','date',value('to'))}</div><button>Filter log</button> <a href="/app/audit">Clear filters</a></form>`
 const rows = log.rows.map(r=>`<tr><td class="lead">${e(moment(r.at,'UTC'))} UTC<br><span class="muted">${e(r.id)}</span></td><td data-label="Person">${e(r.actor_name)}<br><span class="muted">${e(roleWords(r))}</span></td><td data-label="Action">${e(actionWords(r.action))}</td><td data-label="Record"><span>${e(recordWords(r.subject_kind))}</span><br><code>${e(r.subject_id)}</code>${r.donor_id ? `<br><a href="/app/donors/${e(r.donor_id)}">Open donor</a>` : ''}${details(JSON.parse(r.detail))}${undo(r)}</td></tr>`).join('')
 return `<p>Changes, approvals, downloads, sign-ins and agent actions across your installation. Times are UTC, as the filters and CSV use them.</p>${box('Find activity',filters)}${box(`${log.total} events`, `<p><a href="/app/audit.csv?${e(query.toString())}">Download filtered CSV</a></p>${rows ? `<div class="scroll"><table class="stack"><thead><tr><th>When</th><th>Person</th><th>Action</th><th>Record</th></tr></thead><tbody>${rows}</tbody></table></div>` : empty('No activity matches these filters.')}<p class="paging">${log.page > 0 ? `<a href="${pagination(log.page-1)}">Previous</a>` : ''}${log.more ? `<a href="${pagination(log.page+1)}">Next</a>` : ''}</p>`)}`
}

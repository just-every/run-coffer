import { fail, type Context, type Row } from '../db'
import { box, chip, e, empty, hidden, money } from '../ui/common'
import { migrationSource, migrationState } from './move-in'

const label=(key:string)=>key.replaceAll('_',' ').replace(/([a-z])([A-Z])/g,'$1 $2').replace(/^./,c=>c.toUpperCase())
function facts(value:unknown):string {
 if(value===null||value===undefined)return '<span>Unknown</span>'
 if(typeof value==='boolean')return value?'Yes':'No'
 if(Array.isArray(value))return value.length?'<ul class="list">'+value.map(v=>'<li>'+facts(v)+'</li>').join('')+'</ul>':'None'
 if(typeof value==='object')return '<dl>'+Object.entries(value).map(([k,v])=>'<dt>'+e(label(k))+'</dt><dd>'+(/(?:_cents|Cents|^cents)$/.test(k)&&typeof v==='number'?e(money(v)):facts(v))+'</dd>').join('')+'</dl>'
 return e(value)
}
const total=(row:Row,side:string)=>`${row[side+'Count']??'Unknown'} ${row.scope==='restriction'?'records':'gifts'}${row.scope==='restriction'?'':row[side+'Cents']===null?' · amount unknown':' · '+money(row[side+'Cents'])}`
const reconciliation=(rows:Row[])=>rows.map(r=>`<p><strong>${e(r.key||'Unspecified fund')}</strong>: source ${e(total(r,'source'))}; current ${e(total(r,'coffer'))} · ${r.matches?'Matches':'Review difference'}</p>`).join('')

export async function migrationSourcePage(c:Context,url:URL) {
 const source=await migrationSource(c,Object.fromEntries(url.searchParams)),requested=url.searchParams.get('record')
 const index=requested===null?null:Number(requested)
 if(index!==null&&(!Number.isSafeInteger(index)||index<0||!source.records[index]))fail('NOT_FOUND','That reviewed source record does not exist.',404)
 const selected=index===null?[]:[source.records[index]]
 return `<p><a href="/app/agent/move-in">Back to migration comparison</a></p><p>These facts come from the reviewed ${e(source.source)} import. Unknown source facts grant no permission. Current donor choices are read separately.</p>${box('Source reconciliation',reconciliation(source.money.rows))}${selected.map(r=>box('Reviewed '+label(r.kind),facts(r.fact))).join('')}`
}

export async function migrationPage(c:Context,url:URL) {
 const state=await migrationState(c,{analysisId:url.searchParams.get('analysisId')}),a=state.analysis
 const imports=state.imports.map(j=>box(j.source+' import',`<p>${chip(j.state)} · <a href="${j.kind==='crm'?'/app/move-in/crm':'/app/move-in'}/journal?id=${e(j.id)}">Open import journal</a></p>${j.state==='completed'&&!j.redacted?`<form method="post" action="/app/agent/move-in/run">${hidden('kind',j.kind)}${hidden('jobId',j.id)}${hidden('version',state.version)}<button>Compare this import</button></form>`:'<p>Finish the import before comparison. Undone or erased evidence cannot be analyzed.</p>'}`)).join('')
 const result=!a?'':a.status!=='current'?box('Comparison is stale','<p>Source or native records changed. Run a new comparison before using findings. Earlier private facts are withheld.</p>'):box('Current comparison',`<p>${chip('Preparation only','info')} This compares the selected import. It does not complete cutover or authorize any correction, transfer, message or charge.</p>${reconciliation(a.money.rows.filter((r:Row)=>r.scope==='all'))}<details><summary>Year, fund and preference totals</summary>${reconciliation(a.money.rows.filter((r:Row)=>r.scope!=='all'))}</details>${a.findings.length?a.findings.map((f:Row)=>box(f.summary,`<p>${f.excludedFromRecovery?'Excluded from recovery. ':''}${f.kind==='duplicate_identity'?'A person must compare these identities.':''}</p><details><summary>Reviewed source facts</summary>${facts(f.source)}</details><details><summary>Current native facts</summary>${facts(f.native)}</details><ul class="list">${f.citations.map((s:Row)=>`<li><a href="${e(s.page??s.href)}">${e(s.label)}</a></li>`).join('')}</ul>`)).join(''):empty('No differences found in the compared facts. Transfer coverage and cutover remain unproved.')}`)
 return `<p>Compare finished Stripe and CRM imports with current records. Unknown source facts remain unknown, and newer native preferences remain separate. Findings change no records.</p>${result}${imports||empty('No source imports yet.')}`
}

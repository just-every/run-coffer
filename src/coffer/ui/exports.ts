import { requireRole } from '../auth'
import { today, type Context } from '../db'
import { EXPORT_TYPES, exportSnapshot, exportType } from '../exports'
import { savedLists } from '../saved-lists'
import { RELATIONSHIP_TYPES, RELATIONSHIP_LABELS } from '../donor-depth'
import { box, e, field, form, select } from './common'

const label = (value: string) => value.charAt(0).toUpperCase()+value.slice(1)
export async function exportsPage(c: Context, url: URL, error = '') {
 requireRole(c.actor,['owner','admin'],'export donor records')
 const type=exportType(url.searchParams.get('type')||'constituents')
 const [lists,snapshot]=await Promise.all([savedLists(c),exportSnapshot(c,type,url)])
 const m=snapshot.metadata,value=(key:string)=>url.searchParams.get(key)||''
 const list=value('list')||'search',query=new URLSearchParams(url.searchParams)
 query.delete('type')
 const download=`/api/coffer/exports/${type}.csv?${query.toString()}`
 const filters=`${field('Search name, email or household','q','search',value('q'),'maxlength="100"')}
  ${select('Relationship','relationship',[['','Any relationship'],...RELATIONSHIP_TYPES.map(t=>[t,RELATIONSHIP_LABELS[t].outgoing] as [string,string])],value('relationship'))}
  ${field('Connected donor ID','relatedTo','text',value('relatedTo'),'maxlength="100"')}
  ${select('Volunteers','volunteer',[['','All constituents'],['all','All volunteers'],['never-given','Volunteers who have never given']],value('volunteer'))}`
 const save=list==='search'?box('Save this search',form('list.save',`${field('List name','name','text','','required maxlength="100"')}<p>The saved search stays current. It includes active constituents.</p>`,'Save live list',Object.fromEntries(['q','relationship','relatedTo','volunteer'].map(k=>[k,value(k)])))):''
 return `<p><a href="/app/donors">Donors</a></p><p>Download one record type for everyone in a current list. Each file includes their records across all dates.</p>
 ${error?`<p role="alert">${e(error)}</p>`:''}
 ${box('Choose an export',`<form method="get" action="/app/exports"><div class="fields">
  ${select('List','list',[['search','Current donor search'],['lybunt','LYBUNT'],['sybunt','SYBUNT'],...lists.map(l=>[`saved:${l.id}`,l.name] as [string,string])],list)}
  ${select('Record type','type',EXPORT_TYPES.map(t=>[t,label(t)] as [string,string]),type)}
  ${field('Annual list calendar year','year','number',value('year')||today(m.timezone,new Date(m.asOf)).slice(0,4),'min="1900"')}
  ${list==='search'||list==='lybunt'||list==='sybunt'?filters:'<p>This list uses its saved search filters.</p>'}
  </div><button>Review export</button></form>`)}
 ${box('Review your download',`<p>${m.listName?`${e(m.listName)} · `:''}${m.memberCount} constituents · ${m.rowCount} ${e(type)} rows.</p>
  <p>${e(m.withheld.statement)}.</p><p>Reviewed as of ${e(m.asOf)} UTC. Dates use ${e(m.timezone)}.</p>
  <p>The download uses the list’s membership when you download it. Coffer records who downloaded it and the row count.</p>
  <p><a href="${e(download)}">Download ${e(type)} CSV</a></p><p>Credentials, payment-method details and prospect research are excluded. This download is separate from a donor’s data request.</p>`)}${save}`
}

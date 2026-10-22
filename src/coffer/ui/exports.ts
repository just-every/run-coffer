import { ADVANCED_FILTERS } from '../list-filters'
import { SOLICITATION_FILTERS } from '../solicitation-filter'
import { requireRole } from '../auth'
import { today, type Context } from '../db'
import { EXPORT_TYPES, exportSnapshot, exportType } from '../exports'
import { savedLists } from '../saved-lists'
import { RELATIONSHIP_TYPES, RELATIONSHIP_LABELS } from '../donor-depth'
import { box, e, field, form, select } from './common'

const formValues=(values:Record<string,string>)=>Object.entries(values).map(([name,value])=>`<input type="hidden" name="${e(name)}" value="${e(value)}">`).join('')
const label = (value: string) => value.charAt(0).toUpperCase()+value.slice(1)
export async function exportsPage(c: Context, url: URL, error = '') {
 requireRole(c.actor,['owner','admin'],'export donor records')
 const type=exportType(url.searchParams.get('type')||'constituents')
 const [lists,snapshot]=await Promise.all([savedLists(c),exportSnapshot(c,type,url)])
 const m=snapshot.metadata,value=(key:string)=>url.searchParams.get(key)||''
 const list=value('list')||'search',query=new URLSearchParams(url.searchParams)
 query.delete('type')
 const download=`/api/coffer/exports/${type}.csv?${query.toString()}`
 const filters=`${select('Solicitation restriction','solicitation',SOLICITATION_FILTERS,value('solicitation'))}${field('Search name, email or household','q','search',value('q'),'maxlength="100"')}
  ${select('Relationship','relationship',[['','Any relationship'],...RELATIONSHIP_TYPES.map(t=>[t,RELATIONSHIP_LABELS[t].outgoing] as [string,string])],value('relationship'))}
  ${field('Connected donor ID','relatedTo','text',value('relatedTo'),'maxlength="100"')}
  ${ADVANCED_FILTERS.filter(k=>!['emailConsent','mailConsent','ackStatus','status'].includes(k)).map(k=>field(({minGiven:'Minimum given (USD)',maxGiven:'Maximum given (USD)',givingFrom:'Giving from',givingThrough:'Giving through',lastGiftFrom:'Last gift from',lastGiftThrough:'Last gift through',fund:'Fund',campaignId:'Campaign ID',managerId:'Relationship manager ID',tag:'Tag',customKey:'Custom field key',customValue:'Custom field value'} as Record<string,string>)[k],k,k.endsWith('From')||k.endsWith('Through')?'date':'text',value(k))).join('')}${select('Email consent','emailConsent',[['','Any answer'],['granted','Yes'],['withdrawn','Withdrawn'],['unknown','Not recorded']],value('emailConsent'))}${select('Mail consent','mailConsent',[['','Any answer'],['granted','Yes'],['withdrawn','Withdrawn'],['unknown','Not recorded']],value('mailConsent'))}${select('Gift acknowledgment','ackStatus',[['','Any status'],['not acknowledged','Not acknowledged'],['acknowledged','Acknowledged'],['do not acknowledge','Do not acknowledge']],value('ackStatus'))}${select('Constituent status','status',[['','Active'],['all','All statuses'],['inactive','Inactive'],['deceased','Deceased']],value('status'))}
  ${select('Volunteers','volunteer',[['','All constituents'],['all','All volunteers'],['never-given','Volunteers who have never given']],value('volunteer'))}`
 const save=list==='search'?box('Save this search',form('list.save',`${field('List name','name','text','','required maxlength="100"')}<p>The saved search stays current. It includes active constituents.</p>`,'Save live list',Object.fromEntries(['q','relationship','relatedTo','volunteer','solicitation',...ADVANCED_FILTERS].map(k=>[k,value(k)])))):''
 return `<p><a href="/app/donors">Donors</a></p><p>Download one record type for everyone in a current list. Each file includes their records across all dates.</p>
 ${error?`<p role="alert">${e(error)}</p>`:''}
 ${box('Choose an export',`<form method="get" action="/app/exports"><div class="fields">
  ${select('List','list',[['search','Current donor search'],['lybunt','LYBUNT'],['sybunt','SYBUNT'],...lists.map(l=>[`saved:${l.id}`,l.name] as [string,string])],list,'aria-label="List"')}
  ${field('Annual list calendar year','year','number',value('year')||today(m.timezone,new Date(m.asOf)).slice(0,4),'min="1900"')}
  </div>${formValues({type})}<button>Choose list</button></form><form method="get" action="/app/exports">${formValues(Object.fromEntries([...url.searchParams.entries()].filter(([key])=>key!=='type')))}<div class="fields">${select('Record type','type',EXPORT_TYPES.map(t=>[t,label(t)] as [string,string]),type,'aria-label="Record type"')}</div><button>Review export</button></form>`)}
 ${list==='search'||list==='lybunt'||list==='sybunt'?box('Filter this list',`<form method="get" action="/app/exports">${formValues({list,type,year:value('year')})}<div class="fields">${filters}</div><button>Apply list filters</button></form>`):'<p>This list uses its saved search filters.</p>'}
 ${box('Review your download',`<p>${m.listName?`${e(m.listName)} · `:''}${m.memberCount} constituents · ${m.rowCount} ${e(type)} rows.</p>
  <p>${e(m.withheld.statement)}.</p><p>Reviewed as of ${e(m.asOf)} UTC. Dates use ${e(m.timezone)}.</p>
  <p>The download uses the list’s membership when you download it. Coffer records who downloaded it and the row count.</p>
  <p><a href="${e(download)}">Download ${e(type)} CSV</a></p><p>Credentials, payment-method details and prospect research are excluded. This download is separate from a donor’s data request.</p>`)}${save}${list.startsWith('saved:')?box('Bulk tags and relationship manager',form('list.bulk',field('Tag (optional)','tag')+select('Tag change','removeTag',[['no','Add'],['yes','Remove']])+field('Portfolio ID (optional)','portfolioId')+field('Reason','reason','text','','required maxlength="1000"')+'<p>Applies atomically to every current list member, up to 500. The result links an undo action; newer donor or assignment changes refuse undo.</p>','Apply bulk change',{listId:m.listId,version:m.listVersion})):''}${list.startsWith('saved:')?box('Set or clear list restrictions',form('list.solicitation',select('Restriction','type',[['stop','Do not solicit'],['none','Clear restriction']])+field('Reason','reason','text','','required maxlength="1000"')+'<p>Applies to every active constituent in this live list, up to 500. Each record retains its versioned history and audit. Channel consent is unchanged.</p>','Apply to this list',{listId:m.listId,version:m.listVersion})):''}`
}

import { engagementScores } from './engagement'
import { contactSearchSql } from './contact-points'
import { ADVANCED_FILTERS, advancedListSql,validateCustomFilter } from './list-filters'
import { solicitationFilterSql } from './solicitation-filter'
import { choice, fail, integer, one, today, type Context } from './db'
import { listFilters } from './saved-lists'

const pattern = (column: string) => `('%'||replace(replace(replace(${column},char(92),char(92)||char(92)),'%',char(92)||'%'),'_',char(92)||'_')||'%')`

/** Membership and selected records are evaluated in the same export statement.
 * Time-zone preflight is checked again inside that statement; a changed setting
 * refuses the request instead of mixing two organization calendars. */
export async function exportSelection(c: Context, url: URL) {
 const value = url.searchParams.get('list') || 'search'
 const savedId = value.startsWith('saved:') ? value.slice(6) : null
 if (savedId !== null && (!savedId || savedId.length > 100)) fail('INPUT','Choose a saved list.',400)
 const source = savedId === null ? choice(value,['search','lybunt','sybunt'] as const,'donor list') : 'saved'
 const filters = listFilters(Object.fromEntries(['q','relationship','relatedTo','volunteer','solicitation',...ADVANCED_FILTERS].map(k=>[k,url.searchParams.get(k)||''])))
 if (source === 'saved' && Object.values(filters).some(Boolean)) fail('INPUT','A saved list uses its saved filters. Open the current search to choose other filters.',400)
 const timezone = String((await one(c,'SELECT timezone FROM cf_settings WHERE id=1'))!.timezone)
 const day = today(timezone,new Date(c.now)), currentYear = Number(day.slice(0,4))
 const rawYear = url.searchParams.get('year')
 if (rawYear && !/^\d{4}$/.test(rawYear)) fail('INPUT','Choose a calendar year.',400)
 const year = integer(rawYear ? Number(rawYear) : currentYear,'Calendar year',1900,currentYear)
 const through = year === currentYear ? day : `${year}-12-31`
 const baseRevision=Number((await one(c,'SELECT revision FROM cf_score_clock WHERE id=1'))!.revision)
 const saved=savedId?await one(c,'SELECT version,filters FROM cf_saved_lists WHERE id=?',savedId):null
 const scoreFilters=saved?JSON.parse(saved.filters):filters
 await validateCustomFilter(c,scoreFilters)
 const needsScore=Boolean(scoreFilters.minScore||scoreFilters.maxScore||scoreFilters.lapsed)
 const revision=needsScore||savedId?baseRevision:null
 const scores=needsScore?(await engagementScores(c)).donors.filter(d=>(!scoreFilters.minScore||d.engagement.score>=Number(scoreFilters.minScore))&&(!scoreFilters.maxScore||d.engagement.score<=Number(scoreFilters.maxScore))&&(!scoreFilters.lapsed||d.engagement.retentionRisk.status===scoreFilters.lapsed)).map(d=>d.donorId):null
 const scoreCurrentSql=revision===null?'1':`(SELECT revision FROM cf_score_clock WHERE id=1)=${revision}`
 const ctes = `config AS (SELECT timezone,name_defaults,${scoreCurrentSql} AS selection_current FROM cf_settings WHERE id=1),
 selected_list AS (SELECT id,name,version,filters FROM cf_saved_lists WHERE id=?),
 filters AS (SELECT CASE WHEN ?='saved' THEN (SELECT filters FROM selected_list) ELSE ? END AS definition),
 annual AS MATERIALIZED (SELECT donor_id,substr(received_on,1,4) AS year,SUM(amount_cents) AS cents
  FROM cf_monetary_contributions WHERE received_on<=? GROUP BY donor_id,substr(received_on,1,4)),
 members AS MATERIALIZED (SELECT d.id FROM cf_donors d LEFT JOIN cf_households h ON h.id=d.household_id CROSS JOIN filters f
  WHERE ${solicitationFilterSql('d.id',"json_extract(f.definition,'$.solicitation')","'"+day+"'")} AND d.erased_at IS NULL AND NOT EXISTS(SELECT 1 FROM cf_donor_merges m WHERE m.donor_id=d.id)
  AND (?<>'saved' OR (EXISTS(SELECT 1 FROM selected_list) AND (COALESCE(json_extract(f.definition,'$.status'),'')='all' OR d.constituent_status=COALESCE(NULLIF(json_extract(f.definition,'$.status'),''),'active'))))
  AND (? NOT IN ('lybunt','sybunt') OR (
   COALESCE((SELECT cents FROM annual a WHERE a.donor_id=d.id AND a.year=?),0)<=0
   AND EXISTS(SELECT 1 FROM annual a WHERE a.donor_id=d.id AND a.year<? AND a.cents>0 AND (?='sybunt' OR a.year=?))))
  AND (? IS NULL OR d.id IN(SELECT value FROM json_each(?)))
  AND ${advancedListSql('f.definition')}
  AND (json_extract(f.definition,'$.q')='' OR
   NOT EXISTS(SELECT 1 FROM json_each(replace(json_array(json_extract(f.definition,'$.q')),' ','","')) term
    WHERE lower(d.name) NOT LIKE ${pattern('term.value')} ESCAPE char(92))
   OR lower(d.email) LIKE ${pattern("json_extract(f.definition,'$.q')")} ESCAPE char(92)
   OR ${contactSearchSql('d.id',pattern("json_extract(f.definition,'$.q')"))}
   OR lower(d.phone) LIKE ${pattern("json_extract(f.definition,'$.q')")} ESCAPE char(92)
   OR EXISTS(SELECT 1 FROM cf_donor_aliases a WHERE a.donor_id=d.id AND lower(a.email) LIKE ${pattern("json_extract(f.definition,'$.q')")} ESCAPE char(92))
   OR lower(h.name) LIKE ${pattern("json_extract(f.definition,'$.q')")} ESCAPE char(92))
  AND (json_extract(f.definition,'$.relationship')='' OR EXISTS(SELECT 1 FROM cf_relationships r
   WHERE (r.donor_id=d.id OR r.related_donor_id=d.id) AND r.type=json_extract(f.definition,'$.relationship')))
  AND (json_extract(f.definition,'$.relatedTo')='' OR EXISTS(SELECT 1 FROM cf_relationships r WHERE
   (r.donor_id=d.id AND r.related_donor_id=json_extract(f.definition,'$.relatedTo')) OR
   (r.related_donor_id=d.id AND r.donor_id=json_extract(f.definition,'$.relatedTo'))))
  AND (json_extract(f.definition,'$.volunteer')='' OR (EXISTS(SELECT 1 FROM cf_volunteering v WHERE v.donor_id=d.id)
   AND (json_extract(f.definition,'$.volunteer')<>'never-given' OR NOT EXISTS(
    SELECT 1 FROM cf_contribution_ledger g WHERE g.donor_id=d.id AND g.kind IN ('gift','in_kind'))))))`
 const params = [savedId??'',source,JSON.stringify(filters),through,source,source,String(year),String(year),source,String(year-1),scores===null?null:JSON.stringify(scores),scores===null?null:JSON.stringify(scores)]
 const selection = {source,listId:savedId,year:source==='lybunt'||source==='sybunt'?year:null,
  filters:Object.fromEntries(Object.entries(filters).map(([k,v])=>[k,k==='relationship'||k==='volunteer'?v:Boolean(v)]))}
 return {source,savedId,timezone,year,through,ctes,params,selection,scoreCurrentSql}
}

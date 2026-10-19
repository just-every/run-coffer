import { annualLapses } from './annual-lapses'
import { choice, fail, integer, today, type Context } from './db'
import { fiscalPeriod } from './giving-summary'
import { settings } from './settings'

/** A report year is labelled by its start year, as in donor giving summaries. */
export async function retentionScope(c: Context, url: URL) {
 const s = await settings(c), asOf = today(s.timezone, new Date(c.now))
 const basis = choice(url.searchParams.get('basis') || 'calendar', ['calendar','fiscal'] as const, 'year basis')
 const monthDay = basis === 'fiscal' ? s.fiscal_year_start : '01-01'
 const currentYear = Number(fiscalPeriod(asOf, monthDay).start.slice(0,4))
 const raw = url.searchParams.get('year') ?? String(currentYear)
 if (!/^\d{4}$/.test(raw)) fail('INPUT', 'Choose a year.', 400)
 const year = integer(Number(raw), 'Year', 1000, currentYear), priorYear = year - 1
 const start = `${year}-${monthDay}`, priorStart = `${priorYear}-${monthDay}`, next = `${year+1}-${monthDay}`
 const lastDay = (exclusive: string) => new Date(Date.parse(exclusive+'T00:00:00Z')-86400000).toISOString().slice(0,10)
 const end = year === currentYear ? asOf : lastDay(next)
 const list = choice(url.searchParams.get('list') || 'all', ['all','lybunt','sybunt'] as const, 'donor list')
 const listYear = Number(asOf.slice(0,4))
 const members = list === 'all' ? null : (await annualLapses(c,listYear)).groups.find(g=>g.kind===list)!.rows.map(r=>r.donorId)
 const q = (url.searchParams.get('q') ?? '').trim().toLowerCase().slice(0,100)
 const relationship = url.searchParams.get('relationship') ?? '', relatedTo = url.searchParams.get('relatedTo') ?? ''
 const pattern = (value: string) => `%${value.replace(/[%_\\]/g,x=>`\\${x}`)}%`
 const terms = q.split(/\s+/).map(pattern)
 const nameSearch = terms.map(()=>"lower(d.name) LIKE ? ESCAPE '\\'").join(' AND ')
 const donorSql = `(? IS NULL OR d.id IN (SELECT value FROM json_each(?)))
  AND (?='' OR (${nameSearch}) OR lower(d.email) LIKE ? ESCAPE '\\' OR lower(h.name) LIKE ? ESCAPE '\\')
  AND (?='' OR EXISTS(SELECT 1 FROM cf_relationships r WHERE (r.donor_id=d.id OR r.related_donor_id=d.id) AND r.type=?))
  AND (?='' OR EXISTS(SELECT 1 FROM cf_relationships r WHERE (r.donor_id=d.id AND r.related_donor_id=?) OR (r.related_donor_id=d.id AND r.donor_id=?)))`
 const memberJson = members === null ? null : JSON.stringify(members)
 return { year,priorYear,asOf,timezone:s.timezone,basis,currentYear,start,priorStart,end,
  priorEnd:lastDay(start),monthDay,list,listYear,q,relationship,relatedTo,
  fund:url.searchParams.get('fund') || null,campaignId:url.searchParams.get('campaignId') || null,
  donorSql,donorParams:[memberJson,memberJson,q,...terms,pattern(q),pattern(q),relationship,relationship,relatedTo,relatedTo,relatedTo] }
}

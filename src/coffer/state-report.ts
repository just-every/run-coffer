import { acknowledgmentPredicate } from './acknowledgment-filters'
import { solicitationFilter, solicitationFilterSql } from './solicitation-filter'
import { all, choice, fail, id, integer, today, type Context, type Row } from './db'
import { fiscalPeriod } from './giving-summary'
import { METHODS } from './gifts'
import { settings } from './settings'
import { dollars } from './payments/exports'

/** REPORT-008: monetary ledger entries for a year, by the donor's US state on
 * each gift's received date. Rows reconcile to the same filtered fund ledger. */
const STATES: Record<string, string> = {
 AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia',
 FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine',
 MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada',
 NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon',
 PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia',
 WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming', PR: 'Puerto Rico', GU: 'Guam', VI: 'U.S. Virgin Islands', AS: 'American Samoa',
 MP: 'Northern Mariana Islands', AA: 'Armed Forces Americas', AE: 'Armed Forces Europe', AP: 'Armed Forces Pacific',
}
const BY_NAME = new Map(Object.entries(STATES).map(([code, name]) => [name.toLowerCase(), code]))
const US = new Set(['', 'us', 'usa', 'u.s.', 'u.s.a.', 'united states', 'united states of america'])
export const FOREIGN = 'Outside the United States', UNKNOWN = 'Unknown address'

/** A US state or territory code, FOREIGN, or UNKNOWN. A blank country is the United States. */
export function stateOf(region: unknown, country: unknown) {
 if (!US.has(String(country ?? '').trim().toLowerCase())) return FOREIGN
 const value = String(region ?? '').trim(), code = value.toUpperCase()
 return STATES[code] ? code : BY_NAME.get(value.toLowerCase()) ?? UNKNOWN
}

export async function stateRecordSelection(c: Context, url: URL) {
 const s = await settings(c), asOf = today(s.timezone, new Date(c.now)), q = url.searchParams
 const basis = choice(q.get('basis') || 'calendar', ['calendar', 'fiscal'] as const, 'year basis')
 const monthDay = basis === 'fiscal' ? s.fiscal_year_start : '01-01', current = Number(fiscalPeriod(asOf, monthDay).start.slice(0, 4))
 const raw = q.get('year') ?? String(current)
 if (!/^\d{4}$/.test(raw)) fail('INPUT', 'Choose a four-digit report year.', 400)
 const year = integer(Number(raw), 'Report year', 1004, current), period = fiscalPeriod(`${year}-${monthDay}`, monthDay)
 const solicitation=solicitationFilter(q.get('solicitation'))
 const fund = q.get('fund') || null, campaignId = q.get('campaignId') ? id(q.get('campaignId'), 'Campaign') : null, formId = q.get('formId') ? id(q.get('formId'), 'Form') : null
 const channel = q.get('channel') ? choice(q.get('channel'), METHODS, 'channel') : null
 const acknowledgment=acknowledgmentPredicate(url,'e.gift_id')
 // Every monetary ledger entry in the period (gifts, reversals and refunds), each
 // placed by the address in effect on its gift's own received date.
 const query = `WITH e AS (
   SELECT l.gift_id,l.donor_id,l.amount_cents,l.fund,l.campaign_id,g.received_on AS gift_on FROM cf_fund_ledger l JOIN cf_gifts g ON g.id=l.gift_id
   WHERE l.received_on>=? AND l.received_on<? AND (? IS NULL OR l.fund=?) AND (? IS NULL OR l.campaign_id=?) AND (? IS NULL OR l.method=?)
    AND (? IS NULL OR EXISTS(SELECT 1 FROM cf_campaign_gifts cg WHERE cg.gift_id=l.gift_id AND cg.campaign_id=?)))
  SELECT e.*,CASE WHEN h.id IS NULL THEN d.region ELSE h.region END AS region,CASE WHEN h.id IS NULL THEN d.country ELSE h.country END AS country
  FROM e JOIN cf_donors d ON d.id=e.donor_id CROSS JOIN (SELECT ? AS choice,? AS day) sf
  LEFT JOIN cf_donor_address_history h ON h.id=(SELECT x.id FROM cf_donor_address_history x WHERE x.donor_id=e.donor_id AND x.until_on>e.gift_on ORDER BY x.until_on,x.id LIMIT 1) WHERE ${solicitationFilterSql('d.id','sf.choice','sf.day')} AND ${acknowledgment.sql}`
 const params = [period.start, period.end, fund, fund, campaignId, campaignId, channel, channel, formId, formId,solicitation,asOf,...acknowledgment.params]
 const filters={fund,campaignId,formId,channel,solicitation,...acknowledgment.filters}
 return {s,asOf,basis,year,current,period,fund,campaignId,formId,channel,solicitation,query,params,filters,parameters:{basis,year,...filters}}
}

export async function stateReport(c: Context, url: URL) {
 const {s,asOf,basis,year,current,period,query,params,filters}=await stateRecordSelection(c,url)
 const entries=await all(c,query,...params)
 const observations=await all(c,"SELECT donor_id,at,json_extract(detail,'$.moveEffectiveMonth') AS month,json_extract(detail,'$.observedOn') AS observed FROM cf_events WHERE action='address.ncoa' AND json_extract(detail,'$.result')='moved' AND json_extract(detail,'$.moveEffectiveMonth') IS NOT NULL")
 const windows=new Map<string,{start:string;through:string}[]>()
 for(const o of observations){const group=windows.get(o.donor_id)??[];group.push({start:o.month+'-01',through:o.observed??today(s.timezone,new Date(o.at))});windows.set(o.donor_id,group)}
 const inMoveWindow=(e:Row)=>(windows.get(e.donor_id)??[]).some(w=>e.gift_on>=w.start&&e.gift_on<=w.through)
 const groups = new Map<string, { donors: Set<string>; gifts: Set<string>; moveWindowGifts:Set<string>; cents: number }>()
 for (const e of entries) {
  const key = stateOf(e.region, e.country), g = groups.get(key) ?? { donors: new Set(), gifts: new Set(), moveWindowGifts:new Set(), cents: 0 }
  g.donors.add(e.donor_id); g.gifts.add(e.gift_id);if(inMoveWindow(e))g.moveWindowGifts.add(e.gift_id); g.cents += Number(e.amount_cents); groups.set(key, g)
 }
 const order = (k: string) => k === FOREIGN ? 'zz1' : k === UNKNOWN ? 'zz2' : STATES[k]
 const rows: Row[] = [...groups].sort(([a], [b]) => order(a).localeCompare(order(b))).map(([key, g]) => ({
  state: STATES[key] ? key : null, label: STATES[key] ?? key, donors: g.donors.size, gifts: g.gifts.size,moveWindowGifts:g.moveWindowGifts.size, amountCents: g.cents }))
 return {
  basis, year, start: period.start, through: year === current ? asOf : addDay(period.end, -1), filters,
  rows,moveWindowGiftCount:new Set(entries.filter(inMoveWindow).map(e=>e.gift_id)).size, totalCents: rows.reduce((sum, r) => sum + r.amountCents, 0),
  campaigns: await all(c, 'SELECT id,name,slug FROM cf_campaigns ORDER BY lower(name)'), funds: (await all(c, 'SELECT DISTINCT fund FROM cf_fund_ledger ORDER BY fund')).map(r => r.fund),
 }
}
const addDay = (day: string, n: number) => new Date(Date.parse(day + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10)

export function stateReportCsv(report: Awaited<ReturnType<typeof stateReport>>) {
 const cell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
 const lines = [['State', 'State name', 'Donors', 'Gifts', 'Amount USD','Gifts in observed move windows'], ...report.rows.map(r => [r.state ?? '', r.label, r.donors, r.gifts, dollars(r.amountCents),r.moveWindowGifts]),
  ['', 'Total (ledger)', '', '', dollars(report.totalCents),report.moveWindowGiftCount]]
 return lines.map(r => r.map(cell).join(',')).join('\r\n') + '\r\n'
}

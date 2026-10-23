import { requireGrant, scopedDonor } from './agent-grants'
import { all, commit, event, fail, one, type Context, type Row } from './db'

/** Deliberately small projection. Related constituents, household names, soft
 * credits, aggregate portfolios and free-form histories are not scope-safe. */
export async function grantedRead(c: Context, permission: 'donors.list'|'donors.context', p: Row = {}) {
 const grant=await requireGrant(c,permission)
 let result: Row
 if(permission==='donors.list') {
  if(Object.keys(p).some(k=>!['q','page'].includes(k)))fail('GRANT_SCOPE','Scoped donor lists support only name/email search and paging.',403)
  const q=String(p.q??'').trim().toLowerCase().slice(0,100),page=Math.max(0,Math.min(Number(p.page)||0,10000))
  const rows=await all(c,`SELECT d.id,d.version,d.name,d.email,d.city,d.region,
   (SELECT COALESCE(SUM(g.amount_cents),0) FROM cf_monetary_contributions g WHERE g.donor_id=d.id) AS total_cents
   FROM cf_donors d WHERE d.erased_at IS NULL AND d.id IN(SELECT value FROM json_each(?))
   AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=d.id)
   AND (?='' OR instr(lower(d.name),?)>0 OR instr(lower(COALESCE(d.email,'')),?)>0)
   ORDER BY lower(d.name),d.id LIMIT 51 OFFSET ?`,grant.donor_ids,q,q,q,page*50)
  const total=await one(c,`SELECT count(*) AS n FROM cf_donors d WHERE d.erased_at IS NULL AND d.id IN(SELECT value FROM json_each(?)) AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=d.id)`,grant.donor_ids)
  result={donors:rows.slice(0,50),more:rows.length>50,page,q,total:total!.n}
 } else {
  const donorId=String(p.donorId??'');scopedDonor(grant,donorId)
  // A merge never follows an identifier outside the approved explicit scope.
  if(await one(c,'SELECT donor_id FROM cf_donor_merges WHERE donor_id=?',donorId))fail('GRANT_SCOPE','Merged records require a new grant scope.',403)
  const donor=await one(c,'SELECT id,version,name,email,phone,address_line1,address_line2,city,region,postal_code,country FROM cf_donors WHERE id=? AND erased_at IS NULL',donorId)
  if(!donor)fail('NOT_FOUND','This donor is unavailable.',404)
  const gifts=await all(c,'SELECT id,donor_id,kind,amount_cents,received_on,goods,goods_cents FROM cf_contribution_ledger WHERE donor_id=? ORDER BY received_on DESC,id',donorId)
  result={donor,gifts,totals:{lifetimeCents:gifts.filter(g=>['gift','reversal'].includes(g.kind)).reduce((n,g)=>n+g.amount_cents,0)},scope:'Explicit donor facts only; related records and histories are withheld.'}
 }
 await commit(c,[event(c,permission,'agent_grant',grant.id,permission==='donors.context'?String(p.donorId):null,{},'cf_access_events')])
 return result
}

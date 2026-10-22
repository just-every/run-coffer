import { all, choice, guard, newId, sql, today, type Context, type Row, type Stmt } from './db'
import { householdState } from './households'
import { computedHouseholdNames, householdDefaults } from './household-names'
import { settings } from './settings'

export const appealPieces=(c:{db:D1Database},appealId:string)=>all(c,'SELECT * FROM cf_appeal_pieces WHERE appeal_id=? ORDER BY name,id',appealId)
export const householdPieceGuard=(appealId:string)=>guard('NOT EXISTS(SELECT 1 FROM cf_appeal_pieces p WHERE p.appeal_id=? AND p.household_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM cf_households h WHERE h.id=p.household_id AND h.version=p.household_version))','HOUSEHOLD_CHANGED','A household changed after this mailing was prepared. Prepare it again.',appealId)
const addressKey=(raw:string)=>{const a=JSON.parse(raw);return [a.line1,a.line2,a.city,a.region,a.postalCode,String(a.country??'').replace(/^United States$/i,'US')].map(s=>String(s??'').trim().toLowerCase().replace(/\s+/g,' ')).join('|')}
export async function prepareAppealPieces(c:Context,appealId:string,recipients:Row[],input:unknown){
 const basis=choice(input??'household',['gift','constituent','household'],'one piece per'),day=today((await settings(c)).timezone,new Date(c.now))
 const donors=await all(c,'SELECT * FROM cf_donors WHERE id IN(SELECT value FROM json_each(?))',JSON.stringify(recipients.map(r=>r.donor_id))),byId=new Map(donors.map(d=>[d.id,d])),groups=new Map<string,Row[]>()
 for(const r of recipients){const d=byId.get(r.donor_id)!;const key=basis==='household'&&d.household_id?d.household_id+'|'+addressKey(r.address):d.id;const group=groups.get(key)??[];group.push(r);groups.set(key,group)}
 const pieces:Row[]=[],guards:Stmt[]=[],defaults=await householdDefaults(c)
 for(const group of groups.values()){
  const d=byId.get(group[0].donor_id)!,household=basis==='household'&&d.household_id?await householdState(c,d.household_id):null
  const allowed=group.map(r=>byId.get(r.donor_id)!),memberIds=group.map(r=>r.donor_id),allLiving=household?.members.filter((m:Row)=>m.constituent_status!=='deceased')??[]
  const allIncluded=household&&allLiving.length===allowed.length&&allLiving.every((m:Row)=>memberIds.includes(m.id))
  const computed=household?computedHouseholdNames(allowed,household.household.head_donor_id,defaults):null
  const names=household?(allIncluded?household.names:computed):JSON.parse(group[0].name_fields??'{}')
  const envelope=household?names.addressee:names.envelope_name??group[0].name
  const giftIds=await all(c,'SELECT id,donor_id,net_cents FROM cf_gift_balances WHERE donor_id IN(SELECT value FROM json_each(?)) AND net_cents>0 ORDER BY received_on,id',JSON.stringify(memberIds))
  const copies=basis==='gift'?giftIds.map(g=>[g]):[giftIds]
  for(const gifts of copies){pieces.push({appeal_id:appealId,id:newId(),name:envelope,address:group[0].address,names:JSON.stringify(household?{informal_salutation:names.informal,formal_salutation:names.formal,envelope_name:names.addressee,household_addressee:names.addressee,household_informal_salutation:names.informal,household_formal_salutation:names.formal}:names),members:JSON.stringify(memberIds),household_id:household?.household.id??null,household_version:household?.household.version??null,snapshot:JSON.stringify({basis,asOf:day,headStatus:household?.headStatus??null,overridesReview:!!household?.household.overrides_review,namesSource:allIncluded?'household names':'consenting members',gifts: gifts.map(g=>({id:g.id,donorId:g.donor_id,amountCents:g.net_cents}))})})}
  if(household)guards.push(guard('EXISTS(SELECT 1 FROM cf_households WHERE id=? AND version=?)','HOUSEHOLD_CHANGED','This household changed while grouping. Prepare again.',household.household.id,household.household.version))
 }
 for(const d of donors)guards.push(guard('EXISTS(SELECT 1 FROM cf_donors WHERE id=? AND version=? AND erased_at IS NULL)','DONOR_CHANGED','A recipient changed while grouping. Prepare again.',d.id,d.version))
 return {basis,pieces,statements:[...guards,...pieces.map(p=>sql('INSERT INTO cf_appeal_pieces VALUES(?,?,?,?,?,?,?,?,?)',p.appeal_id,p.id,p.name,p.address,p.names,p.members,p.household_id,p.household_version,p.snapshot))]}
}

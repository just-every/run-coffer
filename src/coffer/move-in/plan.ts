import { all, fail, guard, sha256, type Context, type Row, type Stmt } from '../db'
import { erasureHash } from '../imports/snapshots'
import { snapshot, tables, type Kind } from './tables'
import type { ParsedImport, Located, ImportTotals } from './types'
import { accumulate, emptyTotals } from './source-totals'

export type Effect = { kind: Kind; sourceKey: string; contentHash: string; nativeId: string; owned: boolean; row: Row; donorId: string | null; relatedId: string | null; location?: Located['location'] }
export type Plan = { effects: Effect[]; checks: Stmt[]; state: unknown[]; donorIds: Map<string,string>; giftIds: Map<string,string>; already: number; diagnostics: Row[]; totals: ImportTotals }
const stable = (value: unknown): string => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))) : v)
export const contentHash = (value: unknown) => sha256(stable(value))
export const nativeId = async (source: string, kind: string, key: string) => `crm-${(await contentHash([source,kind,key])).slice(0,40)}`
export const sourceKey = (key: string) => sha256(key)

/** Reads become transaction guards: a preview can never approve a stale match. */
async function readSet(c: Context, plan: Plan, query: string, params: unknown[] = []) {
 const rows = await all(c, query, ...params)
 const result = JSON.stringify(rows.map(r=>JSON.parse(r.snapshot)))
 const scalar = `(SELECT COALESCE(json_group_array(json(snapshot)),'[]') FROM (${query}))`
 plan.checks.push(guard(`${scalar}=?`, 'MOVE_IN_CHANGED', 'Coffer changed after preview. Preview these files again.', ...params, result))
 plan.state.push(result)
 return rows.map(r=>JSON.parse(r.snapshot)) as Row[]
}

const label: Record<Kind,string> = {household:'Household',donor:'Constituent',pledge:'Pledge',installment:'Installment',gift:'Gift',campaign:'Gift',allocation:'Pledge payment',relationship:'Relationship',softCredit:'Soft credit',note:'Note',interaction:'Note'}

/** Plans one part. A preview plans every part with the same rules, so apply meets no refusal the review did not name. */
export async function planImport(c: Context, parsed: ParsedImport, { preview = false } = {}): Promise<Plan> {
 const plan: Plan = {effects:[],checks:[],state:[],donorIds:new Map(),giftIds:new Map(),already:0,diagnostics:[],totals:emptyTotals()}
 const source = parsed.source
 const entities = [...parsed.households,...parsed.donors,...parsed.pledges,...parsed.installments,...parsed.gifts,...parsed.relationships,...parsed.softCredits,...parsed.notes]
 const allocationKeys=parsed.gifts.flatMap(g=>parsed.installments.filter(i=>i.pledgeExternalId===g.pledgeExternalId).map(i=>`${g.externalId}@${i.externalId}`))
 const keys = await Promise.all([...entities.map(x=>x.externalId),...parsed.gifts.map(g=>g.pledgeExternalId).filter(Boolean),...allocationKeys,...parsed.pledges.filter(p=>p.note).map(p=>`pledge-note:${p.externalId}`)].map(sourceKey))
 const mappings = await readSet(c, plan, `SELECT json_object('kind',kind,'source_key',source_key,'native_id',native_id,'content_hash',content_hash,'snapshot',snapshot) AS snapshot FROM cf_move_in_records WHERE source=? AND source_key IN (SELECT value FROM json_each(?)) ORDER BY kind,source_key`, [source,JSON.stringify(keys)])
 const existing = new Map(mappings.map(m=>[`${m.kind}:${m.source_key}`,m]))
 const merges = await readSet(c,plan,`SELECT json_object('donor_id',donor_id,'into_id',into_id) AS snapshot FROM cf_donor_merges ORDER BY donor_id`)
 const merged = new Map(merges.map(m=>[m.donor_id as string,m.into_id as string]))
 const canonical = (id: string): string => merged.get(id)??id
 const emailAliases = await readSet(c,plan,`SELECT json_object('donor_id',donor_id,'email',email) AS snapshot FROM cf_donor_aliases WHERE email IN (SELECT value FROM json_each(?)) ORDER BY donor_id,email`,[JSON.stringify(parsed.donors.map(d=>d.email).filter(Boolean))])
 const donorRows = await readSet(c,plan,`SELECT ${snapshot('donor')} AS snapshot FROM cf_donors n WHERE n.id IN (SELECT value FROM json_each(?)) OR n.email IN (SELECT value FROM json_each(?)) OR n.source_ref IN (SELECT value FROM json_each(?)) ORDER BY n.id`, [JSON.stringify(mappings.filter(m=>m.kind==='donor').map(m=>m.native_id)),JSON.stringify(parsed.donors.map(d=>d.email).filter(Boolean)),JSON.stringify(parsed.donors.map(d=>`${source}:${d.externalId}`))])
 const survivors = [...new Set([...donorRows.map(d=>canonical(d.id)),...emailAliases.map(d=>canonical(d.donor_id))])].filter(id=>!donorRows.some(d=>d.id===id))
 if(survivors.length)donorRows.push(...await readSet(c,plan,`SELECT ${snapshot('donor')} AS snapshot FROM cf_donors n WHERE n.id IN (SELECT value FROM json_each(?)) ORDER BY n.id`,[JSON.stringify(survivors)]))
 // Household names are unique in Coffer. An imported household never joins an existing one by name: it takes the next free name.
 const nameChoices=(name:string)=>[name,...Array.from({length:8},(_,i)=>`${name} (${i+2})`)]
 const householdRows = await readSet(c,plan,`SELECT json_object('name',lower(n.name)) AS snapshot FROM cf_households n WHERE lower(n.name) IN (SELECT lower(value) FROM json_each(?)) ORDER BY n.id`,[JSON.stringify(parsed.households.flatMap(h=>nameChoices(h.name)))])
 const takenNames=new Set(householdRows.map(r=>r.name as string))
 const donorNativeIds=await Promise.all(parsed.donors.map(d=>nativeId(source,'donor',d.externalId)))
 const erased = await readSet(c,plan,`SELECT json_object('hash',hash) AS snapshot FROM cf_erasures WHERE hash IN (SELECT value FROM json_each(?)) ORDER BY hash`,[JSON.stringify([...parsed.donors.flatMap(d=>[erasureHash(d.email),erasureHash(`${source}:${d.externalId}`)]),...donorNativeIds.map(erasureHash)])])
 const suppressed = new Set(erased.map(r=>r.hash))
 const giftBalances=await readSet(c,plan,`SELECT json_object('id',id,'net_cents',net_cents) AS snapshot FROM cf_gift_balances WHERE id IN (SELECT value FROM json_each(?)) ORDER BY id`,[JSON.stringify(mappings.filter(m=>m.kind==='gift').map(m=>m.native_id))])
 const referenced = new Map((await readSet(c,plan,`SELECT json_object('id',id,'reference',reference) AS snapshot FROM cf_gifts WHERE source='manual' AND kind='gift' AND reference IN (SELECT value FROM json_each(?)) ORDER BY id`,[JSON.stringify(parsed.gifts.map(g=>`${source}:${g.externalId}`))])).map(r=>[r.reference as string,r.id as string]))
 const ownEmails = new Map<string,string>(), households = new Map<string,string>(), pledges = new Map<string,string>(), installments = new Map<string,string>()
 const diagnostic = (message: string, location?: Located['location'], severity: 'error'|'warning' = 'error', code = 'MOVE_IN_MAPPING') => plan.diagnostics.push({severity,code,message,...location})
 const add = async (kind: Kind, entity: Located & {externalId:string}, row: Row, match?: string, donorId: string | null = null, relatedId: string | null = null) => {
  // A donor's household is inferred from the whole file set, so it is not part of the donor's own details.
  const key = await sourceKey(entity.externalId), {location:_,householdKey:_h,householdName:_n,...payload} = entity as typeof entity & {householdKey?:string;householdName?:string}
  const hash = await contentHash(payload), previous = existing.get(`${kind}:${key}`)
  if (previous) {
   // A later file (another year's gifts) finds the donors and households an earlier move-in brought, by the CRM's own ID.
   if (previous.snapshot === null) diagnostic(`${label[kind]} ${entity.externalId} was erased from Coffer after an earlier move-in; it cannot be imported again.`,entity.location)
   else if (previous.content_hash !== hash && (kind==='donor'||kind==='household')) diagnostic(`${label[kind]} ${entity.externalId} is already in Coffer from an earlier move-in. Coffer keeps that record as it is; this file’s details for it differ and are not applied.`,entity.location,'warning','ALREADY_MOVED_IN')
   else if (previous.content_hash !== hash) diagnostic(`${label[kind]} ${entity.externalId} is already in Coffer from an earlier move-in with different details. Export it as it was, or undo the earlier move-in first.`,entity.location)
   plan.already++;return kind==='donor'?canonical(previous.native_id):previous.native_id as string
  }
  const id = match || row[tables[kind].key] || await nativeId(source,kind,entity.externalId)
  row[tables[kind].key] = id
  plan.effects.push({kind,sourceKey:key,contentHash:hash,nativeId:id,owned:!match,row,donorId:kind==='donor'?id:donorId,relatedId,location:entity.location})
  return id
 }
 const householdOf = async (key: string) => {
  if (!key || households.has(key)) return households.get(key)
  const h = parsed.households.find(x=>x.externalId===key); if (!h) return undefined
  const previous = existing.get(`household:${await sourceKey(h.externalId)}`)
  const name = previous ? h.name : nameChoices(h.name).find(n=>!takenNames.has(n.toLowerCase()))
  if (!name) diagnostic(`Household ${h.name} and its numbered variants are already taken in Coffer. Rename one of those households first.`,h.location)
  takenNames.add((name||h.name).toLowerCase())
  households.set(key,await add('household',h,{name:name||h.name,created_at:c.now}))
  return households.get(key)
 }
 for (const d of parsed.donors) {
  const prior = existing.get(`donor:${await sourceKey(d.externalId)}`)
  if (prior) { plan.donorIds.set(d.externalId,await add('donor',d,{})); continue }
  if (suppressed.has(erasureHash(d.email)) || suppressed.has(erasureHash(`${source}:${d.externalId}`)) || suppressed.has(erasureHash(await nativeId(source,'donor',d.externalId)))) diagnostic(`Donor ${d.externalId} was erased from Coffer; it cannot be imported again.`,d.location)
  const matching = donorRows.filter(r=>r.source_ref===`${source}:${d.externalId}` || (d.email && r.email===d.email) || emailAliases.some(a=>a.email===d.email&&canonical(a.donor_id)===r.id))
  const matches = [...new Map(matching.map(r=>{const id=canonical(r.id);return [id,donorRows.find(d=>d.id===id)??r]})).values()]
  if (matches.some(r=>r.erased_at) || new Set(matches.map(r=>r.id)).size>1) diagnostic(`Donor ${d.externalId} has conflicting existing matches. Resolve the donor records first.`,d.location)
  if(d.email && ownEmails.has(d.email) && ownEmails.get(d.email)!==d.externalId) diagnostic(`Donors ${ownEmails.get(d.email)} and ${d.externalId} share ${d.email}. Coffer keeps one email per donor: clear it on one of them and upload again.`,d.location)
  if(d.email)ownEmails.set(d.email,d.externalId)
  const match=matches[0]
  if(match) diagnostic(`Constituent ${d.externalId} (${d.name}) is ${match.name} already in Coffer${match.email&&match.email===d.email?`, with the same email ${d.email}`:''}. The gifts join that donor; Coffer keeps the donor’s own details and household.`,d.location,'warning','MATCHED_DONOR')
  const id=await add('donor',d,{version:1,name:d.name,email:d.email||null,phone:d.phone||null,address_line1:d.addressLine1||null,address_line2:d.addressLine2||null,city:d.city||null,region:d.region||null,postal_code:d.postalCode||null,country:d.country||null,household_id:match?null:await householdOf(d.householdKey)||null,source:'manual',source_ref:`${source}:${d.externalId}`,created_at:c.now,erased_at:null},match?.id)
  plan.donorIds.set(d.externalId,id)
 }
 const donor = (key: string, location: Located['location']) => {const id=plan.donorIds.get(key);if(!id)diagnostic(`Donor ${key} is missing from the constituent export.`,location);return id||''}
 for(const p of parsed.pledges) pledges.set(p.externalId,await add('pledge',p,{donor_id:donor(p.donorExternalId,p.location),amount_cents:p.amountCents,pledged_on:p.pledgedOn,due_by:parsed.installments.filter(i=>i.pledgeExternalId===p.externalId).map(i=>i.dueOn).sort().at(-1)||null,fund:p.fund,created_at:c.now,created_by:c.actor.name},undefined,plan.donorIds.get(p.donorExternalId)))
 for(const p of parsed.pledges)if(p.note)await add('note',{...p,externalId:`pledge-note:${p.externalId}`},{donor_id:plan.donorIds.get(p.donorExternalId),occurred_on:p.pledgedOn,body:p.note,source,recorded_at:c.now,recorded_by:c.actor.name},undefined,plan.donorIds.get(p.donorExternalId))
 const positions=new Map<string,number>()
 for(const i of parsed.installments) {
  const pledgeId=pledges.get(i.pledgeExternalId);if(!pledgeId)diagnostic(`Installment ${i.externalId} has no pledge ${i.pledgeExternalId}.`,i.location)
  const position=(positions.get(i.pledgeExternalId)||0)+1;positions.set(i.pledgeExternalId,position)
  const p=parsed.pledges.find(p=>p.externalId===i.pledgeExternalId)
  installments.set(i.externalId,await add('installment',i,{pledge_id:pledgeId||'',position,due_on:i.dueOn,amount_cents:i.amountCents,remind_on:i.dueOn,reminder_status:'pending'},undefined,plan.donorIds.get(p?.donorExternalId||'')))
 }
 for(const p of parsed.pledges) {
  const schedule=parsed.installments.filter(i=>i.pledgeExternalId===p.externalId)
  if(schedule.length && schedule.reduce((sum,i)=>sum+i.amountCents,0)!==p.amountCents)diagnostic(`Pledge ${p.externalId}: installments do not equal its promised amount.`,p.location)
 }
 for(const g of parsed.gifts) {
  const donorId=donor(g.donorExternalId,g.location)
  if(g.pledgeExternalId && !pledges.has(g.pledgeExternalId)) {
   const earlier=existing.get(`pledge:${await sourceKey(g.pledgeExternalId)}`), snap=earlier?.snapshot?JSON.parse(earlier.snapshot):null
   if(!earlier)diagnostic(`Gift ${g.externalId} pays pledge ${g.pledgeExternalId}, which is neither in these files nor in an earlier move-in. Keep the Pledge row in this file, or move in the year that holds it first.`,g.location)
   else if(snap && (snap.donor_id!==donorId || (snap.fund??'')!==(g.fund??'')))diagnostic(`Pledge payment ${g.externalId} must use pledge ${g.pledgeExternalId}'s donor and fund.`,g.location)
   else pledges.set(g.pledgeExternalId,earlier.native_id)
  }
  const held=referenced.get(`${source}:${g.externalId}`)
  if(held && held!==existing.get(`gift:${await sourceKey(g.externalId)}`)?.native_id)diagnostic(`Gift ${g.externalId}: Coffer already holds a gift with the reference ${source}:${g.externalId} that did not come from a move-in. Change that gift's reference in Coffer, or delete this row.`,g.location)
  const id=await add('gift',g,{version:1,donor_id:donorId,kind:'gift',reverses:null,received_on:g.receivedOn,amount_cents:g.amountCents,method:g.method||'imported',reference:`${source}:${g.externalId}`,fund:g.fund,pledge_id:pledges.get(g.pledgeExternalId)||null,goods:g.goodsCents===null?'unknown':g.goodsCents>0?'provided':'none',goods_cents:g.goodsCents||0,goods_description:g.goodsCents?g.goodsDescription||'Goods or services recorded in source export':null,note:g.note||null,source:'manual',created_at:c.now,created_by:c.actor.name},undefined,donorId)
  plan.giftIds.set(g.externalId,id)
  const prior=mappings.find(m=>m.kind==='gift' && m.native_id===id)
  const cents=prior?(giftBalances.find(b=>b.id===id)?.net_cents??0):g.amountCents
  if(cents>0)accumulate(plan.totals,cents,g.receivedOn,g.fund,g.donorExternalId)
  if(g.campaign)await add('campaign',g,{gift_id:id,appeal:g.campaign},undefined,donorId)
 }
 // Source pledge-payment links pay the dated installments in date order.
 for(const p of parsed.pledges) {
  const schedule=parsed.installments.filter(i=>i.pledgeExternalId===p.externalId).sort((a,b)=>a.dueOn.localeCompare(b.dueOn)),remaining=new Map(schedule.map(i=>[i.externalId,i.amountCents]))
  const payments=parsed.gifts.filter(g=>g.pledgeExternalId===p.externalId).sort((a,b)=>a.receivedOn.localeCompare(b.receivedOn))
  if(payments.reduce((sum,g)=>sum+g.amountCents,0)>p.amountCents)diagnostic(`Pledge ${p.externalId} has payments above its promised amount.`,p.location)
  for(const g of payments) {
   if(g.donorExternalId!==p.donorExternalId || g.fund!==p.fund)diagnostic(`Pledge payment ${g.externalId} must use pledge ${p.externalId}'s donor and fund.`,g.location)
   let balance=g.amountCents
   for(const i of schedule) {
    const cents=Math.min(balance,remaining.get(i.externalId)||0);if(!cents)continue
    await add('allocation',{externalId:`${g.externalId}@${i.externalId}`,location:g.location},{installment_id:installments.get(i.externalId),gift_id:plan.giftIds.get(g.externalId),amount_cents:cents,created_at:c.now,created_by:c.actor.name},undefined,plan.donorIds.get(g.donorExternalId))
    balance-=cents;remaining.set(i.externalId,(remaining.get(i.externalId)||0)-cents)
   }
  }
 }
 const relationshipRows=await readSet(c,plan,`SELECT ${snapshot('relationship')} AS snapshot FROM cf_relationships n WHERE donor_id IN (SELECT value FROM json_each(?)) OR related_donor_id IN (SELECT value FROM json_each(?)) ORDER BY n.id`,[JSON.stringify([...plan.donorIds.values()]),JSON.stringify([...plan.donorIds.values()])])
 for(const r of parsed.relationships) {
  let a=donor(r.donorExternalId,r.location),b=donor(r.relatedDonorExternalId,r.location)
  if(a===b || !['spouse','employer','board_member','foundation_officer','introduced_by'].includes(r.type))diagnostic(`Relationship ${r.externalId} needs two different donors and a supported relationship type.`,r.location)
  if(r.type==='spouse' && a>b)[a,b]=[b,a]
  const match=relationshipRows.find(v=>v.donor_id===a&&v.related_donor_id===b&&v.type===r.type)?.id||plan.effects.find(e=>e.kind==='relationship'&&e.row.donor_id===a&&e.row.related_donor_id===b&&e.row.type===r.type)?.nativeId
  await add('relationship',r,{donor_id:a,related_donor_id:b,type:r.type,created_at:c.now,created_by:c.actor.name},match,a,b)
 }
 const creditRows=await readSet(c,plan,`SELECT json_object('gift_id',gift_id,'donor_id',donor_id) AS snapshot FROM cf_soft_credits WHERE gift_id IN (SELECT value FROM json_each(?)) ORDER BY id`,[JSON.stringify([...new Set(parsed.softCredits.map(s=>plan.giftIds.get(s.giftExternalId)).filter(Boolean))])])
 const credited=new Set(creditRows.map(r=>`${r.gift_id}:${r.donor_id}`))
 for(const s of parsed.softCredits) {
  const gift=parsed.gifts.find(g=>g.externalId===s.giftExternalId), donorId=donor(s.donorExternalId,s.location)
  if(!gift || s.amountCents>gift.amountCents || s.donorExternalId===gift.donorExternalId)diagnostic(`Soft credit ${s.externalId} must recognize another donor against an included gift, within its amount.`,s.location)
  const pair=`${plan.giftIds.get(s.giftExternalId)}:${donorId}`
  if(!existing.has(`softCredit:${await sourceKey(s.externalId)}`)) {
   if(credited.has(pair))diagnostic(`Soft credit ${s.externalId}: gift ${s.giftExternalId} already credits constituent ${s.donorExternalId} in Coffer. Delete this row, or remove the credit in Coffer first.`,s.location)
   credited.add(pair)
  }
  await add('softCredit',s,{gift_id:plan.giftIds.get(s.giftExternalId)||'',donor_id:donorId,amount_cents:s.amountCents,created_at:c.now,created_by:c.actor.name},undefined,donorId,plan.donorIds.get(gift?.donorExternalId||''))
 }
 for(const n of parsed.notes) {
  const donorId=donor(n.donorExternalId,n.location)
  if(['call','meeting','email'].includes(n.type))await add('interaction',n,{donor_id:donorId,kind:n.type,occurred_on:n.date,who:`${source} export`,notes:n.text,next_step:null,recorded_at:c.now,recorded_by:c.actor.name},undefined,donorId)
  else await add('note',n,{donor_id:donorId,occurred_on:n.date,body:n.text,source,recorded_at:c.now,recorded_by:c.actor.name},undefined,donorId)
 }
 // Never expose a partial transaction as an option when inputs exceed D1's bound.
 if(!preview && plan.effects.length>3000)fail('MOVE_IN_LIMIT','Split this export into smaller reviews (at most 1,000 source rows).',400)
 return plan
}

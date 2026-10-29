import { all, sha256, type Context, type Row } from '../db'
import type { OutcomeTotals, ParsedImport } from './types'

export const inventoryScopes = ['constituents','open pledge','consent','active plan','historical receipt'] as const
type Inventory = Pick<OutcomeTotals,typeof inventoryScopes[number]>
export type InventoryKeys = {donor:string[];pledge:string[]}
const channels=['email','mail','phone','sms']
export function emptyInventory():Inventory {
 const out=Object.fromEntries(inventoryScopes.map(scope=>[scope,Object.create(null)])) as Inventory
 for(const scope of ['constituents','open pledge','active plan'] as const)out[scope].all={giftCount:0,amountCents:0}
 for(const channel of channels)for(const status of ['granted','withdrawn','unknown'])out.consent[channel+' '+status]={giftCount:0,amountCents:0}
 for(const method of ['email','letter','other','unknown'])out['historical receipt'][method]={giftCount:0,amountCents:0}
 return out
}
const add=(out:Inventory,scope:keyof Inventory,key:string,cents=0)=>{const row=out[scope][key]??={giftCount:0,amountCents:0};row.giftCount++;row.amountCents+=cents}
export function receiptOutcome(out:Inventory,status:string,method:string|null,cents:number) {
 if(status==='acknowledged')add(out,'historical receipt',method==='email'||method==='letter'?method:method?'other':'unknown',cents)
}
function constituent(out:Inventory,status:string){add(out,'constituents','all');add(out,'constituents',status)}
function openPledge(out:Inventory,cents:number){if(cents>0)add(out,'open pledge','all',cents)}
export function parsedInventory(p:ParsedImport):Inventory {
 const out=emptyInventory()
 out['active plan']=Object.create(null)
 const preferences=new Map((p.channelWithdrawals??[]).map(r=>[r.donorExternalId+':'+r.channel,r])),paid=new Map<string,number>()
 for(const g of p.gifts)if(g.pledgeExternalId)paid.set(g.pledgeExternalId,(paid.get(g.pledgeExternalId)??0)+g.amountCents)
 for(const d of p.donors){
  constituent(out,d.constituentStatus||'active')
  for(const channel of channels){const source=preferences.get(d.externalId+':'+channel);add(out,'consent',channel+' '+(source?(source.status??'withdrawn'):'unknown'))}
 }
 for(const pledge of p.pledges)openPledge(out,Math.max(0,pledge.amountCents-(paid.get(pledge.externalId)??0)))
 for(const g of p.gifts)receiptOutcome(out,g.acknowledgment?.status??'not acknowledged',g.acknowledgment?.method??null,g.amountCents)
 return out
}
const pledgePaid=`COALESCE((SELECT SUM(g.amount_cents-CASE WHEN g.kind='reversal' THEN -1 ELSE 1 END*COALESCE((SELECT SUM(a.amount_cents) FROM cf_pledge_allocations a WHERE a.gift_id=COALESCE(g.reverses,g.id)),0)) FROM cf_monetary_contributions g WHERE g.pledge_id=p.id),0)+COALESCE((SELECT SUM(i.paid_cents) FROM cf_pledge_balances i WHERE i.pledge_id=p.id),0)`
async function members(c:Context,source:string,kind:keyof InventoryKeys,keys:string[],jobId?:string,matches:Record<string,string>={}) {
 const rows:Row[]=[]
 for(const batch of jobId?[null]:Array.from({length:Math.ceil(keys.length/1000)},(_,i)=>keys.slice(i*1000,(i+1)*1000))) {
  const where=jobId?'r.source_key IN(SELECT source_key FROM cf_move_in_inventory_refs WHERE job_id=? AND kind=?)':'r.source_key IN(SELECT value FROM json_each(?))'
  if(jobId&&kind==='donor'){rows.push(...await all(c,`SELECT ref.source_key,d.id,d.version,d.constituent_status FROM cf_move_in_inventory_refs ref LEFT JOIN cf_move_in_records r ON r.source=? AND r.kind='donor' AND r.source_key=ref.source_key LEFT JOIN cf_donor_merges m ON m.donor_id=COALESCE(r.native_id,ref.native_id) JOIN cf_donors d ON d.id=COALESCE(m.into_id,r.native_id,ref.native_id) AND d.erased_at IS NULL WHERE ref.job_id=? AND ref.kind='donor'`,source,jobId));continue}
  const query=kind==='donor'?`SELECT r.source_key,d.id,d.version,d.constituent_status FROM cf_move_in_records r LEFT JOIN cf_donor_merges m ON m.donor_id=r.native_id JOIN cf_donors d ON d.id=COALESCE(m.into_id,r.native_id) AND d.erased_at IS NULL`:`SELECT r.source_key,p.id,p.version,MAX(0,p.amount_cents-p.reduced_cents-(${pledgePaid})) AS remaining_cents FROM cf_move_in_records r JOIN cf_pledge_totals p ON p.id=r.native_id JOIN cf_donors d ON d.id=p.donor_id AND d.erased_at IS NULL`
  rows.push(...await all(c,`${query} WHERE r.source=? AND r.kind=? AND ${where}`,source,kind,...(jobId?[jobId,kind]:[JSON.stringify(batch)])))
 }
 if(!jobId&&kind==='donor'){const seen=new Set(rows.map(r=>r.source_key)),entries=Object.entries(matches).filter(([key])=>!seen.has(key));for(let i=0;i<entries.length;i+=1000){const chunk=entries.slice(i,i+1000),found=await all(c,`SELECT d.id,d.version,d.constituent_status,requested.value AS requested_id FROM json_each(?) requested LEFT JOIN cf_donor_merges m ON m.donor_id=requested.value JOIN cf_donors d ON d.id=COALESCE(m.into_id,requested.value) AND d.erased_at IS NULL`,JSON.stringify([...new Set(chunk.map(([,id])=>id))]));const byId=new Map(found.map(d=>[d.requested_id,d]));for(const [source_key,id] of chunk){const row=byId.get(id);if(row){const {requested_id,...data}=row;rows.push({source_key,...data})}}}}
 return rows.sort((a,b)=>a.source_key.localeCompare(b.source_key))
}
export async function inventorySnapshot(c:Context,source:string,keys:InventoryKeys,jobId?:string,matches:Record<string,string>={}) {
 const [donors,pledges]=await Promise.all([members(c,source,'donor',keys.donor,jobId,matches),members(c,source,'pledge',keys.pledge,jobId)])
 const ids=[...new Set(donors.map(d=>d.id))],consents:Row[]=[],plans:Row[]=[]
 for(let offset=0;offset<ids.length;offset+=1000){
  const batch=JSON.stringify(ids.slice(offset,offset+1000))
  const [preferences,subscriptions]=await Promise.all([
   all(c,`SELECT k.id,k.donor_id,k.channel,k.status FROM cf_consents k WHERE k.donor_id IN(SELECT value FROM json_each(?)) AND k.id=(SELECT MAX(id) FROM cf_consents WHERE donor_id=k.donor_id AND channel=k.channel) ORDER BY k.id`,batch),
   all(c,'SELECT id,donor_id,amount_cents,status,updated_at FROM cf_subscriptions WHERE donor_id IN(SELECT value FROM json_each(?)) ORDER BY id',batch),
  ])
  consents.push(...preferences);plans.push(...subscriptions)
 }
 consents.sort((a,b)=>a.id-b.id);plans.sort((a,b)=>a.id.localeCompare(b.id))
 return {donors,pledges,consents,plans,fingerprint:await sha256(JSON.stringify([donors,pledges,consents,plans]))}
}
type Snapshot=Awaited<ReturnType<typeof inventorySnapshot>>
function totals(snapshot:Snapshot):Inventory {
 const out=emptyInventory(),preferences=new Map(snapshot.consents.map(k=>[k.donor_id+':'+k.channel,k.status]))
 for(const d of new Map(snapshot.donors.map(d=>[d.id,d])).values()){
  constituent(out,d.constituent_status)
  for(const channel of channels)add(out,'consent',channel+' '+(preferences.get(d.id+':'+channel)??'unknown'))
 }
 for(const p of snapshot.pledges)openPledge(out,p.remaining_cents)
 for(const p of snapshot.plans)if(p.status==='active')add(out,'active plan','all',p.amount_cents)
 return out
}
export async function previewInventory(c:Context,p:ParsedImport,heldGiftKeys:Set<string>=new Set()) {
 const keys={donor:await Promise.all(p.donors.map(d=>sha256(d.externalId))),pledge:await Promise.all(p.pledges.map(d=>sha256(d.externalId)))}
 const matches=Object.fromEntries(p.donors.flatMap((d,i)=>d.expectedNativeId||d.match?.id?[[keys.donor[i],d.expectedNativeId??d.match!.id]]:[]))
 const snapshot=await inventorySnapshot(c,p.source,keys,undefined,matches),paid=new Map<string,number>()
 for(const gift of p.gifts)if(gift.pledgeExternalId&&!heldGiftKeys.has(await sha256(gift.externalId)))paid.set(gift.pledgeExternalId,(paid.get(gift.pledgeExternalId)??0)+gift.amountCents)
 const pledgeSource=new Map(keys.pledge.map((key,i)=>[key,p.pledges[i].externalId]))
 for(const pledge of snapshot.pledges)pledge.remaining_cents=Math.max(0,pledge.remaining_cents-(paid.get(pledgeSource.get(pledge.source_key)??'')??0))
 const out=totals(snapshot),seen=new Set(snapshot.donors.map(d=>d.source_key)),pledges=new Set(snapshot.pledges.map(p=>p.source_key))
 const natives=new Map(snapshot.donors.map(d=>[d.source_key,d.id])),donorIds=new Map(p.donors.map((d,i)=>[d.externalId,natives.get(keys.donor[i])])),current=new Set(snapshot.consents.map(k=>k.donor_id+':'+k.channel))
 for(const preference of p.channelWithdrawals??[]){const id=donorIds.get(preference.donorExternalId);if(id&&!current.has(id+':'+preference.channel)){out.consent[preference.channel+' unknown'].giftCount--;out.consent[preference.channel+' '+(preference.status??'withdrawn')].giftCount++;current.add(id+':'+preference.channel)}}
 const projected=parsedInventory({...p,donors:p.donors.filter((_,i)=>!seen.has(keys.donor[i])),pledges:p.pledges.filter((_,i)=>!pledges.has(keys.pledge[i]))})
 for(const scope of ['constituents','consent','open pledge'] as const)for(const [key,row] of Object.entries(projected[scope])){const to=out[scope][key]??={giftCount:0,amountCents:0};to.giftCount+=row.giftCount;to.amountCents+=row.amountCents}
 return {keys,natives:matches,totals:out,fingerprint:snapshot.fingerprint}
}
export async function nativeInventory(c:Context,job:Row){return totals(await inventorySnapshot(c,job.source,{donor:[],pledge:[]},job.id))}

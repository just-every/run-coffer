import { all, fail, integer, text, type Context, type Row } from '../db'
import { solicitationState } from '../solicitation'
import { withGiftAcknowledgments } from '../gift-acknowledgments'
import { allGiftAllocations } from '../gift-splits'
import { withReceiptBenefits } from '../receipt-rules'
import { pledgeHistory } from '../pledges'
import { subscriptions, campaigns } from '../giving/campaigns'
import { donorDepth } from '../donor-depth'
import { donorGiftDepth } from '../gift-depth'
import { callTasks } from '../call-tasks'
import { prospects } from '../major-gifts'
import { restrictionReport } from '../restricted-funds'
import type { ApiScope } from './keys'

export const API_RESOURCES=['donors','gifts','pledges','plans','interactions','tasks','opportunities','funds','campaigns','soft-credits'] as const
export type ApiResource=typeof API_RESOURCES[number]
const live=`d.erased_at IS NULL AND NOT EXISTS(SELECT 1 FROM cf_donor_merges m WHERE m.donor_id=d.id)`
const pick=(row:Row,fields:string[])=>Object.fromEntries(fields.filter(f=>row[f]!==undefined).map(f=>[f,row[f]]))
const donorFields='id version name email phone address_line1 address_line2 city region postal_code country constituent_kind constituent_status deceased_on status_reason'.split(' ')
const giftFields='id version donor_id kind reverses received_on amount_cents method reference fund pledge_id goods goods_cents goods_description source created_at'.split(' ')
const planFields='id donor_id campaign_id amount_cents status cancel_at_period_end failed_attempts recovered next_attempt_at updated_at campaign interval interval_count collection_paused'.split(' ')

async function resourceRows(c:Context,resource:ApiResource,url:URL,recordId?:string):Promise<Row[]>{
 const donorId=url.searchParams.get('donorId'),after=recordId??url.searchParams.get('after')??''
 const limit=recordId?1:integer(Number(url.searchParams.get('limit')??50),'Limit',1,50)+1
 // The SQL query chooses a bounded page before invoking shared native projections.
 const select=async(table:string,alias:string,columns:string)=>all(c,`SELECT ${columns} FROM ${table} ${alias} JOIN cf_donors d ON d.id=${alias}.donor_id
  WHERE ${live} AND (? IS NULL OR d.id=?) AND ${alias}.id${recordId?'=':'>'}? ORDER BY ${alias}.id LIMIT ?`,donorId,donorId,after,limit)
 if(resource==='donors'){
  const rows=await all(c,`SELECT d.* FROM cf_donors d WHERE ${live} AND (? IS NULL OR d.id=?) AND d.id${recordId?'=':'>'}? ORDER BY d.id LIMIT ?`,donorId,donorId,after,limit)
  const ids=JSON.stringify(rows.map(d=>d.id))
  const [restrictions,consents]=await Promise.all([solicitationState(c,rows.map(d=>d.id)),all(c,`SELECT k.donor_id,k.channel,k.status,k.captured_on,k.method FROM cf_consents k WHERE k.donor_id IN (SELECT value FROM json_each(?)) AND k.id=(SELECT MAX(id) FROM cf_consents WHERE donor_id=k.donor_id AND channel=k.channel)`,ids)])
  return rows.map(d=>({...pick(d,donorFields),consents:consents.filter(k=>k.donor_id===d.id),solicitation:restrictions.find(r=>r.donor_id===d.id)}))
 }
 if(resource==='gifts'){
  const rows=await select('cf_gifts','g','g.*')
  await Promise.all([withGiftAcknowledgments(c,rows),withReceiptBenefits(c,rows)])
  const allocations=await allGiftAllocations(c,rows.map(g=>g.id))
  return rows.map(g=>({...pick(g,giftFields),acknowledgment:g.acknowledgment,allocations:allocations.filter(a=>a.gift_id===(g.reverses??g.id))}))
 }
 if(resource==='pledges'||resource==='plans'||resource==='interactions'||resource==='soft-credits'){
  const table={pledges:'cf_pledges',plans:'cf_subscriptions',interactions:'cf_interactions','soft-credits':'cf_soft_credits'}[resource]
  const rows=await select(table,'r','r.id,r.donor_id')
  const byDonor=new Map<string,Row[]>()
  await Promise.all([...new Set(rows.map(r=>String(r.donor_id)))].map(async id=>{
   const data=resource==='pledges'?await pledgeHistory(c,id):resource==='plans'?await subscriptions(c,id):resource==='interactions'?(await donorDepth(c,id)).interactions:(await donorGiftDepth(c,id)).creditedGifts
   byDonor.set(id,data)
  }))
  return rows.map(r=>byDonor.get(r.donor_id)?.find(v=>v.id===r.id)).filter((r):r is Row=>Boolean(r)).map(r=>resource==='plans'?pick(r,planFields):r)
 }
 // These readers own the native computed projection (holds, forecasting and
 // fund release amounts); never recreate those calculations in the API.
 const data=resource==='tasks'?await callTasks(c):resource==='opportunities'?await prospects(c):resource==='funds'?(await restrictionReport(c,url)).funds:await campaigns(c,true)
 return data.map(r=>resource==='funds'?{...r,id:r.fund}:r).filter(r=>(recordId?r.id===after:r.id>after)&&(!donorId||r.donor_id===donorId)).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0).slice(0,limit)
}

export async function readResource(c:Context,scope:ApiScope,path:string,url:URL):Promise<Row|null>{
 const match=path.match(/^\/([a-z-]+)(?:\/([^/]+))?(?:\/(solicitation|consents|status|acknowledgment))?$/)
 if(!match||!API_RESOURCES.includes(match[1] as ApiResource))return null
 const resource=match[1] as ApiResource,recordId=match[2]?text(decodeURIComponent(match[2]),'Record identifier',100):undefined,part=match[3]
 if(scope==='gift-entry'&&!['donors','gifts','pledges','funds','campaigns'].includes(resource))fail('SCOPE_FORBIDDEN','This gift-entry key cannot read this resource.',403)
 if(part&&(!recordId||!(resource==='donors'&&['solicitation','consents','status'].includes(part)||['gifts','soft-credits'].includes(resource)&&part==='acknowledgment')))return null
 const rows=await resourceRows(c,resource,url,recordId)
 if(recordId){
  const row=rows[0];if(!row)fail('NOT_FOUND','That current record does not exist.',404)
  const data=part==='status'?pick(row,['id','version','constituent_status','deceased_on','status_reason']):part==='solicitation'?row.solicitation:part==='consents'?row.consents:part==='acknowledgment'?row.acknowledgment:row
  return {data}
 }
 const limit=integer(Number(url.searchParams.get('limit')??50),'Limit',1,50),page=rows.slice(0,limit)
 return {data:page,page:{next:rows.length>limit?page.at(-1)?.id??null:null}}
}

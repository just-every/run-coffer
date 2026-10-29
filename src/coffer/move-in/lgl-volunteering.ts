import { CofferError, all, sha256, type Context, type Row } from '../db'
import { volunteerMinutes } from '../volunteering'
import type { SourceRow } from './source-rows'
import type { ParsedImport, ParsedVolunteering, VolunteerTotal } from './types'
import type { Difference } from './reconcile'

/** LGL's configured volunteer report is distinct from fundraising transactions. */
export function lglVolunteerRow(r:SourceRow,out:ParsedImport){
 const externalId=r.required('volunteerId'),donorExternalId=r.required('donorId'),role=r.required('volunteerRole'),occurredOn=r.date('volunteerDate')
 for(const field of ['type','volunteerClassification','volunteerHoursType']){
  const classification=r.get(field).toLowerCase().replace(/[^a-z0-9]/g,'')
  if(classification&&!['volunteer','volunteering','volunteertime','actual','completed'].includes(classification))r.error('VOLUNTEER_CLASSIFICATION','Export completed volunteer time only; this classification is unsupported.',field)
 }
 if(r.get('volunteerCommitment'))r.error('VOLUNTEER_CLASSIFICATION','Volunteer commitments need separate review and cannot become completed service.','volunteerCommitment')
 const hours=r.get('volunteerHours'),rawMinutes=r.get('volunteerMinutes')
 let minutes=0
 try{
  if(rawMinutes){if(!/^\d+$/.test(rawMinutes))throw new CofferError('INPUT','Volunteer minutes must be a whole number from 1 to 1440.',400);minutes=Number(rawMinutes)}
  else minutes=volunteerMinutes(hours)
  if(!Number.isSafeInteger(minutes)||minutes<1||minutes>1440)throw new CofferError('INPUT','Volunteer minutes must be a whole number from 1 to 1440.',400)
  if(hours&&rawMinutes&&volunteerMinutes(hours)!==minutes)throw new CofferError('INPUT','Volunteer hours and minutes disagree.',400)
 }catch(error){if(!(error instanceof CofferError))throw error;r.error('VOLUNTEER_DURATION',error.message,'volunteerHours');return}
 if(externalId&&donorExternalId&&role&&occurredOn)(out.volunteering??=[]).push({externalId,donorExternalId,role,occurredOn,minutes,location:r.location})
}
export function volunteerTotals(rows:ParsedVolunteering[]):VolunteerTotal[]{
 const groups=new Map<string,VolunteerTotal>()
 for(const v of rows){const year=v.occurredOn.slice(0,4),key=JSON.stringify([v.donorExternalId,year]),total=groups.get(key)??{donorExternalId:v.donorExternalId,year,minutes:0,activities:0};total.minutes+=v.minutes;total.activities++;groups.set(key,total)}
 return [...groups.values()].sort((a,b)=>a.donorExternalId.localeCompare(b.donorExternalId)||a.year.localeCompare(b.year))
}
/** Compare the saved source controls with native activities, never with cash. */
export async function volunteerReconciliation(c:Context,job:Row,report:Row):Promise<Difference[]>{
 const expected:VolunteerTotal[]=report.volunteerTotals??[]
 if(!expected.length)return []
 const sourceIds=new Map(await Promise.all(expected.map(async v=>[await sha256(v.donorExternalId),v.donorExternalId] as const)))
 const actual=await all(c,`SELECT r.donor_source_key,substr(v.occurred_on,1,4) AS year,sum(v.minutes) AS minutes,count(*) AS activities FROM cf_move_in_job_volunteering r JOIN cf_volunteering v ON v.id=r.activity_id WHERE r.job_id=? GROUP BY r.donor_source_key,substr(v.occurred_on,1,4)`,job.id)
 const keys=new Set([...expected.map(v=>JSON.stringify([v.donorExternalId,v.year])),...actual.map(v=>JSON.stringify([sourceIds.get(v.donor_source_key)??v.donor_source_key,v.year]))])
 return [...keys].map(key=>{
  const [donor,year]=JSON.parse(key),source=expected.find(v=>v.donorExternalId===donor&&v.year===year),destination=actual.find(v=>sourceIds.get(v.donor_source_key)===donor&&v.year===year)
  const minutes=source?.minutes??0,actualMinutes=destination?.minutes??0,count=source?.activities??0,actualCount=destination?.activities??0
  return {scope:'volunteering',key:`${donor} · ${year}: ${minutes} source minutes; ${actualMinutes} Coffer minutes`,sourceCount:count,cofferCount:actualCount,sourceCents:null,cofferCents:0,matches:minutes===actualMinutes&&count===actualCount}
 })
}

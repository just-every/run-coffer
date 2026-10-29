import { all, commit, date, event, fail, guard, id, newId, optional, sql, text, today, type Context, type Row, type Stmt } from './db'
import { settings } from './settings'
import { parseCsv } from './move-in/parse-input'
import { csv } from './csv'

/** Decimal hours are accepted only when they represent a whole minute. */
export function volunteerMinutes(value: unknown) {
 const raw=String(value??'').trim()
 if(!/^\d+(\.\d{1,10})?$/.test(raw))fail('INPUT','Hours must be a positive decimal number representing whole minutes.',400)
 const amount=Number(raw)*60, rounded=Math.round(amount)
 if(!Number.isSafeInteger(rounded)||Math.abs(amount-rounded)>0.000001||rounded<1||rounded>1440)fail('INPUT','Hours must represent 1–1440 whole minutes per dated activity.',400)
 return rounded
}
export function volunteerActivity(input: Row, day: string) {
 const donorId=id(input.donorId,'Donor'),role=text(input.role,'Volunteer role',200),on=date(input.occurredOn,'Volunteer date')
 const duration=input.minutes===undefined?volunteerMinutes(input.hours):input.minutes
 if(!Number.isSafeInteger(duration)||duration<1||duration>1440)fail('INPUT','Hours must represent 1–1440 whole minutes per dated activity.',400)
 if(on>day)fail('INPUT','Volunteer activity cannot be in the future.',400)
 return {donor_id:donorId,role,occurred_on:on,minutes:duration,source:text(input.source,'Source',100),source_key:optional(input.sourceKey,'Source activity ID',200)}
}
export async function volunteering(c: Context, donorId?: string, year?: string) {
 if(year&&!/^\d{4}$/.test(year))fail('INPUT','Choose a four-digit calendar year.',400)
 const rows=await all(c,`SELECT v.*,d.name FROM cf_volunteering v JOIN cf_donors d ON d.id=v.donor_id
 WHERE d.erased_at IS NULL AND (? IS NULL OR v.donor_id=?) AND (? IS NULL OR substr(v.occurred_on,1,4)=?) ORDER BY v.occurred_on DESC,v.id`,donorId??null,donorId??null,year??null,year??null)
 const totals=new Map<string,{donorId:string;name:string;year:string;minutes:number;hours:number}>()
 for(const row of rows){const key=row.donor_id+row.occurred_on.slice(0,4),sum=totals.get(key)??{donorId:row.donor_id,name:row.name,year:row.occurred_on.slice(0,4),minutes:0,hours:0};sum.minutes+=row.minutes;sum.hours=sum.minutes/60;totals.set(key,sum)}
 return {rows:rows.map((r):Row=>({...r,hours:r.minutes/60})),years:[...totals.values()],minutes:rows.reduce((sum,r)=>sum+r.minutes,0)}
}
export async function volunteerCsv(c:Context,year?:string){const report=await volunteering(c,undefined,year);return csv(['Donor ID','Name','Year','Minutes','Hours'],report.years.map(r=>[r.donorId,r.name,r.year,r.minutes,r.hours]))}

export async function volunteerCommand(c:Context,command:string,p:Row):Promise<Row|undefined>{
 if(!['volunteer.record','volunteer.import'].includes(command))return undefined
 const day=today((await settings(c)).timezone,new Date(c.now)),writes:Stmt[]=[],ids:string[]=[]
 let inputs:Row[]
 if(command==='volunteer.import'){
  let parsed;try{parsed=parseCsv(text(p.csv,'Volunteer CSV',800000))}catch(error){fail('INPUT',String(error),400)}
  const header=parsed.shift()?.map(x=>String(x).trim())??[]
  const required=['donor_id','role','date','hours','source_id'];if(required.some(key=>!header.includes(key))||new Set(header).size!==header.length)fail('INPUT','CSV needs unique donor_id, role, date, hours and source_id columns. Map VolunteerHub or Galaxy Digital exports to these columns.',400)
  if(!parsed.length||parsed.length>200)fail('INPUT','Import 1–200 volunteer activities at a time.',400)
  const source=text(p.source,'Source system',100)
  inputs=parsed.map(row=>Object.fromEntries(header.map((key,i)=>[key,row[i]??'']))).map(row=>({donorId:row.donor_id,role:row.role,occurredOn:row.date,hours:row.hours,source,sourceKey:row.source_id}))
 }else inputs=[{...p,source:'Manual',sourceKey:null}]
 const seen=new Set<string>()
 for(const input of inputs){
  const {donor_id:donorId,role,occurred_on:on,minutes:duration,source,source_key:sourceKey}=volunteerActivity({...input,minutes:undefined},day),activityId=newId()
  if(command==='volunteer.import'&&!sourceKey)fail('INPUT','Every imported activity needs its source_id.',400)
  const key=source+'\n'+sourceKey;if(sourceKey&&seen.has(key))fail('INPUT','The CSV repeats a source activity ID.',400);seen.add(key)
  writes.push(guard('EXISTS(SELECT 1 FROM cf_donors d WHERE id=? AND erased_at IS NULL AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=d.id))','DONOR_CHANGED','Choose an active, unmerged donor record.',donorId))
  if(sourceKey)writes.push(guard('NOT EXISTS(SELECT 1 FROM cf_volunteering WHERE source=? AND source_key=?)','VOLUNTEER_DUPLICATE','This source activity is already recorded. Nothing was imported.',source,sourceKey))
  writes.push(sql('INSERT INTO cf_volunteering VALUES(?,?,?,?,?,?,?,?,?)',activityId,donorId,role,on,duration,source,sourceKey,c.now,c.actor.name),event(c,command,'volunteering',activityId,donorId,{minutes:duration,occurredOn:on}));ids.push(activityId)
 }
 await commit(c,writes)
 return {ids,recorded:ids.length,donorId:inputs.length===1?inputs[0].donorId:null}
}

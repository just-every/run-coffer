import { organizationFields } from './organizations'
import { requireRole } from './auth'
import { all, commit, event, fail, guard, id, integer, newId, one, sql, text, type Context, type Row } from './db'
import { NAME_FIELDS, computedHouseholdNames, householdDefaults, householdMembers, HOUSEHOLD_TOKENS } from './household-names'
import { householdTotals } from './household-totals'
import { STATUSES, statusChange } from './status'

export async function householdState(c:Context,householdId:string,query:{year?:number,basis?:'calendar'|'fiscal'}={}) {
 const household=await one(c,'SELECT * FROM cf_households WHERE id=?',householdId)
 if(!household)fail('NOT_FOUND','That household does not exist.',404)
 const [members,defaults,totals]=await Promise.all([householdMembers(c,householdId),householdDefaults(c),householdTotals(c,householdId,query)])
 const computed=computedHouseholdNames(members,household.head_donor_id,defaults)
 const names={addressee:household.addressee_override??computed.addressee,formal:household.formal_override??computed.formal,informal:household.informal_override??computed.informal}
 const head=members.find(m=>m.id===household.head_donor_id)
 return {household,members,names,computed,defaults,headStatus:head?.constituent_status==='deceased'?'deceased':head?'selected':'none',totals}
}
export async function householdCommand(c:Context,command:string,p:Row):Promise<Row|undefined> {
 if(command==='donor.profile') {
  requireRole(c.actor,['owner','admin','member'],'edit name parts')
  const donorId=id(p.donorId,'Donor'),version=integer(p.version,'Donor version',1)
  const donor=await one(c,'SELECT * FROM cf_donors WHERE id=? AND erased_at IS NULL AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=cf_donors.id)',donorId)
  if(!donor)fail('NOT_FOUND','Open a current donor record.',404)
  const fields=Object.entries(NAME_FIELDS),values=fields.map(([key,column])=>p[key]===undefined?donor[column]:p[key]===null||p[key]===''?null:text(p[key],key,100))
  const kind=p.constituentKind??donor.constituent_kind,status=p.constituentStatus??donor.constituent_status
  if(!['person','organization'].includes(kind)||!STATUSES.includes(status))fail('INPUT','Choose a constituent type and status.',400)
  const org=organizationFields(p,donor),change=await statusChange(c,donor,p,status)
  const h=donor.household_id?await one(c,'SELECT * FROM cf_households WHERE id=?',donor.household_id):null
  if(h?.head_donor_id===donorId&&kind==='organization')fail('HEAD_INELIGIBLE','Clear this household head before changing to an organization.')
  await commit(c,[guard('EXISTS(SELECT 1 FROM cf_donors WHERE id=? AND version=? AND erased_at IS NULL)','VERSION','This donor changed. Refresh before saving.',donorId,version),...(h?[guard('EXISTS(SELECT 1 FROM cf_households WHERE id=? AND version=?)','VERSION','The household changed. Refresh before saving.',h.id,p.householdVersion??h.version)]:[]),sql(`UPDATE cf_donors SET version=version+1,${fields.map(([,column])=>column+'=?').join(',')},constituent_kind=?,constituent_status=?,status_reason=?,deceased_on=?,status_changed_at=?,status_changed_by=?,organization_type=?,website=?,ein=?,informal_salutation=? WHERE id=?`,...values,kind,status,change.columns.status_reason,change.columns.deceased_on,change.columns.status_changed_at,change.columns.status_changed_by,org.organizationType,org.website,org.ein,org.salutation,donorId),...(h?[sql('UPDATE cf_households SET version=version+1 WHERE id=?',h.id),event(c,'household.names','household',h.id,null,{oldHead:h.head_donor_id,newHead:h.head_donor_id,overridesSet:[],overridesCleared:[]})]:[]),event(c,command,'donor',donorId,donorId,{status,kind}),...change.after])
  return {id:donorId,version:version+1}
 }
 if(command==='household.defaultsPreview') {
  requireRole(c.actor,['owner','admin'],'change household defaults')
  return {defaults:await householdDefaults(c),affected:await all(c,'SELECT id FROM cf_households WHERE addressee_override IS NULL OR formal_override IS NULL OR informal_override IS NULL')}
 }
 if(command==='household.defaults') {
  requireRole(c.actor,['owner','admin'],'change household defaults')
  const version=integer(p.version,'Version',1),affected=integer(p.affectedCount,'Reviewed household count')
  const templates=['addressee','formal','informal'].map(key=>{
   const value=text(p[key],key,500)
   if([...value.matchAll(/{{(.*?)}}/g)].some(m=>!HOUSEHOLD_TOKENS.includes(m[1] as any))||/[{}]/.test(value.replace(/{{\w+}}/g,'')))fail('INPUT','Use only the listed household name fields.',400)
   return value
  })
  await commit(c,[guard('EXISTS(SELECT 1 FROM cf_household_defaults WHERE id=1 AND version=?)','VERSION','Household defaults changed. Preview again.',version),guard('(SELECT count(*) FROM cf_households WHERE addressee_override IS NULL OR formal_override IS NULL OR informal_override IS NULL)=?','VERSION','The household count changed. Preview again.',affected),sql('UPDATE cf_household_defaults SET version=version+1,addressee=?,formal=?,informal=? WHERE id=1',...templates),sql('UPDATE cf_households SET version=version+1 WHERE addressee_override IS NULL OR formal_override IS NULL OR informal_override IS NULL'),event(c,command,'householdDefaults','1',null,{affected})])
  return {version:version+1,affected}
 }
 if(command==='household.confirmNames') {
  requireRole(c.actor,['owner','admin','member'],'confirm household names')
  const householdId=id(p.householdId,'Household'),version=integer(p.version,'Household version',1),state=await householdState(c,householdId)
  await commit(c,[guard('EXISTS(SELECT 1 FROM cf_households WHERE id=? AND version=? AND survivor_review=1)','VERSION','These names were already confirmed, or the household changed. Refresh before confirming.',householdId,version),sql('UPDATE cf_households SET survivor_review=0,version=version+1 WHERE id=?',householdId),event(c,command,'household',householdId,null,{names:state.names})])
  return {id:householdId,version:version+1,names:state.names}
 }
 if(command!=='household.update')return undefined
 requireRole(c.actor,['owner','admin','member'],'edit households')
 const householdId=id(p.householdId,'Household'),version=integer(p.version,'Household version',1),state=await householdState(c,householdId)
 const headId=p.headDonorId===undefined?state.household.head_donor_id:p.headDonorId===''||p.headDonorId===null?null:id(p.headDonorId,'Head')
 const override=(key:string)=>{
  if(p[key]===undefined)return state.household[key]
  if(p[key]===null||p[key]==='')return null
  const value=p[key];text(value,key,500);return value // preserve exactly as typed
 }
 const overrides=['addressee_override','formal_override','informal_override'].map(override)
 await commit(c,[guard('EXISTS(SELECT 1 FROM cf_households WHERE id=? AND version=?)','VERSION','This household changed. Refresh before saving.',householdId,version),guard(`? IS NULL OR EXISTS(SELECT 1 FROM cf_donors d WHERE id=? AND household_id=? AND erased_at IS NULL AND constituent_kind='person' AND constituent_status<>'deceased' AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=d.id))`,'HEAD_INELIGIBLE','Choose a living person who is a current household member.',p.headDonorId===undefined?null:headId,headId,householdId),sql('UPDATE cf_households SET version=version+1,head_donor_id=?,head_source=NULL,head_imported_at=NULL,addressee_override=?,formal_override=?,informal_override=? WHERE id=?',headId,...overrides,householdId),event(c,command,'household',householdId,null,{oldHead:state.household.head_donor_id,newHead:headId,overridesSet:['addressee','formal','informal'].filter((_,i)=>overrides[i]!==null),overridesCleared:['addressee','formal','informal'].filter((_,i)=>overrides[i]===null)})])
 return {id:householdId,version:version+1}
}

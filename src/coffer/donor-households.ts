import { event, guard, one, sql, type Context, type Row, type Stmt } from './db'

/** Fence both sides of a membership change inside the donor transaction. */
export async function membershipChange(c:Context,donorId:string,oldId:string|null,newName:string|null,p:Row={}) {
 const target=newName?await one(c,'SELECT * FROM cf_households WHERE lower(name)=lower(?)',newName):null
 const creation:Stmt[]=!target&&newName?[sql(`INSERT INTO cf_events(at,actor_id,actor_name,actor_role,action,subject_kind,subject_id,donor_id,detail) SELECT ?,?,?,?,'household.membership','household',id,NULL,json_object('member',?,'change','added','oldHead',NULL,'newHead',NULL,'overridesSet',json('[]'),'overridesCleared',json('[]')) FROM cf_households WHERE lower(name)=lower(?)`,c.now,c.actor.id,c.actor.name,c.actor.role,donorId,newName)]:[]
 if(oldId===(target?.id??null)) {
  if(!target)return {before:[] as Stmt[],after:creation}
  return {before:[guard('EXISTS(SELECT 1 FROM cf_households WHERE id=? AND version=?)','VERSION','This household changed. Refresh before saving.',target.id,p.householdVersion??target.version)],after:[sql('UPDATE cf_households SET version=version+1 WHERE id=?',target.id),event(c,'household.names','household',target.id,null,{oldHead:target.head_donor_id,newHead:target.head_donor_id,overridesSet:[],overridesCleared:[]})]}
 }
 const old=oldId?await one(c,'SELECT * FROM cf_households WHERE id=?',oldId):null
 const households=[old,target].filter(Boolean) as Row[]
 const before=households.map(h=>guard('EXISTS(SELECT 1 FROM cf_households WHERE id=? AND version=?)','VERSION','A household changed. Refresh before moving this member.',h.id,h.id===oldId?(p.householdVersion??h.version):(p.targetHouseholdVersion??h.version)))
 const after:Stmt[]=[...creation]
 for(const h of households) {
  const cleared=h.id===oldId&&h.head_donor_id===donorId
  after.push(sql('UPDATE cf_households SET version=version+1,head_donor_id=CASE WHEN ? THEN NULL ELSE head_donor_id END,head_source=CASE WHEN ? THEN NULL ELSE head_source END,head_imported_at=CASE WHEN ? THEN NULL ELSE head_imported_at END,overrides_review=CASE WHEN addressee_override IS NOT NULL OR formal_override IS NOT NULL OR informal_override IS NOT NULL THEN 1 ELSE overrides_review END WHERE id=?',cleared?1:0,cleared?1:0,cleared?1:0,h.id),event(c,'household.membership','household',h.id,null,{member:donorId,change:h.id===oldId?'removed':'added',oldHead:h.head_donor_id,newHead:cleared?null:h.head_donor_id,overridesSet:[],overridesCleared:[]}))
 }
 return {before,after}
}

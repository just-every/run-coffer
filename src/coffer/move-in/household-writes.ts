import { event, guard, sql, type Context, type Row, type Stmt } from '../db'
import { snapshot } from './tables'

export type HouseholdChange = {before:Row|null;after:Row;sourceKey:string}

/** Donors are inserted before a source head is made effective. Every change,
 * including additions in later bounded parts, advances the household version. */
export function importedHouseholdWrites(c:Context,changes:HouseholdChange[],source:string,jobId:string):Stmt[] {
 return changes.flatMap(({before,after,sourceKey})=>[
  ...(before?[sql(`UPDATE cf_move_in_jobs SET report=json_set(report,?,json_object('before',json(COALESCE(json_extract(report,?),?)),'after',json(?))) WHERE id=? AND EXISTS(SELECT 1 FROM cf_move_in_records WHERE source=? AND kind='household' AND source_key=? AND job_id<>?)`,
   `$.householdCheckpoints.${after.id}`,`$.householdCheckpoints.${after.id}.before`,JSON.stringify(before),JSON.stringify(after),jobId,source,sourceKey,jobId)]:[]),
  guard('EXISTS(SELECT 1 FROM cf_households WHERE id=? AND version=?)','MOVE_IN_CHANGED','A household changed while this part was being applied.',after.id,before?.version??1),
  guard(`? IS NULL OR EXISTS(SELECT 1 FROM cf_donors d WHERE d.id=? AND d.household_id=? AND d.constituent_kind='person' AND d.constituent_status<>'deceased' AND d.erased_at IS NULL AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=d.id))`,'HOUSEHOLD_HEAD','The source household head is no longer eligible.',before&&before.head_donor_id===after.head_donor_id?null:after.head_donor_id,after.head_donor_id,after.id),
  sql(`UPDATE cf_households SET version=?,head_donor_id=?,addressee_override=?,formal_override=?,informal_override=?,overrides_review=?,head_source=?,head_imported_at=? WHERE id=?`,after.version,after.head_donor_id,after.addressee_override,after.formal_override,after.informal_override,after.overrides_review,after.head_source,after.head_imported_at,after.id),
  sql(`UPDATE cf_move_in_records SET snapshot=(SELECT ${snapshot('household')} FROM cf_households n WHERE n.id=cf_move_in_records.native_id) WHERE source=? AND kind='household' AND source_key=?`,source,sourceKey),
  event(c,'household.import','household',after.id,null,{jobId,source,oldHead:before?.head_donor_id??null,newHead:after.head_donor_id,overridesSet:['addressee','formal','informal'].filter(k=>after[`${k}_override`]!==null),overridesCleared:['addressee','formal','informal'].filter(k=>before?.[`${k}_override`]!=null&&after[`${k}_override`]===null),membershipChanged:true}),
 ])
}

const ownedDonors = `SELECT native_id FROM cf_move_in_records WHERE job_id=? AND kind='donor' AND owned=1`
const affected = `SELECT DISTINCT household_id FROM cf_donors WHERE id IN (${ownedDonors}) AND household_id IS NOT NULL`

/** Even when a later import merely adds members to an earlier source household,
 * staff changes to that household fence undo. The exact snapshot includes version. */
export function importHouseholdUndoFence(jobId:string):Stmt {
 return guard(`NOT EXISTS(SELECT 1 FROM cf_households n LEFT JOIN cf_move_in_records r ON r.kind='household' AND r.native_id=n.id WHERE n.id IN (${affected}) AND (r.snapshot IS NULL OR ${snapshot('household')}<>r.snapshot)) AND NOT EXISTS(SELECT 1 FROM cf_move_in_jobs j,json_each(j.report,'$.householdCheckpoints') p LEFT JOIN cf_households n ON n.id=p.key WHERE j.id=? AND (n.id IS NULL OR ${snapshot('household')}<>json_extract(p.value,'$.after')))`,'MOVE_IN_USED','An imported household changed since the move-in. Nothing was undone.',jobId,jobId)
}

/** Snapshot custody advances for our own removal, never for a staff change.
 * Households owned by this job are deleted after their members are removed. */
export function importHouseholdUndoWrites(c:Context,jobId:string):Stmt[] {
 const outside = `id IN (${affected}) AND id NOT IN (SELECT native_id FROM cf_move_in_records WHERE job_id=? AND kind='household' AND owned=1)`
 return [
  sql(`INSERT INTO cf_events(at,actor_id,actor_name,actor_role,action,subject_kind,subject_id,donor_id,detail)
   SELECT ?,?,?,?,'household.import-undo','household',id,NULL,json_object('jobId',?,'oldHead',head_donor_id,'newHead',CASE WHEN head_donor_id IN (${ownedDonors}) THEN NULL ELSE head_donor_id END,'overridesSet',json('[]'),'overridesCleared',json('[]'),'membershipChanged',json('true')) FROM cf_households WHERE id IN (${affected})`,c.now,c.actor.id,c.actor.name,c.actor.role,jobId,jobId,jobId),
  sql(`UPDATE cf_households SET version=version+1,${['name','head_donor_id','addressee_override','formal_override','informal_override','overrides_review','head_source','head_imported_at'].map(k=>`${k}=json_extract((SELECT report FROM cf_move_in_jobs WHERE id=?),'$.householdCheckpoints.'||cf_households.id||'.before.${k}')`).join(',')} WHERE ${outside}`,...Array(8).fill(jobId),jobId,jobId),
  // Owned households are about to be removed; clear their head before deleting
  // the donor. An earlier household was restored from its exact checkpoint.
  sql(`UPDATE cf_households SET head_donor_id=NULL,head_source=NULL,head_imported_at=NULL WHERE id IN (SELECT native_id FROM cf_move_in_records WHERE job_id=? AND kind='household' AND owned=1)`,jobId),
  sql(`UPDATE cf_move_in_records SET snapshot=(SELECT ${snapshot('household')} FROM cf_households n WHERE n.id=cf_move_in_records.native_id) WHERE kind='household' AND native_id IN (SELECT id FROM cf_households WHERE ${outside})`,jobId,jobId),
 ]
}

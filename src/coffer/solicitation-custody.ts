import { smsConsentStatement } from './sms-permission'
import { event, guard, sql, type Context, type Stmt } from './db'

/** Histories stay on their original identities. Existing flattened merge aliases
 * define the effective union; merging never fabricates a broader restriction or
 * discards one donor's ask count. The solicitation reader owns that union. */
const group = `(SELECT ? UNION SELECT ? UNION SELECT donor_id FROM cf_donor_merges WHERE into_id IN (?,?))`
export function solicitationCustodyGuards(source:string,target:string):Stmt[] {
 const scope=[source,target,source,target]
 return [guard(`NOT EXISTS(SELECT 1 FROM cf_sms_recipients r JOIN cf_sms_runs u ON u.id=r.run_id
  WHERE r.donor_id IN ${group} AND u.state IN ('prepared','approved') AND r.state IN ('pending','held','submitting'))`,
  'IN_TEXT_RUN','Discard pending or held text runs before merging. A text submission in progress must be reconciled first.',...scope)]
}

/** Call after the alias and survivor phone updates, before the after snapshot.
 * Appending a withdrawal makes consent re-confirmation explicit, even where a
 * source's later grant would otherwise become the survivor's latest answer.
 * The composed consent statement records this channel answer exactly once.
 * Undo deletes only this inserted delta; it never re-inserts old preferences. */
export function solicitationMergeCustody(c:Context,source:string,target:string,mergeId:string,mergedOn:string):Stmt[] {
 return [
  sql(`INSERT INTO cf_sms_preferences(donor_id,status,phone,timezone,source,evidence,captured_on,recorded_at,recorded_by)
   SELECT ?,'withdrawn',COALESCE(d.phone,''),COALESCE(
    (SELECT timezone FROM cf_sms_preferences WHERE donor_id=? ORDER BY id DESC LIMIT 1),
    (SELECT timezone FROM cf_sms_preferences WHERE donor_id=? OR donor_id IN (SELECT donor_id FROM cf_donor_merges WHERE into_id=?) ORDER BY id DESC LIMIT 1),
    (SELECT timezone FROM cf_settings WHERE id=1)),
    'person',?,?,?,?
   FROM cf_donors d WHERE d.id=? AND (EXISTS(SELECT 1 FROM cf_sms_preferences p
    WHERE p.donor_id=? OR p.donor_id IN (SELECT json_extract(value,'$.donor_id') FROM cf_donor_merge_rows
     WHERE merge_id=? AND phase='before' AND table_name='cf_donor_merges' AND json_extract(value,'$.into_id')=?))
    OR EXISTS(SELECT 1 FROM cf_donor_merge_rows WHERE merge_id=? AND phase='before' AND table_name='cf_consents'
     AND json_extract(value,'$.donor_id')=? AND json_extract(value,'$.channel')='sms'))`,
   target,target,source,target,`Merge ${mergeId}: SMS permission requires staff re-confirmation; original permission history is retained. Confirm donor time zone before granting permission.`,mergedOn,c.now,c.actor.name,target,source,mergeId,source,mergeId,source),
  smsConsentStatement(target,`Merge ${mergeId}: SMS permission requires staff re-confirmation; original permission history is retained. Confirm donor time zone before granting permission.`,c.now),
  event(c,'solicitation.mergeCustody','donor',target,target,{mergeId,sourceDonorId:source,restrictionPolicy:'original-identity-union',smsPolicy:'no-grant-transfer'}),
 ]
}
